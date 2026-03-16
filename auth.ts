import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { authConfig } from "./auth.config";
import { getSupabaseAdmin } from "./lib/supabase";

const ALLOWED_DOMAIN = process.env.AUTH_ALLOWED_DOMAIN;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:       "openid email profile https://www.googleapis.com/auth/calendar",
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
      if (ALLOWED_DOMAIN && !profile?.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return false;
      }
      return true;
    },
    async jwt({ token, account }) {
      // On first sign-in, account contains the Google OAuth tokens — persist them to Supabase
      if (account?.access_token && token.email) {
        try {
          const db = getSupabaseAdmin();
          await db.from("google_tokens").upsert({
            user_email:    token.email,
            access_token:  account.access_token,
            refresh_token: account.refresh_token ?? null,
            expires_at:    account.expires_at ?? null,
            updated_at:    new Date().toISOString(),
          }, { onConflict: "user_email" });
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
