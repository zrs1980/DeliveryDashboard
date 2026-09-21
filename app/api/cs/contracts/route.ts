import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PRODUCTS, STATUSES, type ContractProduct, type ContractStatus } from "@/lib/cs-contracts";

export const revalidate = 0;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";

/**
 * Contracts are hand-entered — NetSuite has nowhere to hold them.
 *
 * Verified Sep 2026: no contract, subscription or billingschedule table exists
 * in SuiteQL, and the customer record carries no renewal date, notice period or
 * annual value. So this is a real CRUD surface rather than a sync, and the
 * renewal motion depends entirely on someone filling it in.
 *
 * `days_to_renewal` and `days_to_notice_deadline` are never stored — the spec
 * is explicit, and a stored countdown is wrong by one every midnight. See
 * renewalClock() in lib/cs-contracts.ts.
 */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dateOrNull = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

function buildRow(body: Record<string, unknown>) {
  const product = PRODUCTS.includes(body.product as ContractProduct)
    ? body.product as ContractProduct : "services";
  const status = STATUSES.includes(body.status as ContractStatus)
    ? body.status as ContractStatus : "active";

  return {
    product,
    status,
    start_date:         dateOrNull(body.start_date),
    end_date:           dateOrNull(body.end_date),
    notice_period_days: Math.max(0, Math.floor(num(body.notice_period_days) ?? 0)),
    auto_renew:         Boolean(body.auto_renew),
    annual_value:       num(body.annual_value),
    seat_count:         num(body.seat_count),
    licence_count:      num(body.licence_count),
    modules:            Array.isArray(body.modules)
                          ? body.modules.map(m => String(m).trim()).filter(Boolean) : [],
    source:             String(body.source ?? "").trim() || null,
    notes:              String(body.notes ?? "").trim() || null,
  };
}

/** GET — all contracts, or one customer's with ?customerNsId=. */
export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const customerNsId = new URL(req.url).searchParams.get("customerNsId");

  try {
    let q = getSupabaseAdmin().from("cs_contracts").select("*");
    if (customerNsId) q = q.eq("customer_ns_id", customerNsId);

    // Contracts with no end date sort last — they have no clock to run.
    const { data, error } = await q.order("end_date", { ascending: true, nullsFirst: false });
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });

    return NextResponse.json({ contracts: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/** POST — create. Requires customerNsId and customerName. */
export async function POST(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customer_ns_id = String(body.customerNsId ?? body.customer_ns_id ?? "").trim();
  const customer_name  = String(body.customerName ?? body.customer_name ?? "").trim();
  if (!customer_ns_id || !customer_name) {
    return NextResponse.json({ error: "customerNsId and customerName are required" }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("cs_contracts")
      .insert({ customer_ns_id, customer_name, ...buildRow(body) })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ contract: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/** PATCH { id, …fields } — update one. */
export async function PATCH(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("cs_contracts")
      .update(buildRow(body))
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    if (!data)  return NextResponse.json({ error: "No contract with that id" }, { status: 404 });
    return NextResponse.json({ contract: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/** DELETE ?id= — remove one. */
export async function DELETE(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const { error } = await getSupabaseAdmin().from("cs_contracts").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
