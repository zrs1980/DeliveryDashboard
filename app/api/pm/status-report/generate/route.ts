import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchProjectPhases } from "@/lib/netsuite";
import { deriveStatusReport, EMPTY_BASELINES, type Baselines } from "@/lib/status-report-derive";
import type { StatusReport } from "@/lib/status-report";
import type { Project } from "@/lib/types";

export const revalidate = 0;

/**
 * POST /api/pm/status-report/generate
 *
 * Body: { project: Project, weekEnding: "YYYY-MM-DD" }
 *
 * The client passes the Project it already holds (loaded once by /api/projects)
 * so we only need the NetSuite phase breakdown here — generating a report costs
 * one SuiteQL call rather than a full portfolio refresh.
 *
 * Returns { report, saved, previousWeekEnding }.
 *  - `saved` is a previously-saved report for this exact week, if one exists, so
 *    the wizard can offer to reopen the PM's edits instead of the fresh draft.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const project: Project | undefined = body.project;
    const weekEnding: string | undefined = body.weekEnding;

    if (!project?.id)  return NextResponse.json({ error: "project is required" }, { status: 400 });
    if (!weekEnding)   return NextResponse.json({ error: "weekEnding is required" }, { status: 400 });

    const projectNsId = String(project.id);
    const db = getSupabaseAdmin();

    // NetSuite phase budgets. Internal/native projects have no NS job — skip the query.
    const nsPhases = project.id > 0
      ? await fetchProjectPhases(project.id).catch(err => {
          console.error("[status-report/generate] fetchProjectPhases", err);
          return [];
        })
      : [];

    // Read baselines BEFORE capturing new ones, so the first report for a project
    // shows Orig. == Est. rather than a spurious "adjusted from".
    const [{ data: baselineRows }, { data: savedRows }, { data: prevRows }] = await Promise.all([
      db.from("pm_status_report_baselines").select("*").eq("project_ns_id", projectNsId),
      db.from("pm_status_reports").select("*").eq("project_ns_id", projectNsId).eq("week_ending", weekEnding).limit(1),
      db.from("pm_status_reports").select("*").eq("project_ns_id", projectNsId).lt("week_ending", weekEnding)
        .order("week_ending", { ascending: false }).limit(1),
    ]);

    const baselines: Baselines = { ...EMPTY_BASELINES, milestones: {}, phases: {} };
    for (const r of baselineRows ?? []) {
      if (r.kind === "milestone") {
        baselines.milestones[r.ref_id] = { date: r.baseline_date ?? null, label: r.label ?? null };
      } else if (r.kind === "phase") {
        baselines.phases[r.ref_id] = {
          hours: r.baseline_hours != null ? parseFloat(String(r.baseline_hours)) : null,
          label: r.label ?? null,
        };
      }
    }

    const prevReport: StatusReport | null = (prevRows?.[0]?.content as StatusReport) ?? null;

    const report = deriveStatusReport({
      project,
      nsPhases,
      baselines,
      prevReport,
      weekEnding,
      preparedBy: session.user.name ?? session.user.email ?? "Loop Services",
    });

    // Capture baselines for anything we haven't seen before. ignoreDuplicates keeps
    // the original value — this is the only record of what the plan used to say.
    const newBaselines = [
      ...report.milestones
        .filter(m => !(m.id in baselines.milestones))
        .map(m => ({
          project_ns_id: projectNsId, kind: "milestone", ref_id: m.id,
          label: m.name, baseline_date: m.estDueDate, baseline_hours: null,
        })),
      ...report.budget.rows
        .filter(r => !(r.id in baselines.phases))
        .map(r => ({
          project_ns_id: projectNsId, kind: "phase", ref_id: r.id,
          label: r.name, baseline_date: null, baseline_hours: r.allocatedHours,
        })),
    ];

    if (newBaselines.length > 0) {
      const { error } = await db
        .from("pm_status_report_baselines")
        .upsert(newBaselines, { onConflict: "project_ns_id,kind,ref_id", ignoreDuplicates: true });
      if (error) console.error("[status-report/generate] baseline capture", error.message);
    }

    return NextResponse.json({
      report,
      saved: (savedRows?.[0]?.content as StatusReport) ?? null,
      savedStatus: savedRows?.[0]?.status ?? null,
      previousWeekEnding: prevRows?.[0]?.week_ending ?? null,
    });
  } catch (err) {
    console.error("[/api/pm/status-report/generate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
