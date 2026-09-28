/**
 * Sync the `customers` identity table and report what slice 2 will find.
 *
 *   npx tsx --env-file=.env.local scripts/verify-customers-table.ts
 *
 * Two jobs:
 *
 *  1. Run syncCustomers() for real and print what it did.
 *  2. For every table that references a customer, report two numbers:
 *
 *       UNRESOLVED — distinct keys with no `customers` row. A foreign key
 *                    would reject these. Must be 0 before slice 2 is applied.
 *       UNLINKED   — rows carrying a key but no `customer_id`. Must be 0 after
 *                    slice 2 is applied; before that it is simply the row
 *                    count, because the column does not exist yet.
 *
 * The second half is the point. Adding a FK to 22 tables is only safe if every
 * value already present can be resolved, and "it should be fine" is not a
 * number — on the first real run it was 82, all of them customers that had
 * gone inactive in NetSuite, which is how the identity universe got widened.
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
  console.log(`  NetSuite customers : ${r.netsuite}  (${r.netsuiteInactive} inactive, carried for history)`);
  console.log(`  customer_id relinks: ${r.relinked === null ? "— (customers-fk.sql not run)" : r.relinked}`);
  console.log(`  Local prospects    : ${r.local}`);
  console.log(`  Retired this run   : ${r.deactivated}`);
  console.log(`  Merged this run    : ${r.merged}`);
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);

  const byKey = await customerIdByKey();
  console.log(`\n  Resolvable keys    : ${byKey.size}\n`);

  console.log("── Foreign-key readiness ──────────────────────────────────────\n");
  console.log("  table                         rows   keys  unresolved  unlinked");
  console.log("  ──────────────────────────────────────────────────────────────────");

  const supabase = getSupabaseAdmin();
  const problems: string[] = [];

  let fkApplied = true;

  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select("customer_ns_id, customer_id");
    // No customer_id column means the slice-2 SQL has not run on this table.
    const { data: keyOnly, error: keyErr } = error
      ? await supabase.from(t).select("customer_ns_id")
      : { data: null, error: null };
    if (error && !keyErr) fkApplied = false;

    if (error && keyErr) {
      // A missing table is information, not a failure: several of these are
      // specced but never deployed, and slice 2 must not try to alter them.
      console.log(`  ${t.padEnd(28)}  ${/does not exist|schema cache/i.test(keyErr.message) ? "— not deployed" : "ERROR: " + keyErr.message}`);
      continue;
    }

    const rows: { customer_ns_id: string | null; customer_id?: string | null }[] =
      (data ?? keyOnly ?? []) as never;
    const keys = new Set(rows.map(x => x.customer_ns_id).filter(Boolean) as string[]);
    const unresolved = [...keys].filter(k => !byKey.has(k));
    const unlinked = error
      ? null   // no customer_id column yet
      : rows.filter(x => x.customer_ns_id && !x.customer_id).length;

    console.log(
      `  ${t.padEnd(28)} ${String(rows.length).padStart(5)}  ${String(keys.size).padStart(5)}  ` +
      `${unresolved.length ? String(unresolved.length).padStart(9) + " ⚠" : "        0 "}  ` +
      `${unlinked === null ? "     —" : unlinked ? String(unlinked).padStart(6) + " ⚠" : "     0"}`,
    );

    if (unlinked) {
      problems.push(`${t}: ${unlinked} row(s) carry a key but no customer_id — re-run customers_relink_all()`);
    }

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
  if (!fkApplied) {
    console.log("  ℹ customer_id is missing on at least one table — run supabase/customers-fk.sql.\n");
  }
  if (!problems.length) {
    console.log(fkApplied
      ? "  ✅ Every key resolves and every row is linked."
      : "  ✅ Every key in every deployed table resolves. Slice 2 can add the FKs.");
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
