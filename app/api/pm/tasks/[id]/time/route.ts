import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

// POST /api/pm/tasks/[id]/time  { hours, note?, loggedDate? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { hours, note, loggedDate } = await req.json();
  if (!hours || hours <= 0) return NextResponse.json({ error: "hours must be > 0" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data: entry, error } = await db.from("pm_time_entries").insert({
    task_id:     id,
    logged_by:   session.user.name ?? session.user.email ?? "Staff",
    hours,
    note:        note ?? null,
    logged_date: loggedDate ?? new Date().toISOString().slice(0, 10),
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recompute time_logged on the task
  const { data: entries } = await db.from("pm_time_entries").select("hours").eq("task_id", id);
  const totalLogged = (entries ?? []).reduce((s, e) => s + parseFloat(String(e.hours)), 0);
  await db.from("pm_tasks").update({ time_logged: totalLogged }).eq("id", id);

  return NextResponse.json({ entry, totalLogged });
}

// DELETE /api/pm/tasks/[id]/time?entryId=uuid
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const entryId = req.nextUrl.searchParams.get("entryId");
  if (!entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { error } = await db.from("pm_time_entries").delete().eq("id", entryId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: entries } = await db.from("pm_time_entries").select("hours").eq("task_id", id);
  const totalLogged = (entries ?? []).reduce((s, e) => s + parseFloat(String(e.hours)), 0);
  await db.from("pm_tasks").update({ time_logged: totalLogged }).eq("id", id);

  return NextResponse.json({ ok: true, totalLogged });
}
