import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

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
    // startDate is a plain Date field in NS REST — YYYY-MM-DD
    fields.startDate = body.startDate ?? null;
  }
  if (body.endDate !== undefined) {
    // endDate is a LocalDateTime field — NS returns/expects ISO 8601 UTC e.g. "2026-05-22T00:00:00Z"
    fields.endDate = body.endDate ? `${body.endDate}T00:00:00Z` : null;
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
