import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL, runSuiteQLAll, patchRecord } from "@/lib/netsuite";

export const revalidate = 0;

/**
 * POST /api/time-entries/approve   { ids: number[] }
 *
 * Sets each time entry's approval status to Approved in NetSuite.
 *
 * - **The Approved id is looked up, not hardcoded.** Nothing in this repo has
 *   verified the internal ids of timebill's approval status list (manager-review
 *   guesses "1"), and patching a wrong id would mis-file every entry at once. The
 *   id is read from entries NetSuite already labels "Approved".
 * - **Current status is re-read here**, not trusted from the browser, so an
 *   entry approved or rejected since the page loaded is skipped. Rejected
 *   entries are never approved from here — the consultant has to fix them first.
 * - Entries are patched individually and a failure on one does not stop the
 *   rest; the response names every outcome.
 */

const MAX_IDS     = 500;
const CONCURRENCY = 3;   // NetSuite concurrency-limits REST writes (429)

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { ids?: unknown };
  const ids = [...new Set(
    (Array.isArray(body.ids) ? body.ids : [])
      .map(v => Number(v))
      .filter(n => Number.isInteger(n) && n > 0),
  )];
  if (ids.length === 0)      return NextResponse.json({ error: "No time entries given" }, { status: 400 });
  if (ids.length > MAX_IDS)  return NextResponse.json({ error: `At most ${MAX_IDS} entries per approval` }, { status: 400 });

  try {
    const [current, approvedRef] = await Promise.all([
      runSuiteQLAll<{ id: string; label: string | null }>(`
        SELECT tb.id, BUILTIN.DF(tb.approvalstatus) AS label
        FROM timebill tb
        WHERE tb.id IN (${ids.join(",")})
      `),
      runSuiteQL<{ status_id: string }>(`
        SELECT tb.approvalstatus AS status_id
        FROM timebill tb
        WHERE BUILTIN.DF(tb.approvalstatus) = 'Approved'
          AND tb.trandate >= ADD_MONTHS(SYSDATE, -6)
        FETCH FIRST 1 ROW ONLY
      `),
    ]);

    const approvedId = approvedRef[0]?.status_id;
    if (!approvedId) {
      return NextResponse.json({
        error: "Could not find NetSuite's \"Approved\" status id — no approved time entries in the last 6 months to read it from.",
      }, { status: 500 });
    }

    const labelById = new Map(current.map(r => [Number(r.id), (r.label ?? "").trim()]));
    const skipped: Array<{ id: number; reason: string }> = [];
    const toApprove: number[] = [];
    for (const id of ids) {
      const label = labelById.get(id);
      if (label === undefined)                   skipped.push({ id, reason: "Not found in NetSuite" });
      else if (label.toLowerCase() === "approved") skipped.push({ id, reason: "Already approved" });
      else if (label.toLowerCase() === "rejected") skipped.push({ id, reason: "Rejected — needs correcting first" });
      else toApprove.push(id);
    }

    const approved: number[] = [];
    const failed: Array<{ id: number; error: string }> = [];
    let next = 0;
    const worker = async () => {
      while (next < toApprove.length) {
        const id = toApprove[next++];
        try {
          await patchRecord("timebill", id, { approvalStatus: { id: approvedId } });
          approved.push(id);
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : "Unknown error" });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toApprove.length) }, worker));

    console.log(`[time-entries/approve] ${session.user.email} approved ${approved.length}, skipped ${skipped.length}, failed ${failed.length}`);
    return NextResponse.json({ approved, skipped, failed });
  } catch (err) {
    console.error("[/api/time-entries/approve]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
