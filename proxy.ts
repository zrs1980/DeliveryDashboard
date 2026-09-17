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
  // Vercel Cron arrives with no session. Redirecting it to /login would make the
  // nightly job return an HTML 200 forever, which reads as a healthy run. The
  // route authenticates itself on CRON_SECRET instead — see lib/cs-permissions.
  const isCronRoute = pathname.startsWith("/api/cs/cron");

  // Always allow the login page, NextAuth internal routes and the cron endpoints
  if (isLoginPage || isAuthRoute || isCronRoute) return NextResponse.next();

  // Redirect unauthenticated requests to the login page
  if (!req.auth?.user) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Static assets bypass auth. .ttf matters for the status report PDF: react-pdf
  // fetches /fonts/DMSans-*.ttf, and a redirect to the login page would hand
  // fontkit an HTML body — the deck would silently fall back to Helvetica.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.webp|.*\\.png|.*\\.ttf).*)"],
};
