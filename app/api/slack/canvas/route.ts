import { NextRequest, NextResponse } from "next/server";
import { prependToCanvas } from "@/lib/slack";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { markdown?: string; canvasId?: string | null };
    if (!body.markdown?.trim()) {
      return NextResponse.json({ error: "No content to post" }, { status: 400 });
    }
    await prependToCanvas(body.markdown, body.canvasId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
