import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { buildFocus } from "@/lib/cs-focus";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveOwner } from "@/lib/cs-ownership";

export const revalidate  = 0;
export const maxDuration = 60;

/**
 * The Focus dashboard: which customers to open today, grouped by reason.
 *
 * ⚠ cs_layer-GATED. Four of its six sections are risk judgments — flags, health
 * bands, quiet-account inference, missed commitments — and a risk flag reaching
 * the delivery team is self-fulfilling. The renewal section alone is facts, and
 * those are already available without cs_layer on the customer page's Contracts
 * tab, so nothing is being withheld that someone else needs.
 *
 * Reads `cs_customer_index` — one SELECT rather than a fan-out across SuiteQL,
 * Supabase and ClickUp, which is what that table exists for. The index is
 * rebuilt nightly, so the response carries `refreshedAt` and the UI says so:
 * a stale view that looks identical to a fresh one is how stale data gets
 * trusted.
 */
export async function GET() {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  try {
    // Resolved server-side because the client has an email and the accounts
    // carry a NetSuite employee id — the roster is the only thing that joins
    // them, and it is a NetSuite read.
    const [focus, me] = await Promise.all([
      buildFocus(),
      resolveOwner(gate.session?.email),
    ]);
    return NextResponse.json({ ...focus, me });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 503 },
    );
  }
}

/**
 * Snooze one row for a stated reason.
 *
 * ⚠ THE REASON IS NOT OPTIONAL, for the same purpose dismissing a flag has
 * one: it is the only feedback on whether a section is any good. Fifty rows
 * dismissed as "not a real customer" means the gate is wrong, and without the
 * reason that signal does not exist.
 *
 * ⚠ SNOOZE, NOT DELETE. 30 days by default, and the row returns — the
 * underlying fact usually has not changed, and hiding it forever would quietly
 * shrink the book nobody is watching.
 */
export async function POST(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  const kind   = String(body.kind ?? "").trim();
  const reason = String(body.reason ?? "").trim();
  const days   = Number(body.days ?? 30);

  if (!customerNsId || !kind) {
    return NextResponse.json({ error: "customerNsId and kind are required" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({
      error: "A reason is required. It is the only signal that a section is "
           + "surfacing the wrong rows.",
    }, { status: 400 });
  }

  const until = new Date(Date.now() + Math.max(1, Math.min(365, days)) * 86_400_000);

  const { error } = await getSupabaseAdmin().from("cs_focus_snoozes").upsert({
    customer_ns_id: customerNsId,
    kind,
    reason,
    snoozed_by: gate.session!.email,
    snoozed_at: new Date().toISOString(),
    suppressed_until: until.toISOString(),
  }, { onConflict: "customer_ns_id,kind" });

  if (error) {
    return NextResponse.json({
      error: error.message,
      hint: /does not exist|schema cache/i.test(error.message)
        ? "Run supabase/focus-snooze.sql in the Supabase SQL Editor."
        : undefined,
    }, { status: 503 });
  }

  return NextResponse.json({ ok: true, until: until.toISOString() });
}
