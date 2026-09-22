import { runSuiteQLAll } from "@/lib/netsuite";
import { LEAVE_PROJECT_IDS } from "@/lib/constants";
import { fetchCustomerProjectIndex, type CustomerProjectIndex } from "@/lib/cs-customers";

// ─── Health signals ─────────────────────────────────────────────────────────
//
// docs/03-HEALTH-SCORING.md lists signals across engagement, delivery, support,
// relationship and commercial. Not all of them are computable yet, and the
// difference matters enormously:
//
//   ⚠ AN ABSENT SIGNAL IS NULL, NEVER ZERO.
//
// "No contacts recorded" and "every contact has gone silent" look identical if
// absence is encoded as 0, and the second one is a churn alarm. Every rule skips
// a null rather than treating it as bad, so an empty cs_contacts table produces
// no flags instead of flagging the entire book. Same for sentiment, commitments
// and contracts until those tables are filled in.
//
// What is computable today, and what is not:
//
//   Engagement   ✅ hours, silence, trend, forward-booked work
//   Delivery     ✅ over-budget projects, stalled projects
//   Support      ✅ case volume, trend, ageing open cases
//   Relationship ❌ needs cs_contacts and cs_consultant_sentiment, both empty
//   Commercial   ⚠ needs cs_contracts — computed when a contract exists, null otherwise
//
// The spec's own framing: silence is the loudest signal, and conventional
// event-driven alerting is blind to it. So these are computed for EVERY customer
// on a schedule, not in reaction to something happening.

export interface CustomerSignals {
  customerNsId: string;

  // Engagement
  daysSinceLastHour:      number | null;  // null = never logged any actual time
  hoursLast30:            number;
  hoursLast90:            number;
  hoursPrior90:           number;         // the 90 days before that, for trend
  hoursTrendRatio:        number | null;  // last90 / prior90; null when no prior baseline
  forwardBookedHours:     number;         // allocations ending today or later
  activeProjects:         number;

  // Delivery
  projectsOverBudget:     number;
  stalledProjects:        number;         // open, nothing logged in 30d

  // Support
  casesLast90:            number;
  casesPrior90:           number;
  caseTrendRatio:         number | null;
  openCasesAgeing:        number;         // open and untouched 7d+

  // Relationship — not computable yet
  activeContacts:         number | null;
  latestSentiment:        "green" | "amber" | "red" | null;

  // Commercial — from cs_contracts, null when none recorded
  daysToNotice:           number | null;
  contractStatus:         string | null;
  autoRenew:              boolean | null;
}

const DAY = 86_400_000;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Compute signals for every customer in one pass.
 *
 * Deliberately batched rather than per-customer: the nightly job must evaluate
 * every account including the silent ones, and 55 customers × 6 queries each
 * would be 330 SuiteQL round trips against a rate-limited API.
 */
export async function computeAllSignals(
  customerNsIds: string[],
  index?: CustomerProjectIndex,
): Promise<Record<string, CustomerSignals>> {
  const idx = index ?? await fetchCustomerProjectIndex();
  const wanted = new Set(customerNsIds);

  const blank = (id: string): CustomerSignals => ({
    customerNsId: id,
    daysSinceLastHour: null, hoursLast30: 0, hoursLast90: 0, hoursPrior90: 0,
    hoursTrendRatio: null, forwardBookedHours: 0, activeProjects: 0,
    projectsOverBudget: 0, stalledProjects: 0,
    casesLast90: 0, casesPrior90: 0, caseTrendRatio: null, openCasesAgeing: 0,
    activeContacts: null, latestSentiment: null,
    daysToNotice: null, contractStatus: null, autoRenew: null,
  });

  const out: Record<string, CustomerSignals> = {};
  for (const id of customerNsIds) out[id] = blank(id);

  const ownerOf = (projectId: string) => {
    if (LEAVE_PROJECT_IDS.has(projectId)) return null;
    const owner = idx.byProject[projectId];
    return owner && wanted.has(owner.customerNsId) ? owner.customerNsId : null;
  };

  // ── Hours, three windows in one query ─────────────────────────────────────
  // timetype='A' throughout: allocation rows are forward-dated and would make a
  // silent account read as busy.
  const hourRows = await runSuiteQLAll<{
    project_id: string; h30: string; h90: string; hprior: string; last_date: string | null;
  }>(`
    SELECT tb.customer AS project_id,
           SUM(CASE WHEN tb.trandate >= SYSDATE - 30  THEN tb.hours ELSE 0 END) AS h30,
           SUM(CASE WHEN tb.trandate >= SYSDATE - 90  THEN tb.hours ELSE 0 END) AS h90,
           SUM(CASE WHEN tb.trandate >= SYSDATE - 180
                     AND tb.trandate <  SYSDATE - 90  THEN tb.hours ELSE 0 END) AS hprior,
           TO_CHAR(MAX(tb.trandate), 'YYYY-MM-DD') AS last_date
    FROM timebill tb
    WHERE tb.timetype = 'A'
    GROUP BY tb.customer
  `);

  const lastDateByCustomer: Record<string, string> = {};
  for (const r of hourRows) {
    const cid = ownerOf(String(r.project_id));
    if (!cid) continue;
    const s = out[cid];
    s.hoursLast30  += num(r.h30);
    s.hoursLast90  += num(r.h90);
    s.hoursPrior90 += num(r.hprior);
    if (r.last_date && (!lastDateByCustomer[cid] || r.last_date > lastDateByCustomer[cid])) {
      lastDateByCustomer[cid] = r.last_date;
    }
  }
  for (const [cid, iso] of Object.entries(lastDateByCustomer)) {
    const then = new Date(`${iso}T00:00:00`);
    if (!Number.isNaN(then.getTime())) {
      out[cid].daysSinceLastHour = Math.floor((Date.now() - then.getTime()) / DAY);
    }
  }
  for (const s of Object.values(out)) {
    // Null, not zero, when there is no prior period to compare against — a new
    // customer is not a declining one.
    s.hoursTrendRatio = s.hoursPrior90 > 0 ? s.hoursLast90 / s.hoursPrior90 : null;
  }

  // ── Forward-booked work. An empty calendar is a strong signal. ─────────────
  const allocRows = await runSuiteQLAll<{ project: string; numberhours: string | null }>(`
    SELECT ra.project, ra.numberHours AS numberhours
    FROM resourceallocation ra
    WHERE ra.endDate >= SYSDATE
  `);
  for (const r of allocRows) {
    const cid = ownerOf(String(r.project));
    if (cid) out[cid].forwardBookedHours += num(r.numberhours);
  }

  // ── Projects: active count, over budget, stalled ──────────────────────────
  const projRows = await runSuiteQLAll<{
    id: string; entitystatus: string;
    budget_hours: string | null; remaining_hours: string | null;
  }>(`
    SELECT id, entitystatus,
           custentity_ceba_project_budget_hours AS budget_hours,
           custentity_project_remaining_hours   AS remaining_hours
    FROM job WHERE entitystatus = 2
  `);

  const activeProjectIds: string[] = [];
  for (const p of projRows) {
    const cid = ownerOf(String(p.id));
    if (!cid) continue;
    out[cid].activeProjects++;
    activeProjectIds.push(String(p.id));
    const budget = num(p.budget_hours), remaining = num(p.remaining_hours);
    if (budget > 0 && remaining < 0) out[cid].projectsOverBudget++;
  }

  if (activeProjectIds.length) {
    const recent = await runSuiteQLAll<{ project_id: string }>(`
      SELECT DISTINCT tb.customer AS project_id
      FROM timebill tb
      WHERE tb.timetype = 'A' AND tb.trandate >= SYSDATE - 30
    `);
    const touched = new Set(recent.map(r => String(r.project_id)));
    for (const pid of activeProjectIds) {
      if (touched.has(pid)) continue;
      const cid = ownerOf(pid);
      if (cid) out[cid].stalledProjects++;
    }
  }

  // ── Support cases. company may be a customer id OR a job id. ──────────────
  const caseRows = await runSuiteQLAll<{
    company: string; created: string; modified: string; status: string | null;
  }>(`
    SELECT sc.company,
           TO_CHAR(sc.createddate, 'YYYY-MM-DD')      AS created,
           TO_CHAR(sc.lastmodifieddate, 'YYYY-MM-DD') AS modified,
           BUILTIN.DF(sc.status)                      AS status
    FROM supportcase sc WHERE sc.isinactive = 'F'
  `);

  const today = new Date();
  const isoDaysAgo = (n: number) => {
    const d = new Date(today.getTime() - n * DAY);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const d90 = isoDaysAgo(90), d180 = isoDaysAgo(180), d7 = isoDaysAgo(7);

  for (const r of caseRows) {
    const key = String(r.company);
    // Either the company IS the customer, or it is one of their jobs.
    const cid = wanted.has(key) ? key : ownerOf(key);
    if (!cid) continue;
    const s = out[cid];
    if (r.created >= d90)                          s.casesLast90++;
    else if (r.created >= d180 && r.created < d90) s.casesPrior90++;

    const closed = /closed|resolved|complete/i.test(r.status ?? "");
    if (!closed && r.modified < d7) s.openCasesAgeing++;
  }
  for (const s of Object.values(out)) {
    s.caseTrendRatio = s.casesPrior90 > 0 ? s.casesLast90 / s.casesPrior90 : null;
  }

  return out;
}

/**
 * Fold contract and sentiment data in.
 *
 * Kept separate from the NetSuite pass because both come from Supabase, and
 * because both tables are empty today — the signals stay null rather than
 * becoming zero, so no rule reads "no contract recorded" as "contract expired".
 */
export function applySupabaseSignals(
  signals: Record<string, CustomerSignals>,
  contracts: Array<{ customer_ns_id: string; end_date: string | null; notice_period_days: number; status: string; auto_renew: boolean }>,
  sentiment: Array<{ customer_ns_id: string; rating: "green" | "amber" | "red"; captured_at: string }>,
) {
  for (const c of contracts) {
    const s = signals[c.customer_ns_id];
    if (!s || !c.end_date) continue;
    const end = new Date(`${c.end_date}T00:00:00`);
    if (Number.isNaN(end.getTime())) continue;
    const notice = new Date(end.getTime() - Math.max(0, c.notice_period_days ?? 0) * DAY);
    const days = Math.round((notice.getTime() - Date.now()) / DAY);
    // Soonest deadline wins when a customer holds several contracts.
    if (s.daysToNotice === null || days < s.daysToNotice) {
      s.daysToNotice   = days;
      s.contractStatus = c.status;
      s.autoRenew      = c.auto_renew;
    }
  }

  const newest: Record<string, { at: string; rating: "green" | "amber" | "red" }> = {};
  for (const r of sentiment) {
    const cur = newest[r.customer_ns_id];
    if (!cur || r.captured_at > cur.at) newest[r.customer_ns_id] = { at: r.captured_at, rating: r.rating };
  }
  for (const [cid, v] of Object.entries(newest)) {
    if (signals[cid]) signals[cid].latestSentiment = v.rating;
  }

  return signals;
}
