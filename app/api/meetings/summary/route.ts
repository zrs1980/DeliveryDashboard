import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchMeetingSummary, zoomConfigured, ZoomError } from "@/lib/zoom";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * GET /api/meetings/summary?uuid=<meeting uuid>
 *
 * The AI Companion meeting summary — Zoom's own post-meeting notes: overview,
 * sectioned key points and next steps.
 *
 * UUID travels as a query param, not a path segment: Zoom meeting UUIDs are base64
 * and routinely contain `/`.
 *
 * A meeting with no summary returns 200 with `available: false` — that's the normal
 * case when AI Companion wasn't on. Only auth/scope/plan problems return 5xx.
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
    return NextResponse.json(await fetchMeetingSummary(uuid));
  } catch (err) {
    console.error("[/api/meetings/summary]", err);
    const msg = err instanceof ZoomError ? err.message
              : err instanceof Error     ? err.message
              : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
