import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const PUBLIC = ["/login", "/api/auth"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow login page, auth endpoint, and Next.js internals
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();

  const password = process.env.DASHBOARD_PASSWORD;
  // If no password is set, allow access (dev / local with no env var)
  if (!password) return NextResponse.next();

  const expected = crypto.createHash("sha256").update(password).digest("hex");
  const session  = req.cookies.get("dashboard_session")?.value;

  if (session !== expected) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.webp|.*\\.png).*)"],
};
