// ─── The whole customer, in one place ────────────────────────────────────────
//
// Assembles everything this application knows about one customer: identity,
// people, deals, tasks, timeline, projects, contracts — and, only for a
// cs_layer reader, the profile, health and flags.
//
// ⚠ SERVER ONLY.
//
// ─── Why one assembler and not six fetches ──────────────────────────────────
//
// Nothing in this codebase could previously answer "everything about this
// customer". `CrmAccountPage` assembled an account from four routes; the CS
// panel assembled the same account from four different ones; no `Cs*`
// component called `/api/crm/*` and no `Crm*` component called `/api/cs/*`. So
// the same customer had two pages that could not see each other, and the only
// thing rendered twice was the contract — by two different components.
//
// ─── The cs_layer boundary is a TYPE boundary here ──────────────────────────
//
// `CustomerRecord.cs` is optional and is simply ABSENT for a reader without
// cs_layer — not zeroed, not hidden, not sent-and-not-rendered. A component
// handed a record without it cannot leak a health band, because it was never
// given one. Same reasoning as `CustomerFacingPack` in lib/cs-qbr.ts: "remember
// not to render that field" is not a safeguard.
//
// Contracts sit OUTSIDE that boundary, deliberately. The CS boundary contains
// JUDGMENTS — scores, bands, churn flags. A contract's dates, term, value and
// notice deadline are FACTS needed for ordinary commercial work, and the CRM
// module already draws that line. `cs_contracts.notes` is CS-authored
// commentary and stays inside.

import { getSupabaseAdmin } from "@/lib/supabase";
import { runSuiteQL } from "@/lib/netsuite";
import { fetchNsContracts, currentContractByCustomer, type NsContract } from "@/lib/cs-ns-contracts";
import { renewalClock } from "@/lib/cs-contracts";
import { isLocalAccountId, localUuidOf } from "@/lib/crm-accounts";

export interface CustomerIdentity {
  id:           string | null;   // customers.id — null until customers.sql has run
  key:          string;          // what every customer_ns_id column holds
  nsId:         string | null;
  isLocal:      boolean;
  isActive:     boolean;
  name:         string;
  entityid:     string | null;
  email:        string | null;
  phone:        string | null;
  website:      string | null;
  industry:     string | null;
  stage:        string | null;
  entitystatusLabel: string | null;
  subsidiaryId: number | null;
  billingAddress:  string | null;
  shippingAddress: string | null;
  netsuiteUrl:  string | null;
}

export interface CustomerProjectSummary {
  id:         string;
  entityid:   string | null;
  name:       string;
  status:     string | null;
  type:       string | null;
  goLiveDate: string | null;
  budgetHours:    number | null;
  remainingHours: number | null;
}

export interface CustomerContract {
  id:             string;
  name:           string | null;
  status:         string | null;
  startDate:      string | null;
  endDate:        string | null;
  annualValue:    number | null;
  noticePeriodDays: number | null;
  daysToRenewal:  number | null;
  /** Days to the NOTICE date, which is the real deadline — not the end date. */
  daysToNotice:   number | null;
  noticeDeadline: string | null;
  /** Past notice but not yet ended. On an auto-renew contract: already committed. */
  noticePassed:   boolean;
  alertBand:      120 | 90 | 60 | 30 | null;
  expired:        boolean;
  /**
   * True when no notice period is recorded, so the clock runs to the END date.
   * NetSuite carries no notice period at all — `custrecord_swe_days_b4_renewal`
   * reads 358 on every contract in the account, making it a SuiteApp setting
   * rather than a term. An unlabelled countdown would look like a real
   * deadline, so the caller must say so in words.
   */
  noticeIsEndDate: boolean;
}

export interface CustomerCsBlock {
  healthScore:  number | null;
  healthBand:   string | null;
  openFlags:    { id: string; rule_id: string; severity: string | null; summary: string | null; created_at: string }[];
  profile:      Record<string, unknown> | null;
  profileVerified: boolean;
  drafts:       { id: string; motion: string; subject: string | null; status: string; created_at: string }[];
}

export interface CustomerRecord {
  customer:      CustomerIdentity;
  projects:      CustomerProjectSummary[];
  contacts:      Record<string, unknown>[];
  opportunities: Record<string, unknown>[];
  tasks:         Record<string, unknown>[];
  activities:    Record<string, unknown>[];
  contracts:     CustomerContract[];
  currentContract: CustomerContract | null;
  /** Present ONLY for a cs_layer reader. Absent — not null — for everyone else. */
  cs?:           CustomerCsBlock;
  warnings:      string[];
}

const NS_CUSTOMER_URL = "https://system.na1.netsuite.com/app/common/entity/custjob.nl?id=";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s || null;
};

/**
 * Resolve whatever the caller has — a NetSuite id, a `local:<uuid>` key, or a
 * `customers.id` uuid — to the key every other table is written against.
 *
 * Three forms rather than one because the callers genuinely differ: the CRM
 * list holds keys, a link from the projects table holds a NetSuite id, and
 * anything built after slice 2 will hold the uuid. Making them all work costs
 * one lookup and removes an entire class of "why is this page empty".
 */
export async function resolveCustomerKey(
  idOrKey: string,
): Promise<{ key: string; id: string | null } | null> {
  const supabase = getSupabaseAdmin();

  // A bare uuid can only be customers.id — `local:` keys carry their prefix.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
  const { data } = isUuid
    ? await supabase.from("customers").select("id, key, merged_into").eq("id", idOrKey).maybeSingle()
    : await supabase.from("customers").select("id, key, merged_into").eq("key", idOrKey).maybeSingle();

  if (data) {
    // A merged local account resolves to the NetSuite row that took it over,
    // so an old bookmark lands on the live account rather than a retired shell.
    if (data.merged_into) {
      const { data: target } = await supabase
        .from("customers").select("id, key").eq("id", data.merged_into).maybeSingle();
      if (target) return { key: target.key, id: target.id };
    }
    return { key: data.key, id: data.id };
  }

  // No customers row. That is not a dead end: supabase/customers.sql may simply
  // not have been run yet, and a NetSuite id is still perfectly usable as a key.
  if (isUuid) return null;
  return { key: idOrKey, id: null };
}

/** Identity, read live from NetSuite. Null for a local account — it isn't there. */
async function fetchNsIdentity(nsId: string) {
  const rows = await runSuiteQL<Record<string, string | null>>(`
    SELECT
      c.id, c.entityid, c.companyname, c.email, c.phone, c.url, c.isinactive,
      c.subsidiary, c.stage,
      BUILTIN.DF(c.entitystatus) AS entitystatus_label,
      BUILTIN.DF(c.custentity_esc_industry) AS industry,
      BUILTIN.DF(c.defaultbillingaddress)  AS billing_address,
      BUILTIN.DF(c.defaultshippingaddress) AS shipping_address
    FROM customer c WHERE c.id = ?
  `, [Number(nsId)]);
  return rows?.[0] ?? null;
}

/**
 * The customer's projects, straight from `job`.
 *
 * Deliberately NOT `/api/projects`: that route fans out to ClickUp once per
 * project across the whole portfolio, which is far too heavy for one account's
 * drill-down. Same reasoning as `/api/projects/folders` existing separately.
 */
async function fetchCustomerProjects(nsId: string): Promise<CustomerProjectSummary[]> {
  const rows = await runSuiteQL<Record<string, string | null>>(`
    SELECT
      j.id, j.entityid, j.companyname,
      BUILTIN.DF(j.entitystatus) AS status,
      BUILTIN.DF(j.jobtype)      AS job_type,
      TO_CHAR(j.custentity_project_golive_date, 'YYYY-MM-DD') AS golive_date,
      j.custentity_ceba_project_budget_hours AS budget_hours,
      j.custentity_project_remaining_hours   AS remaining_hours
    FROM job j WHERE j.customer = ?
    ORDER BY j.id DESC
  `, [Number(nsId)]);

  return (rows ?? []).map(r => ({
    id:         String(r.id),
    entityid:   str(r.entityid),
    name:       r.companyname || str(r.entityid) || String(r.id),
    status:     str(r.status),
    type:       str(r.job_type),
    goLiveDate: str(r.golive_date),
    budgetHours:    num(r.budget_hours),
    remainingHours: num(r.remaining_hours),
  }));
}

function toContract(c: NsContract, noticeDays: number | null): CustomerContract {
  // `notice_period_days` is non-nullable on CsContract; 0 is what "none
  // recorded" means there, and renewalClock() then runs the countdown to the
  // end date — which is why noticeIsEndDate exists to label it.
  const clock = renewalClock({ end_date: c.endDate, notice_period_days: noticeDays ?? 0 });
  return {
    id:          c.nsContractId,
    name:        c.name,
    status:      c.statusLabel,
    startDate:   c.startDate,
    endDate:     c.endDate,
    annualValue: c.annualValue,
    noticePeriodDays: noticeDays,
    daysToRenewal:  clock.daysToRenewal,
    daysToNotice:   clock.daysToNotice,
    noticeDeadline: clock.noticeDeadline,
    noticePassed:   clock.noticePassed,
    alertBand:      clock.alertBand,
    expired:        clock.expired,
    noticeIsEndDate: noticeDays === null || noticeDays === 0,
  };
}

/**
 * Everything about one customer.
 *
 * `csLayer` decides whether the `cs` block exists at all. The caller passes the
 * answer rather than this function asking, because the route already had to ask
 * to gate itself and asking twice invites the two answers to differ.
 */
export async function fetchCustomerRecord(
  key: string,
  customerId: string | null,
  csLayer: boolean,
): Promise<CustomerRecord | null> {
  const supabase = getSupabaseAdmin();
  const warnings: string[] = [];
  const local = isLocalAccountId(key);

  // ─── Identity ─────────────────────────────────────────────────────────────
  let identity: CustomerIdentity;

  if (local) {
    const uuid = localUuidOf(key);
    const { data: a } = await supabase
      .from("pm_crm_accounts").select("*").eq("id", uuid).maybeSingle();
    if (!a) return null;
    identity = {
      id: customerId, key, nsId: null, isLocal: true,
      isActive: !a.linked_ns_id,
      name: a.name,
      entityid: null,
      email:   a.email ?? null,
      phone:   a.phone ?? null,
      website: a.website ?? a.domain ?? null,
      industry: a.industry ?? null,
      stage: a.stage ?? "PROSPECT",
      entitystatusLabel: null,
      subsidiaryId: a.subsidiary_id ?? null,
      // One free-text block, matching the NetSuite side — see pm-crm-accounts.sql.
      billingAddress: a.address ?? null,
      shippingAddress: null,
      // ⚠ NEVER a NetSuite link for a local account. `custjob.nl?id=local:<uuid>`
      // is a dead page that asserts, with the authority of a working link, that
      // the account is in NetSuite.
      netsuiteUrl: null,
    };
  } else {
    const r = await fetchNsIdentity(key);
    if (!r) return null;
    identity = {
      id: customerId, key, nsId: key, isLocal: false,
      isActive: r.isinactive !== "T",
      name: r.companyname || str(r.entityid) || key,
      entityid: str(r.entityid),
      email:   str(r.email),
      phone:   str(r.phone),
      website: str(r.url),
      industry: str(r.industry),
      stage: str(r.stage),
      entitystatusLabel: str(r.entitystatus_label),
      subsidiaryId: num(r.subsidiary),
      billingAddress:  str(r.billing_address),
      shippingAddress: str(r.shipping_address),
      netsuiteUrl: NS_CUSTOMER_URL + key,
    };
  }

  // ─── The CRM side ─────────────────────────────────────────────────────────
  // Still queried by `customer_ns_id`, not `customer_id`. Slice 2's column is
  // additive and its backfill may not have run on a given database; the key is
  // what is guaranteed present. Move these to customer_id once the write paths
  // and the FK are everywhere.
  const crm = async (table: string, order: string) => {
    const { data, error } = await supabase
      .from(table).select("*").eq("customer_ns_id", key).order(order, { ascending: false });
    if (error) {
      warnings.push(`${table} unreadable: ${error.message}`);
      return [];
    }
    return data ?? [];
  };

  const [contacts, opportunities, tasks, activities] = await Promise.all([
    crm("pm_crm_contacts", "created_at"),
    crm("pm_crm_opportunities", "created_at"),
    crm("pm_crm_tasks", "created_at"),
    crm("pm_crm_activities", "occurred_at"),
  ]);

  // ─── Projects and contracts ───────────────────────────────────────────────
  // A local account has neither, and says so by returning empty — the caller
  // must not render "no projects found" as though NetSuite had been asked.
  let projects: CustomerProjectSummary[] = [];
  let contracts: CustomerContract[] = [];
  let currentContract: CustomerContract | null = null;

  if (!local) {
    const [proj, nsContracts, overlays] = await Promise.all([
      fetchCustomerProjects(key).catch((e: unknown) => {
        warnings.push(`Projects unreadable: ${e instanceof Error ? e.message : "unknown"}`);
        return [] as CustomerProjectSummary[];
      }),
      fetchNsContracts().catch((e: unknown) => {
        warnings.push(`Contracts unreadable: ${e instanceof Error ? e.message : "unknown"}`);
        return [] as NsContract[];
      }),
      // ⚠ `source, notice_period_days` ONLY. `cs_contracts.notes` is CS-authored
      // commentary and this route is session-gated, not cs_layer-gated. Never
      // widen this to `*`.
      supabase.from("cs_contracts").select("source, notice_period_days"),
    ]);
    projects = proj;

    const noticeBySource: Record<string, number> = {};
    for (const o of overlays.data ?? []) {
      if (o.source?.startsWith("netsuite:")) noticeBySource[o.source] = o.notice_period_days ?? 0;
    }

    const mine = nsContracts.filter(c => c.customerNsId === key);
    contracts = mine.map(c => toContract(c, noticeBySource[`netsuite:${c.nsContractId}`] ?? null));

    // The governing contract is not the first row — a renewed term sits beside
    // the expired one it replaced. currentContractByCustomer() prefers Active,
    // then the latest end date.
    const gov = currentContractByCustomer(nsContracts)[key];
    currentContract = gov
      ? toContract(gov, noticeBySource[`netsuite:${gov.nsContractId}`] ?? null)
      : null;
  }

  const record: CustomerRecord = {
    customer: identity,
    projects, contacts, opportunities, tasks, activities,
    contracts, currentContract,
    warnings,
  };

  // ─── The CS block, or nothing at all ──────────────────────────────────────
  if (!csLayer) return record;

  const [snap, flags, profile, drafts] = await Promise.all([
    supabase.from("cs_health_snapshots").select("score, band, computed_at")
      .eq("customer_ns_id", key).order("computed_at", { ascending: false }).limit(1),
    supabase.from("cs_health_flags").select("id, rule_id, severity, summary, created_at")
      .eq("customer_ns_id", key).in("status", ["open", "acknowledged"]),
    supabase.from("cs_customer_profiles").select("*").eq("customer_ns_id", key).maybeSingle(),
    supabase.from("cs_outreach_drafts").select("id, motion, subject, status, created_at")
      .eq("customer_ns_id", key).order("created_at", { ascending: false }).limit(20),
  ]);

  record.cs = {
    healthScore: snap.data?.[0]?.score ?? null,
    healthBand:  snap.data?.[0]?.band ?? null,
    openFlags:   flags.data ?? [],
    profile:     profile.data ?? null,
    profileVerified: Boolean(profile.data?.human_verified),
    drafts:      drafts.data ?? [],
  };
  return record;
}
