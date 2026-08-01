import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { google } from "googleapis";
import { getImpersonatedAuth, serviceAccountConfigured, serviceAccountStatus } from "@/lib/google-service-account";
import { DRIVE_CUSTOMER_ROOT_FOLDER_ID } from "@/lib/constants";

export const revalidate = 0;

/**
 * Diagnostic for "your Google session doesn't include Drive permission".
 *
 * Asks Google what the STORED access token was actually granted, rather than
 * inferring it from what the code requested. The two diverge when the OAuth
 * consent screen in Google Cloud Console doesn't list a scope: the code asks for
 * it, Google silently issues a token without it, and every Drive call 403s.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = session.user.email;

  // ── Service account (the route Drive access actually takes now) ──
  const sa: Record<string, unknown> = { status: serviceAccountStatus() };

  if (serviceAccountConfigured()) {
    try {
      const auth2 = await getImpersonatedAuth(email);
      sa.delegation = "ok — token issued for " + email;

      // End-to-end proof: can it actually read the configured customer root?
      try {
        const drive = google.drive({ version: "v3", auth: auth2! });
        const res = await drive.files.get({
          fileId: DRIVE_CUSTOMER_ROOT_FOLDER_ID,
          fields: "id, name, mimeType, driveId",
          supportsAllDrives: true,
        });
        sa.customerRoot = {
          reachable: true,
          name: res.data.name,
          inSharedDrive: !!res.data.driveId,
        };
      } catch (e) {
        const err = e as { code?: number; message?: string };
        sa.customerRoot = {
          reachable: false,
          status: err?.code ?? null,
          error: err?.message ?? String(e),
          hint: err?.code === 404
            ? "The impersonated user can't see this folder. Share the customer folder with them, or check DRIVE_CUSTOMER_ROOT_FOLDER_ID."
            : err?.code === 403
              ? "Authorised but refused — the Drive API may not be enabled on the Google Cloud project (APIs & Services → Library → Google Drive API)."
              : null,
        };
      }
    } catch (e) {
      sa.delegation = "failed";
      sa.delegationError = e instanceof Error ? e.message : String(e);
    }
  } else {
    sa.delegation = "not configured — set GOOGLE_SA_KEY_JSON (or GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY)";
  }

  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("google_tokens")
    .select("access_token, refresh_token, expires_at, updated_at")
    .eq("user_email", email)
    .maybeSingle();

  if (error) return NextResponse.json({ error: `Could not read stored token: ${error.message}` }, { status: 500 });
  if (!data?.access_token) {
    return NextResponse.json({
      email,
      serviceAccount: sa,
      storedToken: false,
      conclusion: "No user Google token stored — which is fine now that Drive goes through the service account. Check serviceAccount above.",
    });
  }

  const expiresAt = data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null;
  const expired   = data.expires_at ? data.expires_at * 1000 < Date.now() : null;

  // tokeninfo reports the scopes actually attached to this token.
  let granted: string[] = [];
  let tokenInfoError: string | null = null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(data.access_token)}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok && typeof body.scope === "string") {
      granted = body.scope.split(/\s+/).filter(Boolean).sort();
    } else {
      tokenInfoError = body.error_description ?? body.error ?? `HTTP ${res.status}`;
    }
  } catch (e) {
    tokenInfoError = e instanceof Error ? e.message : String(e);
  }

  const has = (s: string) => granted.some(g => g === s || g.endsWith(`/${s}`));
  const hasDrive    = granted.some(g => g.includes("/auth/drive"));
  const hasCalendar = granted.some(g => g.includes("/auth/calendar"));
  const hasGmail    = granted.some(g => g.includes("/auth/gmail"));

  const conclusion = tokenInfoError
    ? expired
      ? "The stored access token has expired, so Google wouldn't describe it. Sign out and back in, then re-run this."
      : `Google wouldn't describe the token (${tokenInfoError}). Sign out and back in, then re-run this.`
    : hasDrive
      ? "The user token happens to carry Drive scope, but Drive access no longer uses it — see serviceAccount above."
      : "No Drive scope on the user token, which is EXPECTED: it was removed deliberately because .../auth/drive is restricted and would force Google verification. Drive access goes through the service account — see serviceAccount above.";

  return NextResponse.json({
    email,
    serviceAccount: sa,
    storedToken: true,
    tokenUpdatedAt: data.updated_at ?? null,
    tokenExpiresAt: expiresAt,
    tokenExpired: expired,
    hasRefreshToken: !!data.refresh_token,
    granted,
    checks: { hasDrive, hasCalendar, hasGmail, hasOpenid: has("openid") },
    tokenInfoError,
    conclusion,
  });
}
