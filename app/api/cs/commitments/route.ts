import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

const HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";

/**
 * Commitments — who owes what to whom, by when.
 *
 * POST   record them (session-gated)
 * GET    read them   (cs_layer-gated)
 * PATCH  close one   (session-gated)
 *
 * ⚠ THE WRITE PATH IS DELIBERATELY *NOT* BEHIND `cs_layer`, AND THE READ PATH
 * IS. Same split as `/api/cs/sentiment`, for the same reason: the people who
 * know what was promised are the PMs and consultants on the call, and they must
 * not hold `cs_layer` — a risk flag reaching the delivery team is
 * self-fulfilling. They record; they never receive. Reading the book of
 * outstanding obligations is commercial context and stays behind the boundary.
 *
 * ⚠ THIS TABLE HAD NO WRITER UNTIL NOW, AND THAT WAS A LIVE BUG. `cs_commitments`
 * is read by the `owed_commitment` suppression rule, which used to report
 * `passed` on the resulting empty table — so "we owe them nothing" was asserted
 * on every draft ever generated. The rule now skips when nothing has ever been
 * recorded; this route is what lets it start passing honestly.
 */

const DIRECTIONS = ["we_owe", "they_owe"] as const;
const STATUSES   = ["open", "done", "slipped", "cancelled"] as const;

export async function GET(req: Request) {
  // Reading is commercial context — behind the boundary.
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const customerNsId = url.searchParams.get("customerNsId");
  const openOnly     = url.searchParams.get("open") === "1";

  try {
    let q = getSupabaseAdmin().from("cs_commitments").select("*");
    if (customerNsId) q = q.eq("customer_ns_id", customerNsId);
    if (openOnly)     q = q.eq("status", "open");

    const { data, error } = await q
      .order("due_date", { ascending: true, nullsFirst: false }).limit(500);
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });

    const today = new Date().toISOString().slice(0, 10);
    const rows = (data ?? []).map(c => ({
      ...c,
      // Derived, never stored — a stored "overdue" is wrong by one every
      // midnight, same as the renewal clock.
      isOverdue: Boolean(c.status === "open" && c.due_date && c.due_date < today),
    }));

    return NextResponse.json({
      commitments: rows,
      weOweOverdue: rows.filter(c => c.isOverdue && c.direction === "we_owe").length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Recording is open to whoever was on the call.
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  const items = Array.isArray(body.commitments) ? body.commitments : [];
  if (!customerNsId) {
    return NextResponse.json({ error: "customerNsId is required" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "No commitments to record" }, { status: 400 });
  }

  const rows = items
    .map(raw => {
      const c = (raw ?? {}) as Record<string, unknown>;
      const description = String(c.description ?? "").trim();
      const direction   = String(c.direction ?? "").trim();
      if (!description || !DIRECTIONS.includes(direction as typeof DIRECTIONS[number])) return null;

      const due = String(c.dueDate ?? "").trim();
      return {
        customer_ns_id: customerNsId,
        direction,
        description,
        // A date that is not a real date becomes null. "No date given" is a
        // truthful state; a coerced one makes something look overdue that never was.
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
        status: "open",
        source_type: String(body.sourceType ?? "meeting").trim() || "meeting",
        source_id:   String(body.sourceId ?? "").trim() || null,
        created_by:  session.user!.email,
        // ⚠ TRUE BECAUSE A PERSON SAW IT. These arrive from a model reading a
        // transcript, but they reach this route only after a human has reviewed
        // and kept them in the wizard. An unreviewed extraction must never be
        // written with this set — the flag is the whole difference between a
        // suggestion and a record.
        confirmed_by_human: true,
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Every commitment was missing a description or a valid direction" }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("cs_commitments").insert(rows).select();
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    return NextResponse.json({ commitments: data ?? [], written: data?.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (STATUSES.includes(String(body.status) as typeof STATUSES[number])) {
    patch.status = String(body.status);
  }
  if (typeof body.description === "string" && body.description.trim()) {
    patch.description = body.description.trim();
  }
  if (typeof body.dueDate === "string") {
    patch.due_date = /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : null;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("cs_commitments").update(patch).eq("id", id).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    if (!data)  return NextResponse.json({ error: "No commitment with that id" }, { status: 404 });
    return NextResponse.json({ commitment: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
