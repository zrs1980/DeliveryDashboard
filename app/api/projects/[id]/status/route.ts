import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ProjectHealth } from "@/lib/types";

const VALID: ProjectHealth[] = ["green", "yellow", "red", "unset"];

// Manually set project status. "unset" deletes the row, so the project reads
// "Not set" again. See supabase/project-status.sql.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    const { status } = (await req.json()) as { status: ProjectHealth };

    if (!Number.isFinite(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }
    if (!VALID.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    const session = await auth();
    const updatedBy = session?.user?.name ?? session?.user?.email ?? null;
    const db = getSupabaseAdmin();

    if (status === "unset") {
      const { error } = await db.from("project_status").delete().eq("ns_project_id", projectId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ health: "unset", healthSetBy: null, healthSetAt: null });
    }

    const updatedAt = new Date().toISOString();
    const { error } = await db.from("project_status").upsert({
      ns_project_id: projectId,
      status,
      updated_by:    updatedBy,
      updated_at:    updatedAt,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ health: status, healthSetBy: updatedBy, healthSetAt: updatedAt });
  } catch (err) {
    console.error("[/api/projects/[id]/status]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
