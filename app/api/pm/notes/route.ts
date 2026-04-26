import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

// GET /api/pm/notes?projectId=18380
// Returns all notes (internal + external) for a project — staff only
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("task_notes")
    .select("*")
    .eq("project_ns_id", projectId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

// POST /api/pm/notes
// Body: { clickupTaskId, projectNsId, body, isInternal }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clickupTaskId, projectNsId, body, isInternal } = await req.json();
  if (!clickupTaskId || !projectNsId || !body) {
    return NextResponse.json({ error: "clickupTaskId, projectNsId, body required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db.from("task_notes").insert({
    clickup_task_id: clickupTaskId,
    project_ns_id:   projectNsId,
    body,
    is_internal:     isInternal ?? false,
    author_name:     session.user.name ?? session.user.email ?? "Staff",
    author_type:     "staff",
    customer_ns_id:  null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}

// DELETE /api/pm/notes?id=uuid
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { error } = await db.from("task_notes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
