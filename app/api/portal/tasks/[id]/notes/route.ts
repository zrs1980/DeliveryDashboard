import { NextRequest, NextResponse } from "next/server";
import { resolvePortalUser } from "@/lib/supabase-portal";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

// POST /api/portal/tasks/[id]/notes
// Customer adds a comment to a task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await resolvePortalUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { body, projectNsId } = await req.json();
  if (!body || !projectNsId) {
    return NextResponse.json({ error: "body and projectNsId required" }, { status: 400 });
  }

  // Verify customer has access to this project
  const db = getSupabaseAdmin();
  const { data: access } = await db
    .from("project_portal_access")
    .select("id")
    .eq("customer_ns_id", user.customer_ns_id)
    .eq("project_ns_id", projectNsId)
    .single();

  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await db.from("task_notes").insert({
    clickup_task_id: taskId,
    project_ns_id:   projectNsId,
    body,
    is_internal:     false,
    author_name:     user.display_name ?? user.email,
    author_type:     "customer",
    customer_ns_id:  user.customer_ns_id,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}
