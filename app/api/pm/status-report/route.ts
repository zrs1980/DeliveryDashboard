import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { StatusReport } from "@/lib/status-report";

export const revalidate = 0;

/**
 * GET /api/pm/status-report?projectId=18380
 * Saved report history for a project, newest first. Used to reopen a draft.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("pm_status_reports")
    .select("id, week_ending, status, overall_status, created_by, updated_at")
    .eq("project_ns_id", projectId)
    .order("week_ending", { ascending: false })
    .limit(26);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] });
}

/**
 * POST /api/pm/status-report
 * Body: { projectNsId, weekEnding, content: StatusReport, status?: "draft" | "final" }
 * Upserts on (project_ns_id, week_ending) so re-saving the same week overwrites.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const content: StatusReport | undefined = body.content;
    const projectNsId: string | undefined   = body.projectNsId;
    const weekEnding: string | undefined    = body.weekEnding;
    const status: string                    = body.status === "final" ? "final" : "draft";

    if (!content || !projectNsId || !weekEnding) {
      return NextResponse.json({ error: "projectNsId, weekEnding and content are required" }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("pm_status_reports")
      .upsert({
        project_ns_id:  projectNsId,
        week_ending:    weekEnding,
        content,
        status,
        overall_status: content.recap?.overallStatus ?? null,
        created_by:     session.user.name ?? session.user.email ?? null,
      }, { onConflict: "project_ns_id,week_ending" })
      .select("id, week_ending, status, updated_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ report: data });
  } catch (err) {
    console.error("[/api/pm/status-report POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
