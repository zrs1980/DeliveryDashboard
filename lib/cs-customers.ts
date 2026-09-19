import { runSuiteQL, runSuiteQLAll } from "@/lib/netsuite";
import { LEAVE_PROJECT_IDS } from "@/lib/constants";

// ─── Customer identity for the CS agent layer ────────────────────────────────
//
// Everything in docs/01-DATA-MODEL.md joins on `customer_ns_id` — the NetSuite
// `customer` internal id, stored as text, with no foreign key (the customer
// master is NetSuite, not Postgres). Eleven tables already follow that
// convention. This module is the only thing that produces the value.
//
// It exists because nothing else could. The dashboard deals in PROJECTS:
// fetchActiveProjects() selects BUILTIN.DF(customer) — the customer's display
// name, not its id — and `job.companyname` in this account is the PROJECT name,
// not the customer's. So before this module there was no way to ask "which
// projects, hours and tickets belong to customer X", which is the first question
// every CS motion asks.

/** The canonical customer record. Shape matches what /api/customers returns. */
export interface CsCustomer {
  id:          number;
  entityid:    string;
  companyname: string;
  email:       string | null;
  phone:       string | null;
}

export interface CustomerProjectIndex {
  /** project (job) id → the customer that owns it */
  byProject:  Record<string, { customerNsId: string; customerName: string }>;
  /** customer id → every project id belonging to it */
  byCustomer: Record<string, string[]>;
}

/**
 * The definition of "a customer", in one place.
 *
 * entitystatus = 13 with isinactive = 'F' is the same filter the Customers tab
 * has always used, so the CS layer scores exactly the accounts a PM already sees
 * listed. Worth revisiting once contracts are loaded: a customer with live
 * delivery work but a different NetSuite status will not appear here, and
 * therefore will never be scored.
 *
 * This query used to live inline in app/api/customers/route.ts. It is here so
 * there is one definition rather than two that can drift — the same reason
 * lib/roster.ts exists.
 */
export async function fetchCsCustomers(): Promise<CsCustomer[]> {
  const rows = await runSuiteQLAll<{
    id: string; entityid: string; companyname: string | null;
    email: string | null; phone: string | null;
  }>(`
    SELECT id, entityid, companyname, email, phone
    FROM customer
    WHERE isinactive = 'F'
      AND entitystatus = 13
    ORDER BY companyname ASC
  `);

  return (rows ?? [])
    .map(r => ({
      id:          parseInt(r.id),
      entityid:    r.entityid ?? "",
      companyname: r.companyname || r.entityid || String(r.id),
      email:       r.email ?? null,
      phone:       r.phone ?? null,
    }))
    .filter(c => c.companyname);
}

/**
 * job.id → customer, both directions.
 *
 * Every project ever, not just active ones: a customer whose last project closed
 * two years ago still needs to resolve, and "no activity" is the signal the
 * health layer is built to detect. Filtering to active projects here would make
 * exactly the wrong accounts invisible.
 */
export async function fetchCustomerProjectIndex(): Promise<CustomerProjectIndex> {
  const rows = await runSuiteQLAll<{
    id: string; customer: string | null; customer_name: string | null;
  }>(`
    SELECT id, customer, BUILTIN.DF(customer) AS customer_name
    FROM job
    WHERE customer IS NOT NULL
  `);

  const byProject:  CustomerProjectIndex["byProject"]  = {};
  const byCustomer: CustomerProjectIndex["byCustomer"] = {};

  for (const r of rows ?? []) {
    if (!r.customer) continue;
    const projectId  = String(r.id);
    const customerId = String(r.customer);

    byProject[projectId] = {
      customerNsId: customerId,
      customerName: r.customer_name ?? "",
    };
    (byCustomer[customerId] ??= []).push(projectId);
  }

  return { byProject, byCustomer };
}

// Two traps live in the next two functions. Both were measured against the live
// account and both are recorded in supabase/cs-agent-schema.sql:
//
//   1. `timebill.customer` is a JOB id, not a customer id. Rolling up by it
//      directly gives hours per project, silently labelled as hours per
//      customer.
//   2. `timetype = 'A'` is mandatory. Unfiltered, 17,017 of 32,308 timebill rows
//      are forward-dated 'B' (allocated) entries — a forecast, not work done. The
//      most recent "activity" for the largest bucket sits 104 days in the FUTURE,
//      so a silent account reads as busy. That is precisely the state this module
//      exists to detect.
//
// /api/time-analysis and /api/msa apply no timetype filter. Do not copy their
// queries; follow lib/netsuite.ts:fetchActualHours instead.
//
// Leave projects are excluded as well — PTO is logged against a job like any
// other time, and without the exclusion a consultant's holiday reads as customer
// engagement.

/**
 * Worked hours per customer over the last `days`, rolled up through
 * timebill.customer → job.id → job.customer.
 *
 * Returns customer id → hours. Customers with no qualifying time are absent
 * rather than zero; callers that need "everyone" should start from
 * fetchCsCustomers() and treat a missing key as 0.
 */
export async function fetchCustomerHours(
  days: number,
  index?: CustomerProjectIndex,
): Promise<Record<string, number>> {
  const window = Math.max(1, Math.floor(days));
  const idx    = index ?? await fetchCustomerProjectIndex();

  const rows = await runSuiteQLAll<{ project_id: string; hours: string }>(`
    SELECT tb.customer AS project_id, SUM(tb.hours) AS hours
    FROM timebill tb
    WHERE tb.timetype = 'A'
      AND tb.trandate >= SYSDATE - ${window}
    GROUP BY tb.customer
  `);

  const byCustomer: Record<string, number> = {};
  for (const r of rows ?? []) {
    const projectId = String(r.project_id);
    if (LEAVE_PROJECT_IDS.has(projectId)) continue;

    const owner = idx.byProject[projectId];
    if (!owner) continue;   // a job with no customer — internal work

    byCustomer[owner.customerNsId] =
      (byCustomer[owner.customerNsId] ?? 0) + (parseFloat(r.hours) || 0);
  }

  return byCustomer;
}

/**
 * Most recent worked day per customer, as an ISO date string.
 *
 * This is the silence detector docs/03-HEALTH-SCORING.md calls the primary
 * signal, and the reason the timetype filter above is not optional: with 'B'
 * rows included, "last activity" can legitimately be in the future.
 */
export async function fetchCustomerLastActivity(
  index?: CustomerProjectIndex,
): Promise<Record<string, string>> {
  const idx = index ?? await fetchCustomerProjectIndex();

  // TO_CHAR, and the MAX taken in SQL, are both load-bearing.
  //
  // SuiteQL returns dates in M/D/YYYY. Those do not sort lexicographically —
  // "9/8/2026" > "10/1/2026" as strings — so reducing to a maximum in JS with a
  // string compare silently picks September over October. Normalising to ISO in
  // the query makes both the SQL MAX and the JS comparison below correct, and
  // gives daysSince() something unambiguous to parse.
  const rows = await runSuiteQLAll<{ project_id: string; last_date: string | null }>(`
    SELECT tb.customer AS project_id,
           TO_CHAR(MAX(tb.trandate), 'YYYY-MM-DD') AS last_date
    FROM timebill tb
    WHERE tb.timetype = 'A'
    GROUP BY tb.customer
  `);

  const byCustomer: Record<string, string> = {};
  for (const r of rows ?? []) {
    const projectId = String(r.project_id);
    if (!r.last_date) continue;
    if (LEAVE_PROJECT_IDS.has(projectId)) continue;

    const owner = idx.byProject[projectId];
    if (!owner) continue;

    const current = byCustomer[owner.customerNsId];
    if (!current || r.last_date > current) {
      byCustomer[owner.customerNsId] = r.last_date;
    }
  }

  return byCustomer;
}

/**
 * Whole days since `isoDate` (YYYY-MM-DD), or null if absent/unparseable.
 *
 * Parses at LOCAL midnight. `new Date("2026-09-08")` is read as UTC and renders
 * as the 7th for anyone behind Greenwich, which shifts every count by a day —
 * the same trap ResourceAllocation.tsx documents for its date inputs.
 */
export function daysSince(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const iso  = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? `${isoDate}T00:00:00` : isoDate;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86_400_000);
}

/**
 * Resolve a single project id to its customer without building the whole index.
 * For one-off lookups only — use fetchCustomerProjectIndex() when resolving many.
 */
export async function customerOfProject(
  projectNsId: number | string,
): Promise<{ customerNsId: string; customerName: string } | null> {
  const id = Number(projectNsId);
  if (!Number.isFinite(id)) return null;

  const rows = await runSuiteQL<{ customer: string | null; customer_name: string | null }>(`
    SELECT customer, BUILTIN.DF(customer) AS customer_name
    FROM job
    WHERE id = ?
  `, [id]);

  const row = rows?.[0];
  if (!row?.customer) return null;
  return { customerNsId: String(row.customer), customerName: row.customer_name ?? "" };
}
