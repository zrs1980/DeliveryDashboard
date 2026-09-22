import { runSuiteQLAll } from "@/lib/netsuite";
import { getSupabaseAdmin } from "@/lib/supabase";

// ─── Seeding the pipeline from NetSuite ─────────────────────────────────────
//
// ⚠ ONLY STAGES AND OPPORTUNITIES SYNC. Contacts, tasks and activities are
// APP-ONLY and are never read from or written to NetSuite.
//
// Contacts and email history were both seeded here originally and have been
// removed deliberately, not lost. What was already imported stays — deleting
// people and correspondence nobody asked to lose would be the wrong way to
// honour "app-only" — but nothing re-imports them, and `ns_contact_id` on a
// contact is now provenance rather than a sync key.
//
// Opportunities keep syncing because a pipeline is only worth having if it
// reflects the deals NetSuite actually holds.
//
// One way throughout. Nothing here writes back: the integration has no write
// path to these records, and inventing one silently would put the ERP behind a
// dashboard. The sync also never touches a row created in this app — every
// upsert keys on the NetSuite id, which a hand-entered opportunity does not
// have.

export interface SyncResult {
  stages:        number;
  opportunities: { inserted: number; updated: number };
  lines:         number;
  warnings:      string[];
}

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s || null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** NetSuite stores quantity and netamount NEGATIVE on opportunity lines. */
const flip = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.abs(n);
};

// ─── Stages ─────────────────────────────────────────────────────────────────

/**
 * Seed the pipeline columns from NetSuite's `entitystatus` table.
 *
 * 39 rows, carrying the probability for each stage — including stages no
 * current opportunity sits in ("60 - Proposal Development", "80 - SOW
 * Creation", "90 - SOW Sent"), which is exactly what a pipeline board needs:
 * the columns should exist before a deal reaches them.
 */
async function syncStages(): Promise<number> {
  const rows = await runSuiteQLAll<Record<string, string | null>>(`
    SELECT key, name, entitytype, probability, inactive
    FROM entitystatus
  `);

  const stages = (rows ?? [])
    .filter(r => ["LEAD", "PROSPECT", "CUSTOMER"].includes(String(r.entitytype ?? "").toUpperCase()))
    .map(r => {
      const name = String(r.name ?? "");
      // NetSuite names stages "0 - Closed Lost", "30 - Estimating" — the leading
      // number is the sort order and the whole point of the board reading
      // left to right. Alphabetical would put "10 - Coordinate Discovery"
      // before "5 - Identified".
      const lead = name.match(/^\s*(\d+)\s*-/);
      const lower = name.toLowerCase();
      return {
        id:          String(r.key),
        name,
        entity_type: str(r.entitytype),
        probability: num(r.probability),
        sort_order:  lead ? Number(lead[1]) : 999,
        is_won:      lower.includes("won"),
        is_lost:     lower.includes("lost"),
        is_open:     !lower.includes("won") && !lower.includes("lost"),
        hidden:      String(r.inactive ?? "F") === "T",
      };
    });

  if (!stages.length) return 0;
  const { error } = await getSupabaseAdmin()
    .from("pm_crm_stages").upsert(stages, { onConflict: "id" });
  if (error) throw new Error(`Stages not written: ${error.message}`);
  return stages.length;
}

// ─── Opportunities ──────────────────────────────────────────────────────────

async function syncOpportunities(): Promise<{ inserted: number; updated: number; lines: number }> {
  const supabase = getSupabaseAdmin();

  const rows = await runSuiteQLAll<Record<string, string | null>>(`
    SELECT
      o.id, o.tranid, o.entity, o.title, o.memo,
      o.entitystatus,
      BUILTIN.DF(o.entitystatus)   AS stage_name,
      o.status,
      BUILTIN.DF(o.custbody5)      AS opportunity_type,
      o.projectedtotal, o.weightedtotal, o.probability,
      TO_CHAR(o.expectedclosedate, 'YYYY-MM-DD') AS expected_close,
      TO_CHAR(o.closedate,         'YYYY-MM-DD') AS close_date,
      TO_CHAR(o.trandate,          'YYYY-MM-DD') AS tran_date,
      o.daysopen,
      o.salesrep,
      BUILTIN.DF(o.salesrep)       AS owner_name,
      BUILTIN.DF(o.leadsource)     AS lead_source,
      o.custbody_primary_contact   AS primary_contact_ns_id,
      BUILTIN.DF(o.entity)         AS customer_name
    FROM opportunity o
  `);

  // Opportunities carry a primary contact on 22 of 295. It resolves only where
  // a contact still carries its NetSuite provenance id — i.e. one imported
  // before contacts became app-only. Anyone added since has no NetSuite id and
  // simply will not match, which is correct rather than a gap to paper over.
  const { data: contacts } = await supabase
    .from("pm_crm_contacts").select("id, ns_contact_id").not("ns_contact_id", "is", null);
  const contactByNs = new Map((contacts ?? []).map(c => [c.ns_contact_id as string, c.id as string]));

  const { data: before } = await supabase
    .from("pm_crm_opportunities").select("ns_opportunity_id").not("ns_opportunity_id", "is", null);
  const existing = new Set((before ?? []).map(b => b.ns_opportunity_id));

  const payload = (rows ?? []).map(r => ({
    ns_opportunity_id: String(r.id),
    ns_tranid:         str(r.tranid),
    customer_ns_id:    String(r.entity),
    customer_name:     str(r.customer_name),
    title:             str(r.title) ?? `Opportunity ${r.tranid ?? r.id}`,
    description:       str(r.memo),
    stage_id:          str(r.entitystatus),
    stage_name:        str(r.stage_name),
    status:            str(r.status),
    opportunity_type:  str(r.opportunity_type),
    // projectedtotal, NOT total. Across all 295 the former sums to $7.79M and
    // the latter to $927k, because total only fills once a deal transacts.
    projected_total:   num(r.projectedtotal),
    weighted_total:    num(r.weightedtotal),
    probability:       num(r.probability),
    expected_close:    str(r.expected_close),
    close_date:        str(r.close_date),
    tran_date:         str(r.tran_date),
    days_open:         num(r.daysopen),
    owner_ns_id:       num(r.salesrep),
    owner_name:        str(r.owner_name),
    primary_contact_id: r.primary_contact_ns_id
      ? contactByNs.get(String(r.primary_contact_ns_id)) ?? null : null,
    lead_source:       str(r.lead_source),
    source:            "netsuite",
    synced_at:         new Date().toISOString(),
  }));

  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase
      .from("pm_crm_opportunities")
      .upsert(payload.slice(i, i + 200), { onConflict: "ns_opportunity_id" });
    if (error) throw new Error(`Opportunities not written: ${error.message}`);
  }

  // ── Line detail ──────────────────────────────────────────────────────────
  const { data: saved } = await supabase
    .from("pm_crm_opportunities").select("id, ns_opportunity_id").not("ns_opportunity_id", "is", null);
  const oppByNs = new Map((saved ?? []).map(o => [o.ns_opportunity_id as string, o.id as string]));

  const lineRows = await runSuiteQLAll<Record<string, string | null>>(`
    SELECT
      tl.uniquekey, tl.transaction, tl.linesequencenumber,
      BUILTIN.DF(tl.item) AS item_name,
      tl.itemtype, tl.memo, tl.quantity, tl.rate, tl.netamount
    FROM transactionline tl
    WHERE tl.mainline = 'F'
  `);

  const lines = (lineRows ?? []).flatMap(r => {
    const oppId = oppByNs.get(String(r.transaction));
    if (!oppId) return [];
    return [{
      opportunity_id: oppId,
      ns_unique_key:  String(r.uniquekey),
      line_number:    num(r.linesequencenumber),
      item_name:      str(r.item_name),
      item_type:      str(r.itemtype),
      description:    str(r.memo),
      // Signs flipped — NetSuite stores these negative on opportunity lines.
      // A negative amount in our table means the flip was applied twice.
      quantity:       flip(r.quantity),
      rate:           num(r.rate),
      amount:         flip(r.netamount),
    }];
  });

  if (lines.length) {
    const { error } = await supabase
      .from("pm_crm_opportunity_lines").upsert(lines, { onConflict: "ns_unique_key" });
    if (error) throw new Error(`Opportunity lines not written: ${error.message}`);
  }

  const inserted = payload.filter(p => !existing.has(p.ns_opportunity_id)).length;
  return { inserted, updated: payload.length - inserted, lines: lines.length };
}

// ─── The whole sync ─────────────────────────────────────────────────────────

export async function syncCrmFromNetSuite(): Promise<SyncResult> {
  const warnings: string[] = [];

  const stages = await syncStages();
  const opps   = await syncOpportunities();

  return {
    stages,
    opportunities: { inserted: opps.inserted, updated: opps.updated },
    lines: opps.lines,
    warnings,
  };
}
