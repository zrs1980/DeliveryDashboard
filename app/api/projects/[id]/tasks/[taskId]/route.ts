import { NextRequest, NextResponse } from "next/server";
import { patchRecord, fetchRecord } from "@/lib/netsuite";

// Count working days (Mon–Fri) from start to end inclusive
function countWorkingDays(startStr: string, endStr: string): number {
  const s = new Date(startStr + "T00:00:00");
  const e = new Date(endStr   + "T00:00:00");
  if (e < s) return 1;
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

// ─── PATCH /api/projects/[id]/tasks/[taskId] ──────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { taskId } = await params;
  const tid = parseInt(taskId, 10);
  if (isNaN(tid)) {
    return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
  }

  let body: { status?: string; startDate?: string | null; endDate?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fields: Record<string, unknown> = {};

  if (body.status !== undefined) {
    fields.status = { id: String(body.status) };
  }

  if (body.startDate !== undefined && body.endDate === undefined) {
    // Changing start date only — plain Date field in NS REST
    fields.startDate = body.startDate ?? null;
  }

  if (body.endDate !== undefined) {
    // NS ignores a direct endDate PATCH when constraintType = ASAP — it recalculates endDate
    // from startDate + ceil(estimatedWork / 8) working days.
    // Fix: set estimatedWork = workingDays(startDate → desiredEndDate) * 8 so NS produces
    // the correct endDate itself.  startDate is passed from the UI for this calculation.
    if (body.endDate && body.startDate) {
      const workDays = countWorkingDays(body.startDate, body.endDate);
      fields.estimatedWork = workDays * 8;
    } else if (body.endDate) {
      // No startDate provided — fall back to direct endDate patch (best effort)
      fields.endDate = `${body.endDate}T00:00:00Z`;
    }
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    await patchRecord("projecttask", tid, fields);
    // Read back to verify
    const after = await fetchRecord<Record<string, unknown>>("projecttask", tid);
    return NextResponse.json({
      ok: true,
      sent: fields,
      nsEndDate: after.endDate,
      nsStartDate: after.startDate,
      nsEstimatedWork: after.estimatedWork,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
