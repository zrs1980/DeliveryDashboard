import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

const DEFAULT_PHASES = [
  { name: "Phase 1 — Planning & Design", phase_number: 1, color: "#6B21A8" },
  { name: "Phase 2 — Config & Testing",  phase_number: 2, color: "#1A56DB" },
  { name: "Phase 3 — Training & UAT",    phase_number: 3, color: "#0D6E6E" },
  { name: "Phase 4 — Readiness",         phase_number: 4, color: "#92600A" },
  { name: "Phase 5 — Go Live",           phase_number: 5, color: "#0C6E44" },
  { name: "PM / Admin",                  phase_number: 0, color: "#4A5568" },
];

// GET /api/pm/projects  — all native pm_projects (active by default)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const includeArchived = req.nextUrl.searchParams.get("archived") === "true";
  const db = getSupabaseAdmin();

  let query = db.from("pm_projects").select("*").order("created_at", { ascending: false });
  if (!includeArchived) query = query.neq("status", "archived");

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach phase + task counts
  const projectIds = (data ?? []).map(p => p.id);
  if (projectIds.length > 0) {
    const { data: phases } = await db
      .from("pm_phases")
      .select("id, project_ns_id")
      .in("project_ns_id", projectIds);
    const phaseIds = (phases ?? []).map(p => p.id);
    const { data: tasks } = phaseIds.length > 0
      ? await db.from("pm_tasks").select("id, phase_id, status").in("phase_id", phaseIds)
      : { data: [] };

    const phasesForProject = new Map<string, number>();
    const tasksForProject  = new Map<string, number>();
    const doneForProject   = new Map<string, number>();

    for (const ph of phases ?? []) {
      phasesForProject.set(ph.project_ns_id, (phasesForProject.get(ph.project_ns_id) ?? 0) + 1);
    }
    for (const t of tasks ?? []) {
      const proj = (phases ?? []).find(p => p.id === t.phase_id)?.project_ns_id ?? "";
      tasksForProject.set(proj, (tasksForProject.get(proj) ?? 0) + 1);
      if (t.status === "done") doneForProject.set(proj, (doneForProject.get(proj) ?? 0) + 1);
    }

    const enriched = (data ?? []).map(p => ({
      ...p,
      phase_count: phasesForProject.get(p.id) ?? 0,
      task_count:  tasksForProject.get(p.id) ?? 0,
      done_count:  doneForProject.get(p.id) ?? 0,
    }));
    return NextResponse.json({ projects: enriched });
  }

  return NextResponse.json({ projects: data ?? [] });
}

// POST /api/pm/projects  { name, clientName, projectType, pmName, goLiveDate, budgetHours, description, nsProjectId, setupPhases }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    name, clientName, projectType, pmName,
    goLiveDate, budgetHours, description, nsProjectId, setupPhases,
  } = await req.json();

  if (!name || !clientName) {
    return NextResponse.json({ error: "name and clientName required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: project, error } = await db.from("pm_projects").insert({
    name,
    client_name:   clientName,
    project_type:  projectType ?? "Implementation",
    pm_name:       pmName ?? null,
    ns_project_id: nsProjectId ?? null,
    go_live_date:  goLiveDate || null,
    budget_hours:  budgetHours ? parseFloat(budgetHours) : null,
    description:   description ?? null,
    status:        "active",
    created_by:    session.user.name ?? session.user.email ?? "Staff",
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optionally create default 5 phases
  if (setupPhases && project) {
    for (let i = 0; i < DEFAULT_PHASES.length; i++) {
      const p = DEFAULT_PHASES[i];
      await db.from("pm_phases").insert({
        project_ns_id: project.id,
        name:          p.name,
        phase_number:  p.phase_number,
        color:         p.color,
        sort_order:    i * 10,
      });
    }
  }

  return NextResponse.json({ project });
}
