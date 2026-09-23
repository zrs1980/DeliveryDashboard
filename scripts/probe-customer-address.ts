/**
 * What address data does the customer record actually expose in SuiteQL?
 *
 *   npx tsx --env-file=.env.local scripts/probe-customer-address.ts
 *
 * Written because the CRM account page needs an address and the customer query
 * has never selected one. CLAUDE.md's contract lesson applies: probe properly
 * before concluding a thing is not there — the first pass here found
 * `customeraddressbook` empty and nearly stopped at that.
 */
import { runSuiteQL } from "../lib/netsuite";

async function tryQ(label: string, sql: string) {
  try {
    const rows = await runSuiteQL<Record<string, unknown>>(sql);
    console.log(`\n✅ ${label} — ${rows.length} row(s)`);
    if (rows.length) console.log(JSON.stringify(rows.slice(0, 2), null, 2));
    return rows;
  } catch (e) {
    console.log(`\n❌ ${label}\n   ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    return null;
  }
}

async function main() {
  // ── 1. Every column the customer record actually exposes ────────────────
  // The definitive answer, rather than guessing field names one at a time.
  const one = await tryQ("customer: ALL columns on one active record",
    `SELECT * FROM customer WHERE isinactive = 'F' AND companyname IS NOT NULL
     ORDER BY id DESC FETCH FIRST 1 ROWS ONLY`);
  if (one?.length) {
    const keys = Object.keys(one[0]).sort();
    console.log(`\n   ${keys.length} columns:`);
    console.log("   " + keys.join(", "));
    const addrish = keys.filter(k => /addr|city|state|zip|country|phone|url|billing|shipping/i.test(k));
    console.log(`\n   👉 address/contact shaped: ${addrish.join(", ") || "(none)"}`);
  }

  // ── 2. Other tables that might hold the address ─────────────────────────
  for (const t of ["entityaddress", "address", "customeraddressbook",
                   "customeraddressbookentityaddress", "customerAddressbook"]) {
    await tryQ(`table ${t}`, `SELECT * FROM ${t} FETCH FIRST 2 ROWS ONLY`);
  }

  // ── 3. Does ANY entity type have address-book rows? ─────────────────────
  // Distinguishes "the table is empty account-wide" from "customers happen to
  // have none", which are different problems with different answers.
  await tryQ("address book: total rows",
    `SELECT COUNT(*) AS n FROM customeraddressbook`);
  await tryQ("entity address: total rows",
    `SELECT COUNT(*) AS n FROM entityaddress`);

  // ── 4. Coverage of what we CAN get ──────────────────────────────────────
  await tryQ("coverage on the 180 active customers",
    `SELECT COUNT(*) AS total,
            COUNT(phone) AS with_phone,
            COUNT(email) AS with_email,
            COUNT(url)   AS with_url
     FROM customer WHERE isinactive = 'F'`);
}

main().catch(e => { console.error(e); process.exit(1); });
