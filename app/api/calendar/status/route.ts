import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasGoogleAccount } from "@/lib/google-tokens";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ connected: false, reason: "not_signed_in" });
  }
  const connected = await hasGoogleAccount(session.user.id);
  return NextResponse.json({ connected, userId: session.user.id });
}
