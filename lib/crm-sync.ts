import { runSuiteQLAll } from "@/lib/netsuite";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchCustomerProjectIndex } from "@/lib/cs-customers";

// ─── Seeding the CRM from NetSuite ──────────────────────────────────────────
//
// One way, NetSuite → here. Nothing in this app writes back: the integration
// has no write path to contacts or opportunities, and inventing one silently
// would put the ERP behind a dashboard.
//
// ⚠ THE SYNC NEVER TOUCHES A ROW CREATED IN THIS APP. Every upsert is keyed on
// the NetSuite id and every delete is scoped to `source = 'netsuite'`. A
// contact or opportunity someone added here has no NetSuite id, so it cannot
// be matched, overwritten or pruned. That is the whole contract — a CRM that
// silently eats hand-entered work is worse than no CRM.

export interface SyncResult {
  stages:       number;
  contacts:     { inserted: number; updated: number; skippedNoCompany: number };
  opportunities:{ inserted: number; updated: number };
  lines:        number;
  activities:   number;
  warnings:     string[];
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

  const wanted = (rows ?? []).filter(r =>
    ["LEAD", "PROSPECT", "CUSTOMER"].includes(String(r.entitytype ?? "").toUpperCase()));

  const stages = wanted.map(r => {
    const name = String(r.name ?? "");
    // NetSuite names stages "0 - Closed Lost", "30 - Estimating" — the leading
    // number is the sort order and the whole point of the board's left-to-right
    // reading. Parse it rather than sorting alphabetically, which would put
    // "10 - Coordinate Discovery" before "5 - Identified".
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
    .from("crm_stages").upsert(stages, { onConflict: "id" });
  if (error) throw new Error(`Stages not written: ${error.message}`);
  return stages.length;
}

// ─── Contacts ───────────────────────────────────────────────────────────────

async function syncContacts(): Promise<SyncResult["contacts"] & { warnings: string[] }> {
  const warnings: string[] = [];
  const supabase = getSupabaseAdmin();

  const rows = await runSuiteQLAll<Record<string, string | null>>(`
    SELECT
      c.id, c.entityid, c.firstname, c.lastname, c.email, c.title,
      c.phone, c.mobilephone, c.officephone, c.company, c.isinactive,
      TO_CHAR(c.datecreated, 'YYYY-MM-DD')      AS created,
      TO_CHAR(c.lastmodifieddate, 'YYYY-MM-DD') AS modified
    FROM contact c
    WHERE c.isinactive = 'F'
  `);

  // contact.company is a customer id in 836 of 837 cases. Exactly one points at
  // a job (a test record), and a plain JOIN would drop it silently — so it is
  // resolved the same way support cases are, rather than being lost.
  let index: Awaited<ReturnType<typeof fetchCustomerProjectIndex>> | null = null;
  try { index = await fetchCustomerProjectIndex(); }
  catch { warnings.push("Project index unavailable; contacts pointing at a job were skipped."); }

  let skippedNoCompany = 0;
  const payload: Array<Record<string, unknown>> = [];

  for (const r of rows ?? []) {
    const company = str(r.company);
    if (!company) { skippedNoCompany++; continue; }   // 177 contacts have none

    const customerNsId = index?.byProject[company]?.customerNsId ?? company;

    const first = str(r.firstname);
    const last  = str(r.lastname);
    // `entityid` is not a reliable display name — it is sometimes just a number
    // ("51"), and `fullname` is prefixed with it ("51 Marquez, Catherine").
    const name = [first, last].filter(Boolean).join(" ") || str(r.entityid) || `Contact ${r.id}`;

    payload.push({
      ns_contact_id:  String(r.id),
      customer_ns_id: customerNsId,
      name,
      first_name:     first,
      last_name:      last,
      email:          str(r.email),
      job_title:      str(r.title),
      phone:          str(r.phone) ?? str(r.officephone),
      mobile:         str(r.mobilephone),
      is_active:      true,
      first_seen_at:  r.created ? `${r.created}T00:00:00Z` : null,
      source:         "netsuite",
      synced_at:      new Date().toISOString(),
      // role is deliberately NOT set from NetSuite. contact.contactrole is
      // populated on 26 of 1,014 and its values (-10/-20/-30/-40) have no
      // resolvable labels — importing them would mean 26 unlabelled numbers
      // and 988 blanks. The column keeps its 'unknown' default and is filled in
      // by a person, which is the only way it becomes worth anything.
    });
  }

  const { data: before } = await supabase
    .from("cs_contacts").select("ns_contact_id").not("ns_contact_id", "is", null);
  const existing = new Set((before ?? []).map(b => b.ns_contact_id));

  // Chunked: 949 rows in one upsert is fine, but this grows with the account.
  let written = 0;
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    const { error } = await supabase
      .from("cs_contacts").upsert(chunk, { onConflict: "ns_contact_id" });
    if (error) throw new Error(`Contacts not written: ${error.message}`);
    written += chunk.length;
  }

  const inserted = payload.filter(p => !existing.has(p.ns_contact_id as string)).length;
  return { inserted, updated: written - inserted, skippedNoCompany, warnings };
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

  // Map NetSuite contact ids to our rows, so primary_contact_id resolves.
  const { data: contacts } = await supabase
    .from("cs_contacts").select("id, ns_contact_id").not("ns_contact_id", "is", null);
  const contactByNs = new Map((contacts ?? []).map(c => [c.ns_contact_id as string, c.id as string]));

  const { data: before } = await supabase
    .from("crm_opportunities").select("ns_opportunity_id").not("ns_opportunity_id", "is", null);
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
      .from("crm_opportunities")
      .upsert(payload.slice(i, i + 200), { onConflict: "ns_opportunity_id" });
    if (error) throw new Error(`Opportunities not written: ${error.message}`);
  }

  // ── Line detail ──────────────────────────────────────────────────────────
  const { data: saved } = await supabase
    .from("crm_opportunities").select("id, ns_opportunity_id").not("ns_opportunity_id", "is", null);
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
      // Signs flipped — see the note in crm-schema.sql. A negative amount in
      // this table means the flip was applied twice.
      quantity:       flip(r.quantity),
      rate:           num(r.rate),
      amount:         flip(r.netamount),
    }];
  });

  if (lines.length) {
    const { error } = await supabase
      .from("crm_opportunity_lines").upsert(lines, { onConflict: "ns_unique_key" });
    if (error) throw new Error(`Opportunity lines not written: ${error.message}`);
  }

  const inserted = payload.filter(p => !existing.has(p.ns_opportunity_id)).length;
  return { inserted, updated: payload.length - inserted, lines: lines.length };
}

// ─── Email history ──────────────────────────────────────────────────────────

/**
 * Seed the activity timeline from NetSuite's `message` table.
 *
 * 4,548 emails, 4,310 of them linked to a customer — real correspondence
 * history, available without adding a Gmail read scope. The app can already
 * SEND as the signed-in user; READING Gmail needs `gmail.readonly`, which
 * invalidates every session and forces everyone to sign in again. This gets the
 * history for free and outbound sent from the app is logged at send time, so
 * the timeline stays current.
 *
 * ⚠ NetSuite hangs these off the CUSTOMER, not the contact — 4,310 against 9 —
 * so there is no per-contact history in the seed, only per-account.
 */
async function syncEmailHistory(customerIds: Set<string>): Promise<number> {
  const supabase = getSupabaseAdmin();

  const rows = await runSuiteQLAll<Record<string, string | null>>(`
    SELECT
      m.id, m.entity, m.subject, m.message, m.authoremail, m.recipientemail,
      m.incoming, m.internalonly,
      TO_CHAR(m.messagedate, 'YYYY-MM-DD') AS message_date
    FROM message m
    WHERE m.entity IS NOT NULL
      AND m.messagetype = 'EMAIL'
  `);

  const payload = (rows ?? []).flatMap(r => {
    const cid = String(r.entity);
    // Only messages against a known customer. The rest hang off employees and
    // other entity types and are not account history.
    if (!customerIds.has(cid)) return [];
    const when = r.message_date ? `${r.message_date}T00:00:00Z` : null;
    if (!when) return [];

    return [{
      customer_ns_id: cid,
      kind:           "email" as const,
      direction:      String(r.incoming ?? "F") === "T" ? "inbound" as const : "outbound" as const,
      subject:        str(r.subject) ?? "(no subject)",
      // Bodies are full email text including quoted threads. Truncated hard —
      // this is a timeline, and the whole message is a click away in NetSuite.
      body:           (str(r.message) ?? "").slice(0, 2000) || null,
      occurred_at:    when,
      actor_email:    str(r.authoremail),
      source:         "netsuite" as const,
      ns_message_id:  String(r.id),
    }];
  });

  let written = 0;
  for (let i = 0; i < payload.length; i += 300) {
    const { error } = await supabase
      .from("crm_activities")
      .upsert(payload.slice(i, i + 300), { onConflict: "ns_message_id" });
    if (error) throw new Error(`Email history not written: ${error.message}`);
    written += Math.min(300, payload.length - i);
  }
  return written;
}

// ─── The whole sync ─────────────────────────────────────────────────────────

export async function syncCrmFromNetSuite(opts: { withEmail?: boolean } = {}): Promise<SyncResult> {
  const warnings: string[] = [];

  const stages = await syncStages();
  const contacts = await syncContacts();
  warnings.push(...contacts.warnings);
  if (contacts.skippedNoCompany) {
    warnings.push(
      `${contacts.skippedNoCompany} contacts have no company in NetSuite and were skipped — ` +
      `a contact with no account cannot be filed against one.`,
    );
  }

  const opps = await syncOpportunities();

  let activities = 0;
  if (opts.withEmail !== false) {
    const { data: idx } = await getSupabaseAdmin()
      .from("cs_customer_index").select("customer_ns_id");
    const ids = new Set((idx ?? []).map(r => r.customer_ns_id as string));
    if (!ids.size) {
      warnings.push(
        "Customer index is empty, so email history was skipped — run the index build first.",
      );
    } else {
      activities = await syncEmailHistory(ids);
    }
  }

  return {
    stages,
    contacts: {
      inserted: contacts.inserted,
      updated: contacts.updated,
      skippedNoCompany: contacts.skippedNoCompany,
    },
    opportunities: { inserted: opps.inserted, updated: opps.updated },
    lines: opps.lines,
    activities,
    warnings,
  };
}
