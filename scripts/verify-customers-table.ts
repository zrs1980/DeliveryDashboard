/**
 * Sync the `customers` identity table and report what slice 2 will find.
 *
 *   npx tsx --env-file=.env.local scripts/verify-customers-table.ts
 *
 * Two jobs:
 *
 *  1. Run syncCustomers() for real and print what it did.
 *  2. For every table that references a customer by loose text today, count
 *     how many of its distinct keys resolve to a `customers` row — because a
 *     key that does not resolve is a row slice 2's foreign key would reject.
 *
 * The second half is the point. Adding a FK to 20 tables is only safe if every
 * value already present can be resolved, and "it should be fine" is not a
 * number. Anything reported as UNRESOLVED has to be explained before slice 2.
 */

import { syncCustomers, customerIdByKey } from "@/lib/customers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isLocalAccountId } from "@/lib/crm-accounts";

// Every table carrying a `customer_ns_id text`, as of September 2026.
// `healthchecks` is here even though its DDL lives only in a comment block at
// app/api/healthchecks/route.ts — there is no .sql file for it.
const TABLES = [
  "pm_crm_contacts", "pm_crm_opportunities", "pm_crm_tasks", "pm_crm_activities",
  "cs_contacts", "cs_commitments", "cs_consultant_sentiment", "cs_contracts",
  "cs_customer_profiles", "cs_health_flags", "cs_health_snapshots",
  "cs_outreach_drafts", "cs_release_matches", "cs_research_runs", "cs_agent_runs",
  "cs_customer_index",
  "healthchecks",
  "meeting_processing", "pm_projects",
  "customer_portal_users", "portal_invitations", "project_portal_access",
  "task_notes", "task_approvals",
];

async function main() {
  console.log("── Syncing customers ──────────────────────────────────────────\n");

  const r = await syncCustomers();
  console.log(`  NetSuite customers : ${r.netsuite}`);
  console.log(`  Local prospects    : ${r.local}`);
  console.log(`  Retired this run   : ${r.deactivated}`);
  console.log(`  Merged this run    : ${r.merged}`);
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);

  const byKey = await customerIdByKey();
  console.log(`\n  Resolvable keys    : ${byKey.size}\n`);

  console.log("── Foreign-key readiness ──────────────────────────────────────\n");
  console.log("  table                         rows   keys   unresolved");
  console.log("  ─────────────────────────────────────────────────────────");

  const supabase = getSupabaseAdmin();
  const problems: string[] = [];

  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select("customer_ns_id");
    if (error) {
      // A missing table is information, not a failure: several of these are
      // specced but never deployed, and slice 2 must not try to alter them.
      console.log(`  ${t.padEnd(28)}  ${/does not exist|schema cache/i.test(error.message) ? "— not deployed" : "ERROR: " + error.message}`);
      continue;
    }

    const rows = data ?? [];
    const keys = new Set(rows.map(x => x.customer_ns_id).filter(Boolean) as string[]);
    const unresolved = [...keys].filter(k => !byKey.has(k));

    console.log(
      `  ${t.padEnd(28)} ${String(rows.length).padStart(5)}  ${String(keys.size).padStart(5)}  ` +
      `${unresolved.length ? String(unresolved.length).padStart(6) + "  ⚠" : "     0"}`,
    );

    if (unresolved.length) {
      const local = unresolved.filter(isLocalAccountId);
      problems.push(
        `${t}: ${unresolved.length} key(s) with no customer row` +
        (local.length ? ` (${local.length} local)` : "") +
        ` — e.g. ${unresolved.slice(0, 5).join(", ")}`,
      );
    }
  }

  console.log("");
  if (!problems.length) {
    console.log("  ✅ Every key in every deployed table resolves. Slice 2 can add the FKs.");
  } else {
    console.log("  ⚠ Slice 2 is NOT safe yet. Each of these has to be explained first:\n");
    for (const p of problems) console.log(`    · ${p}`);
    console.log(
      "\n  The likely causes, in order: a customer that went inactive in NetSuite\n" +
      "  (its row exists but is retired — that still resolves, so this is not it),\n" +
      "  a local account deleted from pm_crm_accounts while its CRM records stayed,\n" +
      "  or a key written by a path that never had an account behind it.",
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
