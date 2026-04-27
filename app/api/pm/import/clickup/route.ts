import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchListTasks } from "@/lib/clickup";
import { EMPLOYEES } from "@/lib/constants";

export const revalidate = 0;

const DEFAULT_PHASES = [
  { name: "Phase 1 — Planning & Design", phase_number: 1, color: "#6B21A8" },
  { name: "Phase 2 — Config & Testing",  phase_number: 2, color: "#1A56DB" },
  { name: "Phase 3 — Training & UAT",    phase_number: 3, color: "#0D6E6E" },
  { name: "Phase 4 — Readiness",         phase_number: 4, color: "#92600A" },
  { name: "Phase 5 — Go Live",           phase_number: 5, color: "#0C6E44" },
  { name: "PM / Admin",                  phase_number: 0, color: "#4A5568" },
];

function mapStatus(cuStatus: string): string {
  const s = cuStatus.toLowerCase();
  if (s === "done" || s === "complete" || s === "closed") return "done";
  if (s === "in progress")          return "in_progress";
  if (s === "in review")            return "in_review";
  if (s === "awaiting confirmation") return "awaiting";
  if (s === "on hold" || s === "blocked") return "blocked";
  if (s === "scheduled")            return "scheduled";
  if (s === "supplied")             return "supplied";
  return "new";
}

// POST /api/pm/import/clickup  { projectNsId, clickupListId }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectNsId, clickupListId } = await req.json();
  if (!projectNsId || !clickupListId) {
    return NextResponse.json({ error: "projectNsId and clickupListId required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();

  // Prevent double import
  const { data: existing } = await db
    .from("pm_phases")
    .select("id")
    .eq("project_ns_id", projectNsId)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "Project already has native tasks. Delete existing phases first to re-import." },
      { status: 409 },
    );
  }

  // Fetch ClickUp tasks
  let cuTasks: Awaited<ReturnType<typeof fetchListTasks>> = [];
  try {
    cuTasks = await fetchListTasks(clickupListId);
  } catch (e) {
    return NextResponse.json({ error: `ClickUp fetch failed: ${e}` }, { status: 502 });
  }

  // Create default phases
  const phaseMap = new Map<number, string>(); // phase_number → supabase uuid
  for (let i = 0; i < DEFAULT_PHASES.length; i++) {
    const p = DEFAULT_PHASES[i];
    const { data, error } = await db.from("pm_phases").insert({
      project_ns_id: projectNsId,
      name:          p.name,
      phase_number:  p.phase_number,
      color:         p.color,
      sort_order:    i * 10,
    }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    phaseMap.set(p.phase_number, data.id);
  }

  // Reverse employee lookup: ClickUp display name → NS ID
  const empByName = new Map<string, number>();
  for (const [nsId, name] of Object.entries(EMPLOYEES)) {
    empByName.set(name.toLowerCase(), parseInt(nsId));
  }

  const defaultPhaseId = phaseMap.get(1)!;
  const taskIdMap = new Map<string, string>(); // clickup id → supabase uuid
  let importedCount = 0;

  // Top-level tasks first
  const topLevel = cuTasks.filter(t => !t.parent);
  for (const ct of topLevel) {
    const a = ct.assignees?.[0];
    const assigneeNsId = a ? (empByName.get(a.username.toLowerCase()) ?? null) : null;
    const assigneeName = a?.username ?? null;

    const { data: task, error } = await db.from("pm_tasks").insert({
      phase_id:            defaultPhaseId,
      project_ns_id:       projectNsId,
      parent_task_id:      null,
      title:               ct.name,
      status:              mapStatus(ct.status?.status ?? "new"),
      priority:            "normal",
      assignee_ns_id:      assigneeNsId,
      assignee_name:       assigneeName,
      due_date:            ct.due_date ? new Date(parseInt(ct.due_date)).toISOString().slice(0, 10) : null,
      time_estimate:       ct.time_estimate ? Math.round(ct.time_estimate / 3_600_000 * 10) / 10 : null,
      time_logged:         ct.time_spent   ? Math.round(ct.time_spent   / 3_600_000 * 10) / 10 : 0,
      clickup_task_id:     ct.id,
      sort_order:          importedCount * 10,
      is_customer_visible: true,
      created_by:          session.user.name ?? "Import",
    }).select("id").single();

    if (!error && task) {
      taskIdMap.set(ct.id, task.id);
      importedCount++;
    }
  }

  // Subtasks
  const subtasks = cuTasks.filter(t => t.parent && taskIdMap.has(t.parent));
  for (const ct of subtasks) {
    const parentId = taskIdMap.get(ct.parent!)!;
    const { data: parent } = await db.from("pm_tasks").select("phase_id").eq("id", parentId).single();

    const a = ct.assignees?.[0];
    const assigneeNsId = a ? (empByName.get(a.username.toLowerCase()) ?? null) : null;

    const { data: task, error } = await db.from("pm_tasks").insert({
      phase_id:            parent?.phase_id ?? defaultPhaseId,
      project_ns_id:       projectNsId,
      parent_task_id:      parentId,
      title:               ct.name,
      status:              mapStatus(ct.status?.status ?? "new"),
      priority:            "normal",
      assignee_ns_id:      assigneeNsId,
      assignee_name:       a?.username ?? null,
      due_date:            ct.due_date ? new Date(parseInt(ct.due_date)).toISOString().slice(0, 10) : null,
      time_estimate:       ct.time_estimate ? Math.round(ct.time_estimate / 3_600_000 * 10) / 10 : null,
      time_logged:         ct.time_spent   ? Math.round(ct.time_spent   / 3_600_000 * 10) / 10 : 0,
      clickup_task_id:     ct.id,
      sort_order:          importedCount * 10,
      is_customer_visible: true,
      created_by:          session.user.name ?? "Import",
    }).select("id").single();

    if (!error && task) {
      taskIdMap.set(ct.id, task.id);
      importedCount++;
    }
  }

  return NextResponse.json({
    ok:      true,
    imported: importedCount,
    phases:  DEFAULT_PHASES.length,
    message: `Imported ${importedCount} tasks into ${DEFAULT_PHASES.length} phases. All tasks placed in Phase 1 — drag or edit to reorganise.`,
  });
}
