import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const origin = req.nextUrl.origin;

  if (error || !code) {
    return NextResponse.redirect(`${origin}/?cal_error=${error ?? "no_code"}`);
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  try {
    const { tokens } = await oauth2.getToken(code);
    const res = NextResponse.redirect(`${origin}/`);
    res.cookies.set("gcal_tokens", JSON.stringify(tokens), {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   60 * 60 * 24 * 30, // 30 days
      path:     "/",
    });
    return res;
  } catch {
    return NextResponse.redirect(`${origin}/?cal_error=token_exchange_failed`);
  }
}
