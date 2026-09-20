/**
 * What raw material exists per customer, and how much survives reduction?
 *
 *   npx tsx --env-file=.env.local scripts/probe-cs-corpus.ts [customerName…]
 *
 * docs/02-CUSTOMER-PROFILES.md says to validate on three accounts you know well
 * before running extraction at scale, and warns that thin source data is an
 * upstream problem no prompt can fix. This answers that question with numbers,
 * and it is cheap to re-run whenever the sources change.
 *
 * Defaults to the three accounts with the most recent delivery activity.
 */
import { runSuiteQLAll } from "../lib/netsuite";
import { gatherCustomerCorpus } from "../lib/cs-profile-corpus";

const DEFAULTS = ["Salt and Stone", "Yield Engineering", "Oxide"];

const k = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

async function main() {
  const wanted = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;

  const all = await runSuiteQLAll<{ id: string; companyname: string }>(`
    SELECT id, companyname FROM customer WHERE isinactive = 'F'
  `);

  const targets = wanted.map(w => {
    const hit = all.find(c => (c.companyname ?? "").toLowerCase().includes(w.toLowerCase()));
    return hit ? { id: Number(hit.id), name: hit.companyname } : { id: NaN, name: w };
  });

  for (const t of targets) {
    if (!Number.isFinite(t.id)) { console.log(`\n═══ ${t.name} — NOT FOUND ═══`); continue; }

    console.log(`\n═══ ${t.name} (customer ${t.id}) ═══`);
    const c = await gatherCustomerCorpus(t.id);

    console.log(`  projects:    ${c.projects.length}`);
    for (const p of c.projects.slice(0, 8)) {
      console.log(`      ${p.entityid.padEnd(5)} ${p.name.slice(0, 54)}${p.userNotes ? "  [has notes]" : ""}`);
    }
    if (c.projects.length > 8) console.log(`      … ${c.projects.length - 8} more`);

    console.log(`  cases:       ${c.cases.length}`);
    console.log(`      body text ${k(c.stats.rawCaseChars)} raw -> ${k(c.stats.keptCaseChars)} after stripping` +
                ` (${c.stats.rawCaseChars ? Math.round(100 - c.stats.keptCaseChars / c.stats.rawCaseChars * 100) : 0}% removed)`);
    if (c.stats.casesTruncated) console.log(`      ${c.stats.casesTruncated} truncated at the per-case cap`);
    for (const cs of c.cases.slice(0, 5)) console.log(`      "${cs.title.slice(0, 72)}"`);

    console.log(`  time memos:  ${k(c.stats.rawMemoCount)} entries -> ${c.stats.uniqueMemoCount} unique`);
    for (const m of c.timeMemos.slice(0, 6)) {
      console.log(`      ${String(m.count).padStart(4)}×  ${m.text.slice(0, 66)}`);
    }

    console.log(`  task titles: ${c.taskTitles.length} unique`);

    // The number that decides whether one model call is even possible.
    const promptish =
      c.projects.reduce((n, p) => n + p.name.length + (p.userNotes?.length ?? 0), 0) +
      c.cases.reduce((n, x) => n + x.title.length + x.text.length, 0) +
      c.timeMemos.reduce((n, m) => n + m.text.length, 0) +
      c.taskTitles.join("").length;
    console.log(`  → corpus after reduction: ${k(promptish)} chars (~${k(Math.round(promptish / 4))} tokens)`);

    for (const n of c.stats.notes) console.log(`  ! ${n}`);
  }

  console.log(`\nA corpus over ~150k tokens needs chunking; under that it fits one call.`);
}

main().catch(e => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
