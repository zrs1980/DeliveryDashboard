import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL, runSuiteQLAll, patchRecord } from "@/lib/netsuite";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * POST /api/time-entries/approve   { ids: number[] }
 *
 * Sets each time entry's approval status to Approved in NetSuite.
 *
 * - **Success is verified, not assumed.** NetSuite's REST API answers 204 to a
 *   PATCH of a field it then ignores — approvalStatus on a time entry governed by
 *   an approval workflow or a timesheet, for one. The first version trusted the
 *   204, so the dashboard showed "Approved" while NetSuite still said Pending.
 *   Every entry is now re-read after the write and only counted once NetSuite
 *   itself labels it Approved.
 * - **Two write methods, in order.** `approvalStatus` (approval routing on), then
 *   `supervisorApproval: true` (the classic "Approved" checkbox, which drives the
 *   status when routing is off) for any entry the first didn't move.
 * - **The Approved id is looked up, not hardcoded** — read off entries NetSuite
 *   already labels Approved. Patching a wrong id would mis-file every entry.
 * - **Current status is re-read here**, not trusted from the browser: approved
 *   entries are skipped and rejected ones are never approved from here.
 * - Entries are patched individually; one failure does not stop the rest, and
 *   the response names every outcome.
 */

const MAX_IDS     = 500;
const CONCURRENCY = 3;   // NetSuite concurrency-limits REST writes (429)

type Outcome = { id: number; error: string };

async function readLabels(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await runSuiteQLAll<{ id: string; label: string | null }>(`
    SELECT tb.id, BUILTIN.DF(tb.approvalstatus) AS label
    FROM timebill tb
    WHERE tb.id IN (${ids.join(",")})
  `);
  return new Map(rows.map(r => [Number(r.id), (r.label ?? "").trim()]));
}

const isApprovedLabel = (l: string | undefined) => (l ?? "").toLowerCase() === "approved";

/** PATCH each id with `fields`, CONCURRENCY at a time. Returns the ids NetSuite rejected, with why. */
async function patchAll(ids: number[], fields: Record<string, unknown>): Promise<Map<number, string>> {
  const errors = new Map<number, string>();
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        await patchRecord("timebill", id, fields);
      } catch (err) {
        errors.set(id, err instanceof Error ? err.message : "Unknown error");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  return errors;
}

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
    const [labelById, approvedRef] = await Promise.all([
      readLabels(ids),
      runSuiteQL<{ status_id: string }>(`
        SELECT tb.approvalstatus AS status_id
        FROM timebill tb
        WHERE BUILTIN.DF(tb.approvalstatus) = 'Approved'
          AND tb.trandate >= ADD_MONTHS(SYSDATE, -6)
        FETCH FIRST 1 ROW ONLY
      `),
    ]);
    const approvedId = approvedRef[0]?.status_id;

    const skipped: Array<{ id: number; reason: string }> = [];
    const pending: number[] = [];
    for (const id of ids) {
      const label = labelById.get(id);
      if (label === undefined)                     skipped.push({ id, reason: "Not found in NetSuite" });
      else if (isApprovedLabel(label))             skipped.push({ id, reason: "Already approved" });
      else if (label.toLowerCase() === "rejected") skipped.push({ id, reason: "Rejected — needs correcting first" });
      else pending.push(id);
    }

    // ── Method 1: approvalStatus ──
    const errors1 = approvedId
      ? await patchAll(pending, { approvalStatus: { id: approvedId } })
      : new Map<number, string>();
    const after = await readLabels(pending);
    let remaining = pending.filter(id => !isApprovedLabel(after.get(id)));

    // ── Method 2: supervisorApproval, for whatever method 1 didn't move ──
    const errors2 = await patchAll(remaining, { supervisorApproval: true });
    if (remaining.length) {
      const again = await readLabels(remaining);
      for (const [id, l] of again) after.set(id, l);
      remaining = remaining.filter(id => !isApprovedLabel(after.get(id)));
    }

    const approved = pending.filter(id => isApprovedLabel(after.get(id)));
    const failed: Outcome[] = remaining.map(id => {
      const nsError = errors2.get(id) ?? errors1.get(id);
      const now     = after.get(id) || "unknown";
      return {
        id,
        error: nsError
          ? nsError
          : `NetSuite accepted the update but the entry is still "${now}". ` +
            `Its approval is probably controlled by an approval workflow or timesheet that the API can't override — approve it in NetSuite.`,
      };
    });

    console.log(
      `[time-entries/approve] ${session.user.email}: approved ${approved.length}, skipped ${skipped.length}, failed ${failed.length}` +
      (failed.length ? ` — first failure: ${failed[0].error}` : ""),
    );
    return NextResponse.json({ approved, skipped, failed });
  } catch (err) {
    console.error("[/api/time-entries/approve]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
