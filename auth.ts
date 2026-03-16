import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "pg";
import { authConfig } from "./auth.config";

const ALLOWED_DOMAIN = process.env.AUTH_ALLOWED_DOMAIN;

// Try multiple env var names — Supabase Vercel integration sets POSTGRES_URL
const DB_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

const pool = DB_URL
  ? new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, max: 3 })
  : null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: pool ? PostgresAdapter(pool) : undefined,
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
