import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "pg";
import { authConfig } from "./auth.config";

const ALLOWED_DOMAIN = process.env.AUTH_ALLOWED_DOMAIN;

// Lazily created pool — not instantiated at build time
let _pool: Pool | null = null;
function getPool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3, // keep connection count low for serverless
    });
  }
  return _pool ?? undefined;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: getPool() ? PostgresAdapter(getPool()!) : undefined,
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
