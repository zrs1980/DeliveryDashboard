import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchPastMeetings, meetingUuidCandidates, zoomConfigured } from "@/lib/zoom";

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
    let hostId    = sp.get("hostId") ?? "";
    let numericId = sp.get("meetingId") ?? "";

    if ((!uuid || !hostId || !numericId) && topic) {
      const { meetings, warnings } = await fetchPastMeetings(new Date(from + "T00:00:00"), new Date(to + "T00:00:00"));
      const hits = meetings.filter(m => m.topic.toLowerCase().includes(topic.toLowerCase()));
      out.reportSearch = {
        totalMeetingsInRange: meetings.length,
        matches: hits.map(m => ({ uuid: m.uuid, meetingId: m.meetingId, topic: m.topic, startTime: m.startTime, host: m.hostName, hostEmail: m.hostEmail, hostId: m.hostId })),
        warnings,
      };
      const hit = hits[0];
      if (hit) {
        uuid      = uuid      || hit.uuid;
        hostId    = hostId    || hit.hostId;
        numericId = numericId || String(hit.meetingId);
      }
    }

    if (!uuid && !numericId) {
      out.conclusion = "Nothing resolved. Pass ?uuid= or ?meetingId=, or the meeting isn't in the report fan-out for this range — which would itself be the bug.";
      return NextResponse.json(out);
    }

    // ── 2. Probe every plausible address form ──
    // /meetings/{id} resolves SCHEDULED meetings; a past instance may only be
    // addressable by numeric meeting ID or via /past_meetings. Probe all of them and
    // let the response decide, rather than guessing again.
    const candidates = uuid ? meetingUuidCandidates(uuid) : [];
    out.uuid = { raw: uuid, candidates, numericId, hostId, note: "candidates[0] is what the app tries first" };

    const probes: Array<[string, string]> = [];
    if (candidates[0]) {
      probes.push(["uuid_single__meeting_summary", `/meetings/${candidates[0]}/meeting_summary`]);
      probes.push(["uuid_single__recordings",      `/meetings/${candidates[0]}/recordings`]);
      probes.push(["uuid_single__past_meeting",    `/past_meetings/${candidates[0]}`]);
    }
    if (candidates[1]) {
      probes.push(["uuid_double__meeting_summary", `/meetings/${candidates[1]}/meeting_summary`]);
      probes.push(["uuid_double__past_meeting",    `/past_meetings/${candidates[1]}`]);
    }
    if (numericId) {
      probes.push(["numericId__meeting_summary", `/meetings/${numericId}/meeting_summary`]);
      probes.push(["numericId__recordings",      `/meetings/${numericId}/recordings`]);
      probes.push(["numericId__meeting",         `/meetings/${numericId}`]);
      probes.push(["numericId__past_instances",  `/past_meetings/${numericId}/instances`]);
    }

    const attempts: Record<string, unknown> = {};
    for (const [label, path] of probes) {
      attempts[label] = { path, ...(await probe(path)) };
    }
    out.attempts = attempts;

    // ── 2b. Does the host have ANY cloud recordings in the range? ──
    // Answers "is there a cloud recording at all", independent of this meeting.
    if (hostId) {
      out.hostRecordings = { path: `/users/${hostId}/recordings`, ...(await probe(`/users/${encodeURIComponent(hostId)}/recordings?from=${from}&to=${to}&page_size=30`)) };
    }

    // ── 2c. Zoom Notes / Docs surface ──
    // The token carries my_notes:read:{note,content,notes_transcript}:admin and
    // docs:read:*, and /past_meetings reported has_meeting_summary:false — so what's
    // visible in the portal is Notes, not an AI Companion summary. Zoom's Notes API
    // paths aren't something to guess at: probe candidates and let 200 vs 2300
    // ("endpoint not recognized") identify the real one.
    const notesProbes: Array<[string, string]> = [
      ["notes__list",              `/notes`],
      ["notes__list_paged",        `/notes?page_size=30`],
      ["notes__user_scoped",       `/users/${encodeURIComponent(hostId)}/notes`],
      ["notes__me",                `/users/me/notes`],
      ["docs__list",               `/docs`],
      ["docs__files",              `/docs/files`],
      ["meeting_notes__by_uuid",   `/meetings/${candidates[0]}/notes`],
      ["past_meeting_notes",       `/past_meetings/${candidates[0]}/notes`],
      ["meeting_summary_by_uuid2", `/meetings/${candidates[0]}/summary`],
    ];
    const notesAttempts: Record<string, unknown> = {};
    for (const [label, path] of notesProbes) {
      notesAttempts[label] = { path, ...(await probe(path)) };
    }
    out.notesProbes = {
      note: "200 = endpoint exists. code 2300 = path doesn't exist on this account. 4711/401 = scope issue.",
      attempts: notesAttempts,
    };

    // ── 3. What scopes does the token actually carry? ──
    // Settles "is the scope missing" vs "the address is wrong" without ambiguity.
    out.tokenScopes = await (async () => {
      const basic = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
      const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID!)}`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      });
      const b = await res.json().catch(() => ({}));
      const scopes: string[] = typeof b.scope === "string" ? b.scope.split(/\s+/).filter(Boolean) : [];
      // `all` is several hundred entries on this account and drowns the output —
      // report only the families that matter here, plus a count.
      return {
        status: res.status,
        total: scopes.length,
        notes:      scopes.filter(s => /my_notes|docs:/i.test(s)).sort(),
        summary:    scopes.filter(s => /summary/i.test(s)).sort(),
        transcript: scopes.filter(s => /transcript/i.test(s)).sort(),
      };
    })();

    return NextResponse.json(out);
  } catch (err) {
    console.error("[/api/debug/zoom-meeting]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
