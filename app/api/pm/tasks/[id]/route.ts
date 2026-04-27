import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

// GET /api/pm/tasks/[id] — full task detail with subtasks, time, notes
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabaseAdmin();

  const [taskRes, subtasksRes, timeRes, notesRes] = await Promise.all([
    db.from("pm_tasks").select("*").eq("id", id).single(),
    db.from("pm_tasks").select("*").eq("parent_task_id", id).order("sort_order"),
    db.from("pm_time_entries").select("*").eq("task_id", id).order("logged_date", { ascending: false }),
    db.from("task_notes").select("*").eq("clickup_task_id", id).order("created_at"),
  ]);

  if (taskRes.error) return NextResponse.json({ error: taskRes.error.message }, { status: 500 });

  return NextResponse.json({
    task:        taskRes.data,
    subtasks:    subtasksRes.data ?? [],
    timeEntries: timeRes.data ?? [],
    notes:       notesRes.data ?? [],
  });
}

// PUT /api/pm/tasks/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const update: Record<string, unknown> = {};
  if (body.title              !== undefined) update.title               = body.title;
  if (body.description        !== undefined) update.description         = body.description;
  if (body.status             !== undefined) update.status              = body.status;
  if (body.priority           !== undefined) update.priority            = body.priority;
  if (body.assigneeNsId       !== undefined) update.assignee_ns_id      = body.assigneeNsId;
  if (body.assigneeName       !== undefined) update.assignee_name       = body.assigneeName;
  if (body.dueDate            !== undefined) update.due_date            = body.dueDate;
  if (body.timeEstimate       !== undefined) update.time_estimate       = body.timeEstimate;
  if (body.phaseId            !== undefined) update.phase_id            = body.phaseId;
  if (body.isCustomerVisible  !== undefined) update.is_customer_visible = body.isCustomerVisible;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("pm_tasks")
    .update(update)
    .eq("id", id)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

// DELETE /api/pm/tasks/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabaseAdmin();
  const { error } = await db.from("pm_tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
