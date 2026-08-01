import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchFirefliesTranscript, firefliesConfigured, FirefliesError } from "@/lib/fireflies";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * GET /api/fireflies/transcript?id=<transcriptId>
 * Sentences for one meeting. Fetched on demand — including them in the list query
 * would make a month's payload enormous.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!firefliesConfigured()) {
    return NextResponse.json({ error: "Fireflies is not connected.", needsSetup: true }, { status: 503 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const sentences = await fetchFirefliesTranscript(id);

    // Per-speaker line counts, so the panel can show who dominated the call.
    const bySpeaker = new Map<string, number>();
    for (const s of sentences) {
      const k = s.speaker || "Unattributed";
      bySpeaker.set(k, (bySpeaker.get(k) ?? 0) + 1);
    }

    return NextResponse.json({
      available: sentences.length > 0,
      sentences,
      wordCount: sentences.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0),
      speakers: [...bySpeaker.entries()].map(([speaker, lines]) => ({ speaker, lines })).sort((a, b) => b.lines - a.lines),
    });
  } catch (err) {
    console.error("[/api/fireflies/transcript]", err);
    const msg = err instanceof FirefliesError ? err.message : err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
