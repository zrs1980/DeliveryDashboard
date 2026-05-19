import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

// NS projecttask date fields require MM/DD/YYYY — ISO variants are rejected
function toNsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
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
    // NS REST Record API requires select/list fields as a ref object { id: "..." }
    // body.status must be the statusRestId sourced directly from a GET of the same record
    fields.status = { id: String(body.status) };
  }
  if (body.startDate !== undefined) {
    // NS projecttask date fields accept MM/DD/YYYY (native NS format); ISO variants are rejected
    fields.startdate = body.startDate ? toNsDate(body.startDate) : null;
  }
  if (body.endDate !== undefined) {
    fields.enddate = body.endDate ? toNsDate(body.endDate) : null;
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    await patchRecord("projecttask", tid, fields);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
