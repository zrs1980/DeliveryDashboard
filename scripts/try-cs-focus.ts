/**
 * Print the Focus dashboard as the route would return it.
 *
 *   npx tsx --env-file=.env.vercel scripts/try-cs-focus.ts
 *
 * The test this is for is the one 03-HEALTH-SCORING.md sets for triage and
 * which applies here too: would you open this every morning without being
 * reminded? A section with forty rows fails it, and so does one that says
 * "nothing here" when the truth is "nothing was recorded".
 */
import { buildFocus } from "@/lib/cs-focus";

async function main() {
  const f = await buildFocus();
  console.log(`index refreshed: ${f.refreshedAt ?? "never"}   ·   ${f.total} item(s) across ${f.sections.length} sections\n`);

  for (const s of f.sections) {
    console.log(`── ${s.title} (${s.items.length}) ${"─".repeat(Math.max(0, 52 - s.title.length))}`);
    console.log(`   why: ${s.why}`);
    if (s.unavailable) {
      console.log(`   ⚠ ${s.unavailable}`);
    } else if (s.summary) {
      console.log(`   ▸ ${s.summary}`);
    } else if (!s.items.length) {
      console.log(`   (nothing)`);
    } else {
      for (const i of s.items.slice(0, 10)) {
        const tone = i.tone === "red" ? "🔴" : i.tone === "yellow" ? "🟡" : "  ";
        console.log(`   ${tone} ${i.name.slice(0, 38).padEnd(38)} ${i.detail}`);
      }
      if (s.items.length > 10) console.log(`      +${s.items.length - 10} more`);
    }
    console.log("");
  }

  const big = f.sections.filter(s => s.items.length > 20);
  if (big.length) {
    console.log(`⚠ ${big.map(s => `"${s.title}" has ${s.items.length} rows`).join("; ")}.`);
    console.log("  A section that long is a list to ignore, not a list to work. Tighten its gate.");
  }
}
main().catch(e => { console.error(e); process.exit(1); });
