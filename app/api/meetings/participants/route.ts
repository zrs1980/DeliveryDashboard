import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchMeetingParticipants, zoomConfigured, type MeetingParticipants } from "@/lib/zoom";

export const revalidate = 0;
export const maxDuration = 60;

/** Zoom has no bulk participants endpoint, so this is one call per meeting. */
const MAX_PER_REQUEST = 25;
/** Report endpoints are heavily rate limited — keep the fan-out modest. */
const CONCURRENCY = 4;

/**
 * POST /api/meetings/participants   { uuids: string[] }
 * → { participants: Record<uuid, MeetingParticipants> }
 *
 * Batched deliberately: a month can hold 400+ meetings and participants are one
 * request each, so the client asks for the rows it is showing and fills them in
 * progressively rather than blocking on the whole range.
 *
 * A per-meeting failure is returned as an `error` on that entry instead of failing
 * the batch — one bad meeting shouldn't blank the column for the other 24.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!zoomConfigured()) return NextResponse.json({ error: "Zoom is not connected." }, { status: 503 });

  try {
    const body  = await req.json();
    const uuids: string[] = Array.isArray(body?.uuids)
      ? body.uuids.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
      : [];

    if (uuids.length === 0) return NextResponse.json({ participants: {} });
    if (uuids.length > MAX_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many meetings in one request (${uuids.length}); max ${MAX_PER_REQUEST}.` },
        { status: 400 },
      );
    }

    const unique = [...new Set(uuids)];
    const out: Record<string, MeetingParticipants> = {};
    let next = 0;

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
        while (true) {
          const i = next++;
          if (i >= unique.length) return;
          const uuid = unique[i];
          try {
            out[uuid] = await fetchMeetingParticipants(uuid);
          } catch (e) {
            out[uuid] = {
              uuid, external: [], internalCount: 0, total: 0, unknownCount: 0,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }
      }),
    );

    return NextResponse.json({ participants: out });
  } catch (err) {
    console.error("[/api/meetings/participants]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
