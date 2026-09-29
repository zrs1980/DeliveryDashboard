/**
 * Check which meetings land on which customer, and what the matching learned.
 *
 *   npx tsx --env-file=.env.vercel scripts/verify-customer-meetings.ts
 *
 * Read-only. The section that matters is **domains learned only from
 * meetings** — a domain the customer's own NetSuite website or a contact record
 * confirms is safe, but one learned purely because someone sat in a call could
 * be a partner or a vendor rather than the customer.
 *
 * That is not a hypothetical: `myersholum.com` was learned as Certified Waste
 * Solutions on the first real run, because Myers-Holum attended three of their
 * meetings and nobody else's. Nothing in the data tells a partner apart from a
 * customer, so anything listed there needs a human glance and, if it is a
 * partner, an entry in PARTNER_DOMAINS.
 */

import { buildDomainMapDetailed, fetchCustomerMeetings } from "@/lib/customer-meetings";
import { getSupabaseAdmin } from "@/lib/supabase";

async function main() {
  const { map, meetingOnly, ambiguous } = await buildDomainMapDetailed();

  const { data: idx } = await getSupabaseAdmin()
    .from("cs_customer_index").select("customer_ns_id, name");
  const nameOf = new Map((idx ?? []).map(r => [r.customer_ns_id, r.name]));
  const label = (id: string) => nameOf.get(id) ?? id;

  console.log(`domain → customer entries : ${map.size}`);
  console.log(`dropped as ambiguous      : ${ambiguous.length}`);

  const seen = new Set<string>();
  const rows: { name: string; total: number; processed: number }[] = [];
  for (const cust of map.values()) {
    if (seen.has(cust)) continue;
    seen.add(cust);
    const r = await fetchCustomerMeetings(cust);
    if (r.unavailable) { console.log(`\n⚠ ${r.unavailable}`); return; }
    if (r.meetings.length) rows.push({
      name: label(cust),
      total: r.meetings.length,
      processed: r.meetings.filter(m => m.processed).length,
    });
  }

  console.log(`\n── Meetings matched per customer ${"─".repeat(30)}`);
  console.log(`  customer                             total  processed  unprocessed`);
  for (const r of rows.sort((a, b) => b.total - a.total)) {
    console.log(`  ${r.name.slice(0, 36).padEnd(36)} ${String(r.total).padStart(5)}` +
                `${String(r.processed).padStart(11)}${String(r.total - r.processed).padStart(13)}`);
  }
  const t = rows.reduce((n, r) => n + r.total, 0);
  const p = rows.reduce((n, r) => n + r.processed, 0);
  console.log(`  ${"TOTAL".padEnd(36)} ${String(t).padStart(5)}${String(p).padStart(11)}${String(t - p).padStart(13)}`);

  console.log(`\n── Domains learned ONLY from meetings ${"─".repeat(25)}`);
  if (!meetingOnly.length) {
    console.log("  (none — every matched domain is confirmed by a website or a contact)");
  } else {
    console.log("  Neither the customer's NetSuite website nor any contact record confirms");
    console.log("  these. Check each one is really that customer and not a partner:\n");
    for (const d of meetingOnly) console.log(`  ${d.padEnd(34)} → ${label(map.get(d)!)}`);
    console.log(`\n  A partner belongs in PARTNER_DOMAINS in lib/customer-meetings.ts.`);
  }

  if (ambiguous.length) {
    console.log(`\n── Dropped, claimed by two customers ${"─".repeat(26)}`);
    for (const d of ambiguous) console.log(`  ${d}`);
    console.log(`  These match nothing, deliberately — a wrong timeline row gets believed.`);
  }
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
