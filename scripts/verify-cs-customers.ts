/**
 * Reconciliation check for lib/cs-customers.ts against live NetSuite.
 *
 *   npx tsx --env-file=.env.local scripts/verify-cs-customers.ts
 *
 * Needs the NETSUITE_* vars; does not touch Supabase. Read-only — every query
 * here is a SELECT.
 *
 * What it is actually checking:
 *
 *  - that the SuiteQL in cs-customers.ts runs at all (BUILTIN.DF inside a
 *    projection, SYSDATE arithmetic, and MAX(trandate) are the risky parts)
 *  - that the five active projects documented in CLAUDE.md resolve to sensible
 *    customers, which is the only way to tell a correct join from a plausible one
 *  - that the quiet-customer count lands near 95 of 111. A LOW number means the
 *    timetype='A' filter has stopped working and forward-dated allocation rows
 *    are being counted as activity — the failure this module exists to prevent.
 */
import {
  fetchCsCustomers,
  fetchCustomerProjectIndex,
  fetchCustomerHours,
  fetchCustomerLastActivity,
  daysSince,
} from "../lib/cs-customers";

// From CLAUDE.md's active-project table — known good reference points.
const KNOWN_PROJECTS: Record<string, string> = {
  "18386": "Pacific OneSource",
  "18380": "Nautical Fulfillment & Logistics",
  "18171": "FarmOp Capital (JGL Livestock)",
  "18403": "Salt and Stone",
  "17310": "Yield Engineering Systems",
};

const WINDOW = 90;

async function main() {
  console.log("Fetching customer index…");
  const index = await fetchCustomerProjectIndex();

  const [customers, hours, lastActivity] = await Promise.all([
    fetchCsCustomers(),
    fetchCustomerHours(WINDOW, index),
    fetchCustomerLastActivity(index),
  ]);

  console.log(`\nCustomers (isinactive='F', entitystatus=13): ${customers.length}`);
  console.log(`Jobs with a customer:                        ${Object.keys(index.byProject).length}`);
  console.log(`Customers with any '${"A"}' time ever:             ${Object.keys(lastActivity).length}`);
  console.log(`Customers with time in last ${WINDOW}d:            ${Object.keys(hours).length}`);

  console.log("\n─── Known projects → customer ───");
  for (const [projectId, expected] of Object.entries(KNOWN_PROJECTS)) {
    const owner = index.byProject[projectId];
    const ok    = owner ? "  " : "??";
    console.log(
      `${ok} job ${projectId} → ${owner ? `${owner.customerNsId} ${owner.customerName}` : "UNRESOLVED"}` +
      `   (expected ~ ${expected})`,
    );
  }

  const quiet = customers.filter(c => {
    const d = daysSince(lastActivity[String(c.id)] ?? null);
    return d === null || d >= WINDOW;
  });

  console.log(`\n─── Silence ───`);
  console.log(`Quiet (no actual time in ${WINDOW}d, incl. never): ${quiet.length} of ${customers.length}`);
  console.log(`A LOW proportion here means the timetype='A' filter is not being applied.`);

  // Coverage of the chosen universe. entitystatus=13 is narrower than "has ever
  // had work done": customers below have delivery history but are not scored,
  // because they are not in the Customers-tab list. If this number is large, the
  // universe decision is worth revisiting — a churn signal on an account nobody
  // is looking at is the one that matters most.
  const inUniverse = new Set(customers.map(c => String(c.id)));
  const outside    = Object.keys(lastActivity).filter(id => !inUniverse.has(id));

  console.log(`\n─── Universe coverage ───`);
  console.log(`In universe (isinactive='F', entitystatus=13): ${customers.length}`);
  console.log(`Have logged actual time at some point:         ${Object.keys(lastActivity).length}`);
  console.log(`WITH history but NOT in universe (unscored):   ${outside.length}`);

  const active = customers
    .map(c => ({ name: c.companyname, h: hours[String(c.id)] ?? 0 }))
    .filter(r => r.h > 0)
    .sort((a, b) => b.h - a.h)
    .slice(0, 10);

  console.log(`\n─── Busiest customers, last ${WINDOW}d ───`);
  for (const r of active) console.log(`  ${r.h.toFixed(1).padStart(8)}h  ${r.name}`);

  // A future date here would mean allocation ('B') rows leaked into "activity".
  // Both sides are ISO YYYY-MM-DD, so the comparison is a valid lexical one —
  // it is NOT valid against SuiteQL's native M/D/YYYY, which is why
  // fetchCustomerLastActivity normalises with TO_CHAR.
  const newest = Object.values(lastActivity).sort().pop();
  const today  = new Date().toISOString().slice(0, 10);
  console.log(`\nMost recent activity across all customers: ${newest ?? "none"} (today ${today})`);
  if (newest && newest > today) {
    console.log("  ** FUTURE DATE — the timetype filter is not working. **");
  }
}

main().catch(e => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
