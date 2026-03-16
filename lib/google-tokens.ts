import { google } from "googleapis";
import { getSupabaseAdmin } from "./supabase";

interface AccountRow {
  access_token:  string | null;
  refresh_token: string | null;
  expires_at:    number | null;
}

/**
 * Returns an authenticated Google OAuth2 client for the given NextAuth user ID.
 * Automatically refreshes the access token if it is expired or near expiry,
 * and writes the new token back to Supabase.
 *
 * Returns null if no Google account is linked for this user.
 */
export async function getGoogleCalendarClient(userId: string) {
  const db = getSupabaseAdmin();
  const { data: account } = await db
    .from("accounts")
    .select("access_token, refresh_token, expires_at")
    .eq("userId", userId)
    .eq("provider", "google")
    .maybeSingle() as { data: AccountRow | null };

  if (!account?.access_token) return null;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  // Refresh if expired or expiring within 5 minutes
  const expiresMs    = account.expires_at ? account.expires_at * 1000 : 0;
  const needsRefresh = expiresMs > 0 && expiresMs < Date.now() + 300_000;

  if (needsRefresh && account.refresh_token) {
    try {
      oauth2.setCredentials({ refresh_token: account.refresh_token });
      const { credentials } = await oauth2.refreshAccessToken();
      await db
        .from("accounts")
        .update({
          access_token: credentials.access_token,
          expires_at:   credentials.expiry_date
            ? Math.floor(credentials.expiry_date / 1000)
            : null,
        })
        .eq("userId", userId)
        .eq("provider", "google");
      oauth2.setCredentials(credentials);
    } catch {
      oauth2.setCredentials({
        access_token:  account.access_token,
        refresh_token: account.refresh_token,
      });
    }
  } else {
    oauth2.setCredentials({
      access_token:  account.access_token,
      refresh_token: account.refresh_token,
    });
  }

  return oauth2;
}

/** Returns true if the user has a linked Google account with a refresh token */
export async function hasGoogleAccount(userId: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("accounts")
    .select("refresh_token")
    .eq("userId", userId)
    .eq("provider", "google")
    .maybeSingle();
  return !!(data as AccountRow | null)?.refresh_token;
}
