/**
 * Run profile extraction for one customer and print the result. No database.
 *
 *   npx tsx --env-file=.env.local scripts/try-cs-profile.ts "Salt and Stone"
 *
 * This is the validation gate docs/02-CUSTOMER-PROFILES.md requires before
 * extraction runs at scale — read the output for three accounts you know and
 * answer: is this recognisably the customer? Are the pain points real or
 * filler? Did it find a manual process you had forgotten? Would you quote any
 * of it back to them?
 *
 * If the answer to the last one is no, the fix is upstream — get consultants
 * capturing more at the point of work — not a better prompt.
 */
import Anthropic from "@anthropic-ai/sdk";
import { runSuiteQLAll } from "../lib/netsuite";
import { gatherCustomerCorpus } from "../lib/cs-profile-corpus";
import {
  PROFILE_MODEL, PROFILE_TOOL, profileMessages, validateProfile, extractionDrops,
  findContradictions, type EvidencedItem,
} from "../lib/cs-profile-extract";

const show = (label: string, items: EvidencedItem[]) => {
  console.log(`\n── ${label} (${items.length}) ──`);
  if (!items.length) { console.log("   (none)"); return; }
  for (const i of items) {
    const tag = `${i.confidence}/${i.basis}`;
    console.log(`   • ${i.description}`);
    console.log(`     ${tag.padEnd(16)} ${i.evidence_refs.slice(0, 4).join(", ")}`);
  }
};

async function main() {
  const want = process.argv.slice(2).join(" ") || "Salt and Stone";

  const rows = await runSuiteQLAll<{ id: string; companyname: string }>(`
    SELECT id, companyname FROM customer WHERE isinactive = 'F'
  `);
  const hit = rows.find(r => (r.companyname ?? "").toLowerCase().includes(want.toLowerCase()));
  if (!hit) { console.error(`No customer matching "${want}"`); process.exit(1); }

  console.log(`Gathering corpus for ${hit.companyname} (${hit.id})…`);
  const corpus = await gatherCustomerCorpus(hit.id);
  console.log(`  ${corpus.projects.length} projects · ${corpus.cases.length} cases · ${corpus.stats.uniqueMemoCount} unique memos`);
  for (const n of corpus.stats.notes) console.log(`  ! ${n}`);

  const { system, messages } = profileMessages(corpus, hit.companyname);
  console.log(`  prompt: ${(messages[0].content as string).length} chars\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const message = await client.messages.create({
    model: PROFILE_MODEL, max_tokens: 8_000, system, messages,
    tools: [PROFILE_TOOL], tool_choice: { type: "tool", name: PROFILE_TOOL.name },
  });
  console.log(`Model returned in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
              `(in ${message.usage?.input_tokens} / out ${message.usage?.output_tokens} tokens)`);

  const toolUse = message.content.find(b => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") { console.error("No tool_use block returned."); process.exit(1); }

  const profile = validateProfile(toolUse.input);
  const drops   = extractionDrops(toolUse.input, profile);

  console.log(`\n═══ ${hit.companyname} ═══`);
  console.log(`modules:      ${profile.modules_owned.join(", ") || "(none)"}`);
  console.log(`integrations: ${profile.integrations.join(", ") || "(none)"}`);
  console.log(`edition: ${profile.netsuite_edition ?? "—"} · industry: ${profile.industry ?? "—"} · size: ${profile.company_size ?? "—"}`);

  show("Manual processes — the cross-sell targets", profile.manual_processes);
  show("Pain points", profile.pain_points);
  show("Customisations", profile.customisations);
  show("Enquired, not purchased", profile.features_enquired_not_purchased);
  show("Declined", profile.declined_items);

  if (Object.keys(drops).length) {
    console.log(`\n⚠ Dropped for having no evidence: ${JSON.stringify(drops)}`);
  }

  const contradictions = findContradictions(profile);
  if (contradictions.length) {
    console.log(`\n⚠ Listed as BOTH owned and not-bought: ${contradictions.join(", ")}`);
    console.log(`   Check the evidence before quoting either list back to the customer.`);
  }
}

main().catch(e => { console.error("\nFAILED:", e instanceof Error ? e.message : e); process.exit(1); });
