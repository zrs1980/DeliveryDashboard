import { runSuiteQLAll } from "@/lib/netsuite";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getStaffRoster } from "@/lib/roster";
import { LEAVE_PROJECT_IDS } from "@/lib/constants";
import { extractDriveFolderId } from "@/lib/google-drive";
import {
  fetchCsCustomers, fetchCustomerProjectIndex, fetchCustomerHours,
  fetchCustomerLastActivity, daysSince, type CustomerProjectIndex,
} from "@/lib/cs-customers";
import { fetchNsContracts, currentContractByCustomer } from "@/lib/cs-ns-contracts";

// ─── The customer index ─────────────────────────────────────────────────────
//
// One row per active NetSuite customer, assembled from every source the app
// touches, so that "what should I action today" is a single SELECT rather than
// a fan-out across SuiteQL, Supabase and ClickUp on every page load.
//
// ⚠ EVERY COLUMN IS DERIVED. The table is a cache and must always be safe to
// drop and rebuild. Nothing may be stored here that cannot be regenerated — a
// value that must survive a rebuild belongs in a table of its own. NetSuite
// stays the master; the existing `customer_ns_id text`, no-foreign-key
// convention is preserved.
//
// Rebuilt at the end of the nightly scoring run.

export interface CustomerIndexRow {
  customer_ns_id:       string;
  entityid:             string | null;
  name:                 string;
  email:                string | null;
  phone:                string | null;
  subsidiary_id:        number | null;
  subsidiary_name:      string | null;
  in_both_subsidiaries: boolean;
  stage:                string | null;
  entitystatus_id:      number | null;
  entitystatus_label:   string | null;
  industry:             string | null;
  category:             string | null;
  salesrep_ns_id:       number | null;
  salesrep_name:        string | null;
  consultant_ns_id:     number | null;
  consultant_name:      string | null;
  drive_folder_url:     string | null;
  drive_folder_id:      string | null;
  project_count:        number;
  active_project_count: number;
  hours_90d:            number;
  last_activity_date:   string | null;
  days_since_activity:  number | null;
  cases_90d:            number;
  open_cases:           number;
  contract_count:       number;
  contract_status:      string | null;
  contract_end_date:    string | null;
  notice_date:          string | null;
  annual_value:         number | null;
  last_sales_activity:  string | null;
  has_profile:          boolean;
  profile_verified:     boolean;
  health_score:         number | null;
  health_band:          string | null;
  open_flag_count:      number;
  last_healthcheck_at:  string | null;
  current_quarter_status: string | null;
  refreshed_at:         string;
}

export interface BuildResult {
  rows:     number;
  bySubsidiary: Record<string, number>;
  byStage:  Record<string, number>;
  withDriveFolder: number;
  warnings: string[];
}

const DAY = 86_400_000;

/** "Q3 2026" — matches the free-text format the healthchecks table stores. */
export function currentQuarter(d = new Date()): string {
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

const isoDay = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Active project and support-case counts for every customer.
 *
 * Kept separate from lib/cs-signals.ts on purpose: that computes the full
 * signal set for the ~87 scorable customers, where this needs two cheap counts
 * across all 180 including prospects.
 */
async function fetchCounts(index: CustomerProjectIndex) {
  const activeProjects: Record<string, number> = {};
  const cases90: Record<string, number> = {};
  const openCases: Record<string, number> = {};

  const ownerOf = (id: string) => {
    if (LEAVE_PROJECT_IDS.has(id)) return null;
    return index.byProject[id]?.customerNsId ?? null;
  };

  const [projRows, caseRows] = await Promise.all([
    runSuiteQLAll<{ id: string }>(`SELECT id FROM job WHERE entitystatus = 2`),
    runSuiteQLAll<{ company: string; created: string; status: string | null }>(`
      SELECT sc.company,
             TO_CHAR(sc.createddate, 'YYYY-MM-DD') AS created,
             BUILTIN.DF(sc.status)                 AS status
      FROM supportcase sc
      WHERE sc.isinactive = 'F'
    `),
  ]);

  for (const p of projRows ?? []) {
    const cid = ownerOf(String(p.id));
    if (cid) activeProjects[cid] = (activeProjects[cid] ?? 0) + 1;
  }

  const d90 = isoDay(new Date(Date.now() - 90 * DAY));
  for (const c of caseRows ?? []) {
    const key = String(c.company);
    // company is a customer id OR a job id — 596 of 1080 are jobs.
    const cid = index.byProject[key] ? index.byProject[key].customerNsId : key;
    if (!cid) continue;
    if (c.created >= d90) cases90[cid] = (cases90[cid] ?? 0) + 1;
    if (!/closed|resolved|complete/i.test(c.status ?? "")) {
      openCases[cid] = (openCases[cid] ?? 0) + 1;
    }
  }

  return { activeProjects, cases90, openCases };
}

/** Rebuild the whole index. Idempotent; safe to run as often as you like. */
export async function buildCustomerIndex(): Promise<BuildResult> {
  const warnings: string[] = [];
  const supabase = getSupabaseAdmin();

  const index = await fetchCustomerProjectIndex();

  const [customers, hours, lastActivity, counts, nsContracts, roster] = await Promise.all([
    fetchCsCustomers(),
    fetchCustomerHours(90, index),
    fetchCustomerLastActivity(index),
    fetchCounts(index),
    fetchNsContracts().catch((e: unknown) => {
      warnings.push(`Contracts unreadable: ${e instanceof Error ? e.message : "unknown"}`);
      return [] as Awaited<ReturnType<typeof fetchNsContracts>>;
    }),
    getStaffRoster().catch(() => null),
  ]);

  // Supabase state. A failed read leaves that dimension null rather than
  // silently reporting "no profile" or "never had a health check", both of
  // which would put customers onto the worklist that do not belong there.
  const [
    { data: profiles, error: profErr },
    { data: snaps,    error: snapErr },
    { data: flags,    error: flagErr },
    { data: hcs,      error: hcErr },
    { data: overlays },
  ] = await Promise.all([
    supabase.from("cs_customer_profiles").select("customer_ns_id, human_verified"),
    supabase.from("cs_health_snapshots").select("customer_ns_id, score, band, computed_at")
      .order("computed_at", { ascending: false }).limit(5000),
    supabase.from("cs_health_flags").select("customer_ns_id").in("status", ["open", "acknowledged"]),
    supabase.from("healthchecks").select("customer_ns_id, quarter, status, scheduled_date, completed_at"),
    supabase.from("cs_contracts").select("source, notice_period_days"),
  ]);
  if (profErr) warnings.push(`Profiles unreadable: ${profErr.message}`);
  if (snapErr) warnings.push(`Snapshots unreadable: ${snapErr.message}`);
  if (flagErr) warnings.push(`Flags unreadable: ${flagErr.message}`);
  if (hcErr)   warnings.push(`Health checks unreadable: ${hcErr.message}`);

  const profileBy = new Map((profiles ?? []).map(p => [p.customer_ns_id, p]));
  const flagCount: Record<string, number> = {};
  for (const f of flags ?? []) flagCount[f.customer_ns_id] = (flagCount[f.customer_ns_id] ?? 0) + 1;

  const latestSnap: Record<string, { score: number; band: string }> = {};
  for (const s of snaps ?? []) {
    if (!latestSnap[s.customer_ns_id]) latestSnap[s.customer_ns_id] = { score: s.score, band: s.band };
  }

  const noticeBySource: Record<string, number> = {};
  for (const o of overlays ?? []) {
    if (o.source?.startsWith("netsuite:")) noticeBySource[o.source] = o.notice_period_days ?? 0;
  }
  const contracts = currentContractByCustomer(nsContracts);
  const contractCount: Record<string, number> = {};
  for (const c of nsContracts) contractCount[c.customerNsId] = (contractCount[c.customerNsId] ?? 0) + 1;

  // Health checks: the most recent completion, and where this quarter stands.
  // `overdue` is computed, never stored — the same derivation CustomersView
  // does client-side, moved here so both agree.
  const quarter = currentQuarter();
  const todayIso = isoDay(new Date());
  const lastHc: Record<string, string> = {};
  const quarterStatus: Record<string, string> = {};
  for (const h of hcs ?? []) {
    const cid = h.customer_ns_id;
    const done = h.completed_at ?? null;
    if (done && (!lastHc[cid] || done > lastHc[cid])) lastHc[cid] = done;
    if (h.quarter !== quarter) continue;
    if (h.status === "completed") quarterStatus[cid] = "completed";
    else if (quarterStatus[cid] !== "completed") {
      const overdue = h.scheduled_date && String(h.scheduled_date).slice(0, 10) < todayIso;
      quarterStatus[cid] = overdue ? "overdue" : h.status === "scheduled" ? "scheduled" : "unscheduled";
    }
  }

  const rows: CustomerIndexRow[] = customers.map(c => {
    const cid = String(c.id);
    const contract = contracts[cid] ?? null;

    let noticeDate: string | null = null;
    if (contract?.endDate) {
      const noticeDays = noticeBySource[`netsuite:${contract.nsContractId}`] ?? 0;
      const end = new Date(`${contract.endDate}T00:00:00`);
      if (!Number.isNaN(end.getTime())) noticeDate = isoDay(new Date(end.getTime() - noticeDays * DAY));
    }

    const profile = profileBy.get(cid);
    const last = lastActivity[cid] ?? null;

    return {
      customer_ns_id: cid,
      entityid: c.entityid || null,
      name:     c.companyname,
      email:    c.email,
      phone:    c.phone,

      subsidiary_id:        c.subsidiaryId,
      subsidiary_name:      c.subsidiaryName,
      in_both_subsidiaries: c.inBothSubsidiaries,
      stage:                c.stage,
      entitystatus_id:      c.entitystatusId,
      entitystatus_label:   c.entitystatusLabel,
      industry:             c.industry,
      category:             c.category,

      salesrep_ns_id:   c.salesrepNsId,
      salesrep_name:    c.salesrepName,
      consultant_ns_id: c.consultantNsId,
      consultant_name:  c.consultantNsId && roster ? roster.byId[c.consultantNsId]?.name ?? null : null,

      drive_folder_url: c.driveFolderUrl,
      drive_folder_id:  extractDriveFolderId(c.driveFolderUrl),

      project_count:        index.byCustomer[cid]?.length ?? 0,
      active_project_count: counts.activeProjects[cid] ?? 0,
      hours_90d:            Math.round((hours[cid] ?? 0) * 10) / 10,
      last_activity_date:   last,
      days_since_activity:  daysSince(last),

      cases_90d:  counts.cases90[cid] ?? 0,
      open_cases: counts.openCases[cid] ?? 0,

      contract_count:     contractCount[cid] ?? 0,
      contract_status:    contract?.statusLabel ?? null,
      contract_end_date:  contract?.endDate ?? null,
      notice_date:        noticeDate,
      annual_value:       contract?.annualValue ?? null,
      last_sales_activity: c.lastSalesActivity,

      has_profile:      Boolean(profile),
      profile_verified: Boolean(profile?.human_verified),
      health_score:     latestSnap[cid]?.score ?? null,
      health_band:      latestSnap[cid]?.band ?? null,
      open_flag_count:  flagCount[cid] ?? 0,

      last_healthcheck_at:    lastHc[cid] ?? null,
      current_quarter_status: quarterStatus[cid] ?? "unscheduled",

      refreshed_at: new Date().toISOString(),
    };
  });

  if (rows.length) {
    const { error } = await supabase
      .from("cs_customer_index")
      .upsert(rows, { onConflict: "customer_ns_id" });
    if (error) {
      throw new Error(
        `Could not write the customer index: ${error.message}. ` +
        `Run supabase/cs-customer-index.sql in the Supabase SQL Editor.`,
      );
    }

    // A customer that left NetSuite, or went inactive, must leave the index —
    // otherwise the worklist keeps proposing action on an account nobody has.
    const keep = rows.map(r => r.customer_ns_id);
    const { error: delErr } = await supabase
      .from("cs_customer_index").delete().not("customer_ns_id", "in", `(${keep.join(",")})`);
    if (delErr) warnings.push(`Stale index rows not pruned: ${delErr.message}`);
  }

  const bySubsidiary: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  for (const r of rows) {
    const s = r.subsidiary_name ?? "unknown";
    bySubsidiary[s] = (bySubsidiary[s] ?? 0) + 1;
    const st = r.stage ?? "unknown";
    byStage[st] = (byStage[st] ?? 0) + 1;
  }

  return {
    rows: rows.length,
    bySubsidiary,
    byStage,
    withDriveFolder: rows.filter(r => r.drive_folder_id).length,
    warnings,
  };
}

export interface IndexFilters {
  stage?:        string;
  subsidiaryId?: number;
  search?:       string;
  limit?:        number;
}

/** The single read path. Every consumer goes through here. */
export async function readCustomerIndex(f: IndexFilters = {}): Promise<CustomerIndexRow[]> {
  let q = getSupabaseAdmin().from("cs_customer_index").select("*");

  if (f.stage)        q = q.eq("stage", f.stage);
  // A customer in both subsidiaries belongs to both books, so an exact match on
  // subsidiary_id would drop Certified Waste and Yaffe from the Loop ERP list.
  if (f.subsidiaryId) q = q.or(`subsidiary_id.eq.${f.subsidiaryId},in_both_subsidiaries.eq.true`);
  if (f.search)       q = q.ilike("name", `%${f.search}%`);

  const { data, error } = await q.order("name", { ascending: true }).limit(f.limit ?? 500);
  if (error) {
    throw new Error(
      `${error.message}. If the table is missing, run supabase/cs-customer-index.sql in the Supabase SQL Editor.`,
    );
  }
  return (data ?? []) as CustomerIndexRow[];
}
