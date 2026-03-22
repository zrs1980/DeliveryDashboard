import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { id } = await params;

  const updates: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() };

  // Auto-set completed_at when marking complete
  if (body.status === "completed" && !body.completed_at) {
    updates.completed_at = new Date().toISOString();
  }
  // Auto-set status to scheduled when a date is provided
  if (body.scheduled_date && !body.status) {
    updates.status = "scheduled";
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("healthchecks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ healthcheck: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("healthchecks").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
