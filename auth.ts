import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { authConfig } from "./auth.config";
import { getSupabaseAdmin } from "./lib/supabase";

const ALLOWED_DOMAINS = (process.env.AUTH_ALLOWED_DOMAIN ?? "")
  .split(",")
  .map(d => d.trim())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Deliberately NO Drive scope. `.../auth/drive` is RESTRICTED, so asking
          // for it here forces Google's verification review (demo video, privacy
          // policy, sometimes a paid CASA assessment) and shows every user an
          // unverified-app warning. Drive access goes through the service account
          // with domain-wide delegation instead — see lib/google-service-account.ts.
          scope:       "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send",
          access_type: "offline",
          prompt:      "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },  // No database adapter needed
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account: _account, profile }) {
      if (ALLOWED_DOMAINS.length > 0 && !ALLOWED_DOMAINS.some(d => profile?.email?.endsWith(`@${d}`))) {
        return false;
      }

      // Record that this person has a login, for assignee pickers.
      //
      // ⚠ THIS MUST NEVER BLOCK SIGN-IN. Returning false here locks someone out
      // of the whole application, so a bookkeeping failure — a missing table, a
      // Supabase outage — is logged and swallowed. The worst case is that they
      // are briefly missing from a dropdown; the alternative is that they
      // cannot work at all.
      //
      // `email` is the join key everywhere (pm_crm_tasks.assigned_to), so it is
      // lower-cased on the way in. Google can return a differently-cased
      // address, and "Zabe@..." not matching "zabe@..." would quietly split one
      // person into two assignees.
      if (profile?.email) {
        try {
          const now = new Date().toISOString();
          await getSupabaseAdmin().from("pm_app_users").upsert({
            email:        profile.email.toLowerCase(),
            name:         profile.name ?? null,
            image_url:    (profile as { picture?: string }).picture ?? null,
            last_seen_at: now,
          }, { onConflict: "email" });
        } catch (e) {
          console.error("[auth] Could not record app user:", e);
        }
      }
      return true;
    },
    async jwt({ token, account }) {
      // On first sign-in, account contains the Google OAuth tokens — persist them to Supabase
      if (account?.access_token && token.email) {
        try {
          const db = getSupabaseAdmin();
          // refresh_token is only included when Google actually returned one.
          // Writing `?? null` would destroy a working refresh token on any grant
          // that omits it (Google doesn't always re-issue), leaving the account
          // unable to refresh until the next full consent. Omitting the column
          // from the upsert payload leaves the stored value untouched.
          const row: Record<string, unknown> = {
            user_email:   token.email,
            access_token: account.access_token,
            expires_at:   account.expires_at ?? null,
            updated_at:   new Date().toISOString(),
          };
          if (account.refresh_token) row.refresh_token = account.refresh_token;

          await db.from("google_tokens").upsert(row, { onConflict: "user_email" });
        } catch (e) {
          console.error("[auth] Failed to store Google tokens:", e);
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Expose the JWT subject (Google sub) as the user ID
      session.user.id = token.sub ?? token.email ?? "";
      return session;
    },
  },
});
