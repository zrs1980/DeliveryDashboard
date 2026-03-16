import { google } from "googleapis";
import { getSupabaseAdmin } from "./supabase";

interface TokenRow {
  access_token:  string | null;
  refresh_token: string | null;
  expires_at:    number | null;
}

export async function getGoogleCalendarClient(userEmail: string) {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("google_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_email", userEmail)
    .maybeSingle() as { data: TokenRow | null };

  if (!data?.access_token) return null;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  const expiresMs    = data.expires_at ? data.expires_at * 1000 : 0;
  const needsRefresh = expiresMs > 0 && expiresMs < Date.now() + 300_000;

  if (needsRefresh && data.refresh_token) {
    try {
      oauth2.setCredentials({ refresh_token: data.refresh_token });
      const { credentials } = await oauth2.refreshAccessToken();
      await db.from("google_tokens").update({
        access_token: credentials.access_token,
        expires_at:   credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : null,
        updated_at:   new Date().toISOString(),
      }).eq("user_email", userEmail);
      oauth2.setCredentials(credentials);
    } catch {
      oauth2.setCredentials({ access_token: data.access_token, refresh_token: data.refresh_token });
    }
  } else {
    oauth2.setCredentials({ access_token: data.access_token, refresh_token: data.refresh_token });
  }

  return oauth2;
}

export async function hasGoogleAccount(userEmail: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_email", userEmail)
    .maybeSingle() as { data: TokenRow | null };
  return !!data?.refresh_token;
}
