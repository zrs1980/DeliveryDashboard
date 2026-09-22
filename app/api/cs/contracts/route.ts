import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchNsContracts, currentContractByCustomer } from "@/lib/cs-ns-contracts";

export const revalidate  = 0;
export const maxDuration = 60;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";

/**
 * Contracts are READ FROM NETSUITE, not entered here.
 *
 * They live in the Contract Renewals SuiteApp as CUSTOMRECORD_CONTRACTS — see
 * lib/cs-ns-contracts.ts for how that was missed the first time round. Terms,
 * dates, values and status are NetSuite's; this route does not write them, and
 * editing them here would create a second truth that silently drifts from the
 * renewal process the business actually runs on.
 *
 * ⚠ THE ONE THING NETSUITE DOES NOT CARRY IS A CONTRACTUAL NOTICE PERIOD.
 *
 * `custrecord_swe_days_b4_renewal` looks like one and is not: it reads 358 on
 * every contract in the account, so it is a SuiteApp setting for when to raise
 * the renewal transaction, not a per-contract term. Using it as a notice period
 * would produce confident, wrong deadlines — which is worse than none, because
 * the whole point of the renewal clock is that the notice date is the real one.
 *
 * So notice period is a local annotation, stored in `cs_contracts` keyed by
 * `source = 'netsuite:<id>'`. Until one is entered, the countdown runs to the
 * END date and says so rather than inventing a notice window.
 */

interface Overlay { id: string; notice_period_days: number; notes: string | null }

export async function GET() {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  try {
    const [nsContracts, { data: overlays, error }] = await Promise.all([
      fetchNsContracts(),
      getSupabaseAdmin().from("cs_contracts").select("id, source, notice_period_days, notes"),
    ]);

    // A failed overlay read must not silently drop everyone's notice periods and
    // quietly move every deadline later.
    if (error) {
      return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    }

    const bySource: Record<string, Overlay> = {};
    for (const o of overlays ?? []) {
      if (o.source?.startsWith("netsuite:")) {
        bySource[o.source] = { id: o.id, notice_period_days: o.notice_period_days ?? 0, notes: o.notes };
      }
    }

    const contracts = nsContracts.map(c => {
      const ov = bySource[`netsuite:${c.nsContractId}`];
      return {
        ...c,
        noticePeriodDays: ov?.notice_period_days ?? null,
        localNotes:       ov?.notes ?? null,
        overlayId:        ov?.id ?? null,
      };
    });

    const current = currentContractByCustomer(nsContracts);

    return NextResponse.json({
      contracts,
      currentByCustomer: Object.fromEntries(
        Object.entries(current).map(([cid, c]) => [cid, c.nsContractId]),
      ),
      source: "netsuite:CUSTOMRECORD_CONTRACTS",
      noticePeriodsSet: contracts.filter(c => c.noticePeriodDays !== null).length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/**
 * PATCH { nsContractId, noticePeriodDays?, notes? } — the local annotation only.
 *
 * Deliberately cannot touch dates, values or status: those are NetSuite's.
 */
export async function PATCH(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { nsContractId?: string; noticePeriodDays?: number; notes?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const nsContractId = String(body.nsContractId ?? "").trim();
  if (!nsContractId) return NextResponse.json({ error: "nsContractId is required" }, { status: 400 });

  try {
    const ns = (await fetchNsContracts()).find(c => c.nsContractId === nsContractId);
    if (!ns) return NextResponse.json({ error: "No NetSuite contract with that id" }, { status: 404 });

    const source = `netsuite:${nsContractId}`;
    const supabase = getSupabaseAdmin();

    const { data: existing } = await supabase
      .from("cs_contracts").select("id").eq("source", source).maybeSingle();

    // The row mirrors enough of the NetSuite record to be readable on its own,
    // but NetSuite remains authoritative — a sync overwrites these, the notice
    // period and notes survive.
    const row = {
      customer_ns_id: ns.customerNsId,
      customer_name:  ns.customerName,
      product:        "netsuite" as const,
      start_date:     ns.startDate,
      end_date:       ns.endDate,
      notice_period_days: Math.max(0, Math.floor(Number(body.noticePeriodDays ?? 0))),
      auto_renew:     true,   // Contract Renewals generates a renewal by default
      annual_value:   ns.annualValue,
      status:         ns.status === "active" ? "active" as const : "renewed" as const,
      source,
      notes:          typeof body.notes === "string" ? body.notes.trim() || null : undefined,
    };

    const { data, error } = existing
      ? await supabase.from("cs_contracts").update(row).eq("id", existing.id).select().single()
      : await supabase.from("cs_contracts").insert(row).select().single();

    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ contract: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
