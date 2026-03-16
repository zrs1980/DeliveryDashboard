import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { SupabaseAdapter } from "@auth/supabase-adapter";
import { authConfig } from "./auth.config";

// Allowed email domain — set AUTH_ALLOWED_DOMAIN=cebasolutions.com in env vars to restrict.
// Leave unset to allow any Google account.
const ALLOWED_DOMAIN = process.env.AUTH_ALLOWED_DOMAIN;

// Build an adapter only when the env vars are present (they will be at runtime, not during build)
function makeAdapter() {
  const url    = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return undefined;
  return SupabaseAdapter({ url, secret });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: makeAdapter(),
  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Request calendar access + offline access at sign-in time
          scope:       "openid email profile https://www.googleapis.com/auth/calendar",
          access_type: "offline",
          prompt:      "consent",   // always show consent so we get a refresh_token
        },
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account: _account, profile }) {
      if (ALLOWED_DOMAIN && !profile?.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return false;
      }
      return true;
    },
    async session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  session: { strategy: "database" },
});
