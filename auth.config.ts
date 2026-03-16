import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe config — no database imports here (used by middleware)
export const authConfig: NextAuthConfig = {
  providers: [Google],
  pages: {
    signIn: "/login",
    error:  "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn   = !!auth?.user;
      const isLoginPage  = nextUrl.pathname.startsWith("/login");
      const isAuthRoute  = nextUrl.pathname.startsWith("/api/auth");

      // Always allow the login page and NextAuth internal routes
      if (isLoginPage || isAuthRoute) return true;

      // Everything else requires a session
      return isLoggedIn;
    },
  },
};
