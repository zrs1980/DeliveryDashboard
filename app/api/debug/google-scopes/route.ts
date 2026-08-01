import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

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
      storedToken: false,
      conclusion: "No Google token is stored for this account. Sign out and sign back in.",
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
      ? "Drive scope IS present on the stored token. If Drive calls still fail, the Drive API may not be enabled for the Google Cloud project — enable it under APIs & Services → Library → Google Drive API."
      : "Drive scope is MISSING from the stored token. The most common cause is the Google Cloud OAuth consent screen not listing the Drive scope — the app can request it, but Google only grants scopes registered on the consent screen. Add .../auth/drive there, then sign out and back in.";

  return NextResponse.json({
    email,
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
