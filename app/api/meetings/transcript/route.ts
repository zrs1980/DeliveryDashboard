import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchMeetingTranscript, zoomConfigured, ZoomError } from "@/lib/zoom";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * GET /api/meetings/transcript?uuid=<meeting uuid>
 *
 * The UUID travels as a query param, not a path segment: Zoom meeting UUIDs are
 * base64 and routinely contain `/`, which would split a dynamic segment.
 *
 * A meeting that simply wasn't recorded returns 200 with `available: false` — that
 * is a normal outcome, not a failure. Only auth/scope/plan problems return 5xx.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!zoomConfigured()) {
    return NextResponse.json({ error: "Zoom is not connected.", needsSetup: true }, { status: 503 });
  }

  const uuid = req.nextUrl.searchParams.get("uuid");
  if (!uuid) return NextResponse.json({ error: "uuid is required" }, { status: 400 });

  try {
    const result = await fetchMeetingTranscript(uuid);

    // Speaker talk-time, computed here so every consumer gets the same numbers.
    const bySpeaker = new Map<string, { speaker: string; seconds: number; lines: number }>();
    for (let i = 0; i < result.cues.length; i++) {
      const c    = result.cues[i];
      const next = result.cues[i + 1];
      // Cue end times can be missing or malformed; fall back to the next cue's start.
      const endSecs = next ? next.seconds : c.seconds;
      const dur     = Math.max(0, (endSecs > c.seconds ? endSecs : c.seconds) - c.seconds);
      const key     = c.speaker || "Unattributed";
      if (!bySpeaker.has(key)) bySpeaker.set(key, { speaker: key, seconds: 0, lines: 0 });
      const e = bySpeaker.get(key)!;
      e.seconds += dur;
      e.lines   += 1;
    }

    return NextResponse.json({
      ...result,
      speakers: [...bySpeaker.values()].sort((a, b) => b.seconds - a.seconds),
      wordCount: result.cues.reduce((s, c) => s + c.text.split(/\s+/).filter(Boolean).length, 0),
    });
  } catch (err) {
    console.error("[/api/meetings/transcript]", err);
    const msg = err instanceof ZoomError ? err.message
              : err instanceof Error     ? err.message
              : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
