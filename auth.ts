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
          // drive is needed to browse the customer/project folder tree and file
          // meeting docs into an existing folder. NOTE: adding a scope means every
          // user must sign out and back in — tokens carry the scopes they were
          // issued with. `prompt: consent` below makes that re-consent happen.
          scope:       "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive",
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
