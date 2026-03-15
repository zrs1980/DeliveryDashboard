import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { password } = await req.json() as { password: string };
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected) {
    // No password configured — deny to avoid accidental open access
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }

  if (!password || password !== expected) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = crypto.createHash("sha256").update(expected).digest("hex");

  const res = NextResponse.json({ ok: true });
  res.cookies.set("dashboard_session", token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge:   60 * 60 * 24 * 7, // 7 days
    path:     "/",
  });
  return res;
}
