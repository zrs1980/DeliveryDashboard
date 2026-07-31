import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchPastMeetings, zoomConfigured, ZoomError } from "@/lib/zoom";

export const revalidate = 0;
export const maxDuration = 60;

/** Meetings are reported from this date onwards by default. */
const DEFAULT_FROM = "2026-07-01";

function parseDate(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? fallback : d;
}

/**
 * GET /api/meetings?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Past Zoom meetings hosted by any active account user in the range.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!zoomConfigured()) {
    return NextResponse.json({
      error: "Zoom is not connected. Add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET in Vercel, then redeploy.",
      needsSetup: true,
    }, { status: 503 });
  }

  const sp   = req.nextUrl.searchParams;
  const from = parseDate(sp.get("from"), new Date(DEFAULT_FROM + "T00:00:00"));
  const to   = parseDate(sp.get("to"), new Date());

  if (from > to) {
    return NextResponse.json({ error: "`from` is after `to`." }, { status: 400 });
  }

  try {
    const { meetings, hosts, warnings } = await fetchPastMeetings(from, to);

    const totalMinutes = meetings.reduce((s, m) => s + (m.durationMinutes || 0), 0);
    const participants = meetings.reduce((s, m) => s + (m.participantCount || 0), 0);

    return NextResponse.json({
      meetings,
      hosts: hosts.map(h => ({ id: h.id, name: h.name, email: h.email })),
      summary: {
        count:            meetings.length,
        totalMinutes,
        totalHours:       Math.round((totalMinutes / 60) * 10) / 10,
        avgMinutes:       meetings.length ? Math.round(totalMinutes / meetings.length) : 0,
        participants,
        avgParticipants:  meetings.length ? Math.round((participants / meetings.length) * 10) / 10 : 0,
      },
      range: { from: sp.get("from") ?? DEFAULT_FROM, to: sp.get("to") ?? new Date().toISOString().slice(0, 10) },
      warnings,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/meetings]", err);
    const msg = err instanceof ZoomError ? err.message
              : err instanceof Error     ? err.message
              : "Unknown error";
    // ZoomError messages are already written as remedies, so pass them straight through.
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
