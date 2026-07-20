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
    fields.status = { id: String(body.status) };
  }

  if (body.startDate !== undefined && body.endDate === undefined) {
    // Changing start date only — plain Date field in NS REST
    fields.startDate = body.startDate ?? null;
  }

  if (body.endDate !== undefined) {
    // Budgeted/actual hours are NetSuite's to own — never derive estimatedWork from dates here.
    // NetSuite may recalculate endDate itself based on the task's constraint type; that's expected.
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
