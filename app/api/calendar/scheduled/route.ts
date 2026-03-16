import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ taskIds: [] });

  const db = getSupabaseAdmin();
  const { data } = await db
    .from("scheduled_tasks")
    .select("task_id, task_name, scheduled_at, event_id")
    .eq("user_email", session.user.email);

  return NextResponse.json({
    taskIds: (data ?? []).map((r: { task_id: string }) => r.task_id),
    tasks: data ?? [],
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { taskId, taskName, eventId, eventStart } = await req.json();
  if (!taskId) return NextResponse.json({ error: "Missing taskId" }, { status: 400 });

  const db = getSupabaseAdmin();
  await db.from("scheduled_tasks").upsert({
    user_email:   session.user.email,
    task_id:      taskId,
    task_name:    taskName ?? "",
    event_id:     eventId ?? null,
    scheduled_at: eventStart ?? new Date().toISOString(),
  }, { onConflict: "user_email,task_id" });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "Missing taskId" }, { status: 400 });

  const db = getSupabaseAdmin();
  await db.from("scheduled_tasks")
    .delete()
    .eq("user_email", session.user.email)
    .eq("task_id", taskId);

  return NextResponse.json({ ok: true });
}
