import { NextRequest, NextResponse } from "next/server";
import { resolvePortalUser } from "@/lib/supabase-portal";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

// POST /api/portal/tasks/[id]/approve
// Customer approves / signs off a task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await resolvePortalUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectNsId, notes } = await req.json();
  if (!projectNsId) return NextResponse.json({ error: "projectNsId required" }, { status: 400 });

  const db = getSupabaseAdmin();

  // Verify access
  const { data: access } = await db
    .from("project_portal_access")
    .select("id")
    .eq("customer_ns_id", user.customer_ns_id)
    .eq("project_ns_id", projectNsId)
    .single();

  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await db.from("task_approvals").upsert({
    clickup_task_id:   taskId,
    project_ns_id:     projectNsId,
    customer_ns_id:    user.customer_ns_id,
    approved_by_name:  user.display_name ?? user.email,
    approved_by_email: user.email,
    notes:             notes ?? null,
  }, { onConflict: "clickup_task_id,customer_ns_id" }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ approval: data });
}

// DELETE /api/portal/tasks/[id]/approve (revoke approval)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await resolvePortalUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();
  const { error } = await db.from("task_approvals")
    .delete()
    .eq("clickup_task_id", taskId)
    .eq("customer_ns_id", user.customer_ns_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
