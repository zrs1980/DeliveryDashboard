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

  // Read the row before writing it, so we can tell a transition from a re-save.
  // Marking an already-completed check complete again must not add a second
  // "call held" row to the customer's timeline.
  const { data: before } = await supabase
    .from("healthchecks")
    .select("status, customer_ns_id, customer_name, quarter, consultant_name, topics")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("healthchecks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── The timeline ───────────────────────────────────────────────────────────
  // A quarterly health check is a call that actually happened with the
  // customer, and until September 2026 it left no trace anywhere except this
  // table — so the account's own page showed nothing, and the silence signals
  // counted a customer we had spoken to as one we had not.
  //
  // Best-effort: the check is already recorded as complete by this point.
  // Failing the request because the timeline write failed would tell the user
  // the call was not logged when it was. It comes back as a warning instead.
  let logWarning: string | null = null;
  const nowCompleted = data?.status === "completed" && before?.status !== "completed";
  if (nowCompleted && data?.customer_ns_id) {
    const { error: actErr } = await supabase.from("pm_crm_activities").insert({
      customer_ns_id: data.customer_ns_id,
      kind:           "call",
      direction:      "outbound",
      subject:        `${data.quarter} health check`,
      // Topics are what the call covered; notes are what came out of it. Both
      // belong on the timeline, because the point of reading it back is to
      // remember what was said, not that a box was ticked.
      body: [data.topics, data.notes].filter(Boolean).join("\n\n") || null,
      occurred_at:    data.completed_at ?? new Date().toISOString(),
      actor_email:    session.user.email,
      actor_name:     data.consultant_name ?? null,
      source:         "healthcheck",
    });
    if (actErr) logWarning = `Saved, but not added to the timeline: ${actErr.message}`;
  }

  return NextResponse.json({ healthcheck: data, logWarning });
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
