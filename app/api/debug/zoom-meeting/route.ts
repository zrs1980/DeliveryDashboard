import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchPastMeetings, listUserMeetingSummaries, listZoomUsers,
  meetingUuidCandidates, zoomConfigured,
} from "@/lib/zoom";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * Diagnostic for "the Zoom portal shows notes but the app doesn't".
 *
 *   /api/debug/zoom-meeting?topic=SFDC            find the meeting, then probe it
 *   /api/debug/zoom-meeting?uuid=<uuid>           probe a known UUID directly
 *   &from=2026-07-01&to=2026-07-31                override the search window
 *
 * Reports, without swallowing anything:
 *   - whether the meeting is in the report fan-out, and under which host
 *   - the raw UUID and every candidate encoding
 *   - raw status + body for meeting_summary and recordings under EACH encoding
 *   - the host's summary list for the range, which needs no UUID at all
 */
async function probe(path: string): Promise<{ status: number; body: unknown }> {
  // Deliberately re-implemented here rather than reusing zoomGet: this must report
  // raw status and body, not a friendly mapped message.
  const accountId    = process.env.ZOOM_ACCOUNT_ID!;
  const clientId     = process.env.ZOOM_CLIENT_ID!;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return { status: tokRes.status, body: { tokenError: tok } };

  const res  = await fetch(`https://api.zoom.us/v2${path}`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!zoomConfigured()) return NextResponse.json({ error: "Zoom not configured" }, { status: 503 });

  const sp    = req.nextUrl.searchParams;
  const topic = sp.get("topic");
  let   uuid  = sp.get("uuid") ?? "";
  const from  = sp.get("from") ?? "2026-07-01";
  const to    = sp.get("to")   ?? new Date().toISOString().slice(0, 10);

  try {
    const out: Record<string, unknown> = { range: { from, to } };

    // ── 1. Locate the meeting in the report fan-out ──
    let hostId: string | null = null;
    if (!uuid && topic) {
      const { meetings, warnings } = await fetchPastMeetings(new Date(from + "T00:00:00"), new Date(to + "T00:00:00"));
      const hits = meetings.filter(m => m.topic.toLowerCase().includes(topic.toLowerCase()));
      out.reportSearch = {
        totalMeetingsInRange: meetings.length,
        matches: hits.map(m => ({ uuid: m.uuid, meetingId: m.meetingId, topic: m.topic, startTime: m.startTime, host: m.hostName, hostEmail: m.hostEmail, hostId: m.hostId })),
        warnings,
      };
      if (hits.length > 0) { uuid = hits[0].uuid; hostId = hits[0].hostId; }
    }

    if (!uuid) {
      out.conclusion = "No UUID resolved. Either pass ?uuid= directly, or the meeting isn't in the report fan-out for this range — which would itself be the bug.";
      return NextResponse.json(out);
    }

    // ── 2. Probe both encodings for both endpoints ──
    const candidates = meetingUuidCandidates(uuid);
    out.uuid = { raw: uuid, candidates, note: "candidates[0] is what the app tries first" };

    const attempts: Record<string, unknown> = {};
    for (let i = 0; i < candidates.length; i++) {
      const enc = candidates[i];
      const label = i === 0 ? "preferred" : "alternate";
      attempts[`${label}_meeting_summary`] = await probe(`/meetings/${enc}/meeting_summary`);
      attempts[`${label}_recordings`]      = await probe(`/meetings/${enc}/recordings`);
    }
    out.attempts = attempts;

    // ── 3. Summary list for the host — needs no UUID ──
    if (!hostId) {
      const users = await listZoomUsers().catch(() => []);
      hostId = users[0]?.id ?? null;
      out.hostListNote = "No host resolved from the report search; used the first account user for the summary-list probe.";
    }
    if (hostId) {
      try {
        const list = await listUserMeetingSummaries(hostId, from, to);
        out.summaryList = {
          hostId,
          count: list.length,
          entries: list.map(s => ({ topic: s.topic, startTime: s.startTime, meetingUuid: s.meetingUuid, meetingId: s.meetingId })),
          uuidMatchesThisMeeting: list.some(s => s.meetingUuid === uuid),
        };
      } catch (e) {
        out.summaryList = { hostId, error: e instanceof Error ? e.message : String(e) };
      }
    }

    return NextResponse.json(out);
  } catch (err) {
    console.error("[/api/debug/zoom-meeting]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
