import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Edge-safe auth using authConfig (no database adapter — edge compatible)
const { auth } = NextAuth(authConfig);

export default auth(function proxy(req: NextRequest & { auth?: { user?: unknown } | null }) {
  const { pathname } = req.nextUrl;

  const isLoginPage = pathname.startsWith("/login");
  const isAuthRoute = pathname.startsWith("/api/auth");

  // Always allow the login page and NextAuth internal routes
  if (isLoginPage || isAuthRoute) return NextResponse.next();

  // Redirect unauthenticated requests to the login page
  if (!req.auth?.user) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.webp|.*\\.png).*)"],
};
