/**
 * Print one person's work queue. Reads only.
 *
 *   npx tsx --env-file=.env.vercel scripts/try-my-work.ts zabe@cebasolutions.com
 */
import { buildMyWork } from "@/lib/my-work";
import { resolveOwner } from "@/lib/cs-ownership";

async function main() {
  const email = process.argv[2] ?? "zabe@cebasolutions.com";
  const me = await resolveOwner(email);
  const w = await buildMyWork(email, me.nsId);
  console.log(`${me.name ?? email}  (ns ${me.nsId ?? "unmatched"})  ·  ${w.total} item(s)\n`);
  for (const s of w.sections) {
    console.log(`── ${s.title} (${s.items.length})`);
    for (const i of s.items.slice(0, 8)) {
      const d = i.daysUntil === null ? "no date"
        : i.daysUntil < 0 ? `${Math.abs(i.daysUntil)}d overdue`
        : i.daysUntil === 0 ? "today" : `in ${i.daysUntil}d`;
      console.log(`   ${d.padEnd(13)} ${i.title.slice(0, 54)}${i.customerName ? `  [${i.customerName}]` : ""}`);
    }
    console.log("");
  }
  for (const x of w.warnings) console.log(`⚠ ${x}`);
  if (!w.total) console.log("(nothing assigned)");
}
main().catch(e => { console.error(e.message ?? e); process.exit(1); });
