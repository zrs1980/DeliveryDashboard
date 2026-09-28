/**
 * Assemble one customer record and print what came back.
 *
 *   npx tsx --env-file=.env.vercel scripts/try-customer-record.ts 16650
 *   npx tsx --env-file=.env.vercel scripts/try-customer-record.ts "Salt and Stone"
 *
 * Runs the same assembler the route runs, without a session or a dev server.
 *
 * It prints the record TWICE — once as a cs_layer reader sees it and once as a
 * consultant does — because the claim being made is that the CS block is
 * ABSENT rather than hidden, and the only way to check a claim about absence
 * is to look at both.
 */

import { resolveCustomerKey, fetchCustomerRecord } from "@/lib/customer-record";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSuiteQL } from "@/lib/netsuite";

async function keyFromArg(arg: string): Promise<string | null> {
  if (/^\d+$/.test(arg) || arg.startsWith("local:")) return arg;

  // A name. Try the customers table first, then NetSuite.
  const { data } = await getSupabaseAdmin()
    .from("customers").select("key, name").ilike("name", `%${arg}%`).limit(5);
  if (data?.length) {
    if (data.length > 1) console.log(`(${data.length} matches, using "${data[0].name}")`);
    return data[0].key;
  }
  const rows = await runSuiteQL<{ id: string; companyname: string }>(
    `SELECT id, companyname FROM customer WHERE UPPER(companyname) LIKE ? AND isinactive = 'F'`,
    [`%${arg.toUpperCase()}%`]);
  return rows?.[0] ? String(rows[0].id) : null;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('Usage: try-customer-record.ts <ns id | local:uuid | name>');

  const key = await keyFromArg(arg);
  if (!key) { console.log(`No customer matching "${arg}".`); return; }

  const resolved = await resolveCustomerKey(key);
  if (!resolved) { console.log(`Could not resolve ${key}.`); return; }
  console.log(`key=${resolved.key}  customers.id=${resolved.id ?? "(none)"}\n`);

  for (const csLayer of [true, false]) {
    const r = await fetchCustomerRecord(resolved.key, resolved.id, csLayer);
    if (!r) { console.log("Not found."); return; }

    console.log(`── as ${csLayer ? "a cs_layer reader" : "a consultant"} ` + "─".repeat(38));
    const c = r.customer;
    console.log(`  ${c.name}  [${c.entityid ?? "—"}]  ${c.isLocal ? "LOCAL" : c.isActive ? "active" : "INACTIVE"}`);
    console.log(`  ${c.entitystatusLabel ?? c.stage ?? "—"} · ${c.industry ?? "no industry"} · sub ${c.subsidiaryId ?? "—"}`);
    console.log(`  phone ${c.phone ?? "—"} · email ${c.email ?? "—"}`);
    console.log(`  address: ${c.billingAddress ? c.billingAddress.replace(/\n/g, " / ") : "—"}`);
    console.log(`  counts: ${r.projects.length} projects · ${r.contacts.length} contacts · ` +
                `${r.opportunities.length} deals · ${r.tasks.length} tasks · ${r.activities.length} activities`);

    if (r.currentContract) {
      const k = r.currentContract;
      console.log(`  contract: ${k.status} to ${k.endDate} · ${k.daysToNotice ?? "?"}d to ` +
                  `${k.noticeIsEndDate ? "END (no notice period recorded)" : "notice"}` +
                  `${k.alertBand ? ` · band ${k.alertBand}` : ""}`);
    } else {
      console.log(`  contract: none (${r.contracts.length} rows)`);
    }

    console.log(`  cs block: ${"cs" in r ? "PRESENT" : "ABSENT"}`);
    if (r.cs) {
      console.log(`    health ${r.cs.healthScore ?? "—"} (${r.cs.healthBand ?? "—"}) · ` +
                  `${r.cs.openFlags.length} open flag(s) · ` +
                  `profile ${r.cs.profile ? (r.cs.profileVerified ? "verified" : "yes") : "none"} · ` +
                  `${r.cs.drafts.length} draft(s)`);
      for (const f of r.cs.openFlags.slice(0, 5)) console.log(`      ⚑ ${f.rule_id} [${f.severity ?? "—"}]`);
    }

    // The point of printing both: no health field may survive into the
    // consultant view by any route, including a stray key on the record.
    const leaked = Object.keys(r).filter(k => /health|flag|profile|draft|score|band/i.test(k));
    if (!csLayer && leaked.length) console.log(`    ⚠ LEAK: ${leaked.join(", ")}`);

    for (const w of r.warnings) console.log(`  ⚠ ${w}`);
    console.log("");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
