/**
 * Print the morning digest for everyone who has one. Sends nothing.
 *
 *   npx tsx --env-file=.env.vercel scripts/try-digest.ts
 *   npx tsx --env-file=.env.vercel scripts/try-digest.ts zabe@cebasolutions.com
 *
 * The test is whether you would act on it, not whether it rendered.
 */
import { buildDigests, renderDigest } from "@/lib/digest";

async function main() {
  const only = process.argv[2]?.toLowerCase();
  const all = await buildDigests();
  const show = only ? all.filter(d => d.email === only) : all;

  console.log(`${all.length} person/people have something waiting.\n`);
  if (only && !show.length) {
    console.log(`Nothing for ${only} — which means no message would be sent.`);
    return;
  }
  for (const d of show) {
    console.log("─".repeat(66));
    console.log(`${d.name ?? d.email}  <${d.email}>`);
    console.log("─".repeat(66));
    console.log(renderDigest(d).replace(/\*/g, ""));
    console.log("");
  }
}
main().catch(e => { console.error(e.message ?? e); process.exit(1); });
