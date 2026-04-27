import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

// GET /api/pm/tasks?phaseId=xxx  OR  ?projectId=xxx
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const phaseId   = req.nextUrl.searchParams.get("phaseId");
  const projectId = req.nextUrl.searchParams.get("projectId");

  const db = getSupabaseAdmin();
  let query = db.from("pm_tasks").select("*").is("parent_task_id", null);

  if (phaseId)       query = query.eq("phase_id", phaseId);
  else if (projectId) query = query.eq("project_ns_id", projectId);
  else return NextResponse.json({ error: "phaseId or projectId required" }, { status: 400 });

  const { data, error } = await query.order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

// POST /api/pm/tasks
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    phaseId, projectNsId, title, description,
    status, priority, assigneeNsId, assigneeName,
    dueDate, timeEstimate, parentTaskId,
  } = await req.json();

  if (!phaseId || !projectNsId || !title) {
    return NextResponse.json({ error: "phaseId, projectNsId, title required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: existing } = await db
    .from("pm_tasks")
    .select("sort_order")
    .eq("phase_id", phaseId)
    .is("parent_task_id", parentTaskId ?? null)
    .order("sort_order", { ascending: false })
    .limit(1);

  const sortOrder = existing?.[0]?.sort_order != null ? existing[0].sort_order + 10 : 0;

  const { data, error } = await db.from("pm_tasks").insert({
    phase_id:       phaseId,
    project_ns_id:  projectNsId,
    parent_task_id: parentTaskId ?? null,
    title,
    description:    description ?? null,
    status:         status ?? "new",
    priority:       priority ?? "normal",
    assignee_ns_id: assigneeNsId ?? null,
    assignee_name:  assigneeName ?? null,
    due_date:       dueDate ?? null,
    time_estimate:  timeEstimate ?? null,
    sort_order:     sortOrder,
    created_by:     session.user.name ?? session.user.email ?? "Staff",
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
