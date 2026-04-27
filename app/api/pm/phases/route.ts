import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

// GET /api/pm/phases?projectId=18380
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data: phases, error } = await db
    .from("pm_phases")
    .select("*, pm_tasks(*)")
    .eq("project_ns_id", projectId)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sorted = (phases ?? []).map(p => ({
    ...p,
    pm_tasks: (p.pm_tasks ?? [])
      .filter((t: any) => !t.parent_task_id)
      .sort((a: any, b: any) => a.sort_order - b.sort_order),
  }));

  return NextResponse.json({ phases: sorted });
}

// POST /api/pm/phases  { projectNsId, name, phaseNumber?, color? }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectNsId, name, phaseNumber, color } = await req.json();
  if (!projectNsId || !name) {
    return NextResponse.json({ error: "projectNsId and name required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: existing } = await db
    .from("pm_phases")
    .select("sort_order")
    .eq("project_ns_id", projectNsId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const sortOrder = existing?.[0]?.sort_order != null ? existing[0].sort_order + 10 : 0;

  const { data, error } = await db.from("pm_phases").insert({
    project_ns_id: projectNsId,
    name,
    phase_number:  phaseNumber ?? null,
    color:         color ?? null,
    sort_order:    sortOrder,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ phase: data });
}
