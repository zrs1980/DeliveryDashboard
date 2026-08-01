// ─── Google service account with domain-wide delegation ───────────────────────
//
// Drive access without per-user OAuth. `.../auth/drive` is a RESTRICTED scope, so
// requesting it through the normal consent flow forces Google's verification
// process (demo video, privacy policy, sometimes a paid CASA assessment). Domain-
// wide delegation sidesteps that entirely: the scope is authorised once by a
// Workspace admin against the service account's client id.
//
// Setup:
//  1. Google Cloud → IAM & Admin → Service Accounts → create one, then Keys → add
//     a JSON key.
//  2. Note the service account's *Unique ID* (the numeric client id).
//  3. Google Workspace Admin → Security → Access and data control → API controls →
//     Domain-wide delegation → Add new. Client ID = that unique id, scope =
//     https://www.googleapis.com/auth/drive
//  4. Share the customer/project folders with the service account's email, OR rely
//     on impersonation (below), which inherits the impersonated user's access.
//  5. Env: GOOGLE_SA_KEY_JSON (whole JSON, optionally base64) or
//     GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY, plus
//     GOOGLE_SA_IMPERSONATE_USER as the fallback identity.
//
// Files are created *as the impersonated user*, so ownership and storage quota
// behave normally — a bare service account has no Drive quota of its own and
// can't create files in a user's My Drive.

import { google } from "googleapis";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export class ServiceAccountError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ServiceAccountError";
  }
}

interface SaCredentials { clientEmail: string; privateKey: string }

/**
 * Read the service account credentials from env.
 *
 * Private keys are the usual source of pain: env vars can't hold real newlines, so
 * they arrive with literal "\n" sequences that must be converted back, and some
 * people base64 the whole JSON to dodge the problem. Both are handled.
 */
function readCredentials(): SaCredentials | null {
  const raw = process.env.GOOGLE_SA_KEY_JSON?.trim();

  if (raw) {
    let text = raw;
    // Base64-encoded JSON — no leading brace means it isn't raw JSON.
    if (!text.startsWith("{")) {
      try { text = Buffer.from(text, "base64").toString("utf8"); }
      catch { /* fall through to the parse error below */ }
    }
    try {
      const parsed = JSON.parse(text) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email,
          privateKey:  parsed.private_key.replace(/\\n/g, "\n").trim(),
        };
      }
      throw new ServiceAccountError("GOOGLE_SA_KEY_JSON is valid JSON but has no client_email / private_key.");
    } catch (e) {
      if (e instanceof ServiceAccountError) throw e;
      throw new ServiceAccountError(
        "GOOGLE_SA_KEY_JSON could not be parsed. Paste the whole service-account JSON key, or a base64 encoding of it.",
      );
    }
  }

  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL?.trim();
  const privateKey  = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    return { clientEmail, privateKey: privateKey.replace(/\\n/g, "\n").trim() };
  }

  return null;
}

export function serviceAccountConfigured(): boolean {
  try { return readCredentials() !== null; } catch { return false; }
}

/** Diagnostics for the debug route — never returns key material. */
export function serviceAccountStatus() {
  let creds: SaCredentials | null = null;
  let error: string | null = null;
  try { creds = readCredentials(); } catch (e) { error = e instanceof Error ? e.message : String(e); }

  const key = creds?.privateKey ?? "";
  return {
    configured:        !!creds,
    clientEmail:       creds?.clientEmail ?? null,
    impersonateUser:   process.env.GOOGLE_SA_IMPERSONATE_USER ?? null,
    privateKeyLooksOk: key.includes("BEGIN PRIVATE KEY") && key.includes("\n"),
    source:            process.env.GOOGLE_SA_KEY_JSON ? "GOOGLE_SA_KEY_JSON" :
                       process.env.GOOGLE_SA_CLIENT_EMAIL ? "GOOGLE_SA_CLIENT_EMAIL/PRIVATE_KEY" : null,
    error,
  };
}

/**
 * Authorised Drive client impersonating `userEmail`.
 *
 * Impersonating the person who clicked, rather than one fixed account, keeps
 * document ownership and folder permissions accurate. Falls back to
 * GOOGLE_SA_IMPERSONATE_USER when no user is supplied.
 */
export async function getImpersonatedAuth(userEmail?: string | null) {
  const creds = readCredentials();
  if (!creds) return null;

  const subject = (userEmail || process.env.GOOGLE_SA_IMPERSONATE_USER || "").trim();
  if (!subject) {
    throw new ServiceAccountError(
      "No user to impersonate. Set GOOGLE_SA_IMPERSONATE_USER to a Workspace address, or sign in with one.",
      "no_subject",
    );
  }

  const jwt = new google.auth.JWT({
    email:   creds.clientEmail,
    key:     creds.privateKey,
    scopes:  [DRIVE_SCOPE],
    subject,                      // this is what makes it domain-wide delegation
  });

  try {
    await jwt.authorize();
  } catch (e) {
    const err = e as { message?: string; response?: { data?: { error?: string; error_description?: string } } };
    const code = err?.response?.data?.error ?? "";
    const desc = err?.response?.data?.error_description ?? err?.message ?? "unknown error";

    // These two account for essentially every delegation misconfiguration.
    if (code === "unauthorized_client") {
      throw new ServiceAccountError(
        `Google refused the delegation: the service account isn't authorised for the Drive scope. In Google Workspace Admin → Security → Access and data control → API controls → Domain-wide delegation, add the service account's numeric Client ID with scope ${DRIVE_SCOPE}. (${desc})`,
        "unauthorized_client",
      );
    }
    if (code === "invalid_grant") {
      throw new ServiceAccountError(
        `Google rejected impersonation of ${subject}. Check it's a real user in the Workspace domain, and that the service account key is current. (${desc})`,
        "invalid_grant",
      );
    }
    throw new ServiceAccountError(`Service account authorisation failed: ${desc}`, code || undefined);
  }

  return jwt;
}
