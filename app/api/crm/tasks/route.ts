import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

const HINT = "Run supabase/crm-schema.sql in the Supabase SQL Editor.";
const TYPES    = ["todo", "call", "email", "meeting", "follow_up"] as const;
const STATUSES = ["open", "in_progress", "done", "cancelled"] as const;

/**
 * CRM tasks — entirely native.
 *
 * There is nothing to sync: NetSuite exposes no `task`, `phonecall` or
 * `calendarevent` to this integration, and its `activity` view is empty. These
 * are ours, and nothing overwrites them.
 *
 * A task may hang off a customer, a contact, an opportunity, or all three —
 * "call Jane about the renewal" is every one of those at once.
 */

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { email: session.user.email };
}

export async function GET(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const mine         = url.searchParams.get("mine") === "1";
  const customerNsId = url.searchParams.get("customerNsId");
  const opportunityId = url.searchParams.get("opportunityId");
  const includeDone  = url.searchParams.get("done") === "1";

  try {
    let q = getSupabaseAdmin().from("crm_tasks").select("*");
    if (mine)          q = q.ilike("assigned_to", gate.email);
    if (customerNsId)  q = q.eq("customer_ns_id", customerNsId);
    if (opportunityId) q = q.eq("opportunity_id", opportunityId);
    if (!includeDone)  q = q.in("status", ["open", "in_progress"]);

    // Soonest due first, and undated last — a task with no date is not urgent,
    // it is unscheduled, and sorting it to the top would bury the ones that are.
    const { data, error } = await q
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(500);

    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });

    const today = new Date().toISOString().slice(0, 10);
    const tasks = (data ?? []).map(t => ({
      ...t,
      isOverdue: Boolean(t.due_date && t.due_date < today && ["open", "in_progress"].includes(t.status)),
      isDueToday: t.due_date === today,
    }));

    return NextResponse.json({
      tasks,
      counts: {
        open:    tasks.filter(t => t.status === "open").length,
        overdue: tasks.filter(t => t.isOverdue).length,
        today:   tasks.filter(t => t.isDueToday).length,
      },
      types: TYPES, statuses: STATUSES,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  // A task attached to nothing is a note in the wrong table.
  if (!body.customerNsId && !body.contactId && !body.opportunityId) {
    return NextResponse.json({
      error: "Attach the task to a customer, contact or opportunity — an unattached task has nowhere to surface.",
    }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin().from("crm_tasks").insert({
      customer_ns_id: body.customerNsId ? String(body.customerNsId) : null,
      contact_id:     body.contactId ? String(body.contactId) : null,
      opportunity_id: body.opportunityId ? String(body.opportunityId) : null,
      title,
      notes:     String(body.notes ?? "").trim() || null,
      task_type: TYPES.includes(body.taskType as typeof TYPES[number]) ? String(body.taskType) : "todo",
      priority:  ["low", "normal", "high"].includes(String(body.priority)) ? String(body.priority) : "normal",
      status:    "open",
      due_date:  /^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate ?? "")) ? String(body.dueDate) : null,
      // Unassigned means yours — a task you created for nobody is yours.
      assigned_to: String(body.assignedTo ?? "").trim() || gate.email,
      created_by:  gate.email,
    }).select().single();

    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    return NextResponse.json({ task: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.notes === "string") patch.notes = body.notes.trim() || null;
  if (typeof body.assignedTo === "string") patch.assigned_to = body.assignedTo.trim() || null;
  if (["low", "normal", "high"].includes(String(body.priority))) patch.priority = String(body.priority);
  if (typeof body.dueDate === "string") {
    patch.due_date = /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : null;
  }
  if (STATUSES.includes(body.status as typeof STATUSES[number])) {
    patch.status = String(body.status);
    patch.completed_at = body.status === "done" ? new Date().toISOString() : null;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("crm_tasks").update(patch).eq("id", id).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    if (!data)  return NextResponse.json({ error: "No task with that id" }, { status: 404 });

    // Completing a task is account history — it belongs on the timeline, not
    // only in a status column nobody looks back at.
    if (patch.status === "done" && (data.customer_ns_id || data.opportunity_id)) {
      await supabase.from("crm_activities").insert({
        customer_ns_id: data.customer_ns_id,
        contact_id:     data.contact_id,
        opportunity_id: data.opportunity_id,
        kind: "task_done", direction: "internal",
        subject: data.title,
        occurred_at: new Date().toISOString(),
        actor_email: gate.email,
        source: "app",
      });
    }

    return NextResponse.json({ task: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
