import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const configured = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
  const connected = !!req.cookies.get("gcal_tokens")?.value;
  return NextResponse.json({ configured, connected });
}
