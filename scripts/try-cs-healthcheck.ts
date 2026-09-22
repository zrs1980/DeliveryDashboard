/**
 * Generate a health-check email for one customer and print it. No database.
 *
 *   npx tsx --env-file=.env.local scripts/try-cs-healthcheck.ts "Oxide"
 *
 * Extracts a fresh profile, applies the verified-facts filter, and writes the
 * email — so you can read what a customer would actually receive, and see how
 * much was withheld for being unverified.
 */
import Anthropic from "@anthropic-ai/sdk";
import { runSuiteQLAll } from "../lib/netsuite";
import { gatherCustomerCorpus } from "../lib/cs-profile-corpus";
import { PROFILE_MODEL, PROFILE_TOOL, profileMessages, validateProfile, resolveContradictions } from "../lib/cs-profile-extract";
import { HEALTHCHECK_MODEL, HEALTHCHECK_TOOL, healthCheckMessages, quotableFacts, lintDraft } from "../lib/cs-healthcheck";

async function main() {
  const want = process.argv.slice(2).join(" ") || "Oxide";
  const verified = process.env.VERIFIED === "1";

  const rows = await runSuiteQLAll<{id:string;companyname:string}>(`SELECT id, companyname FROM customer WHERE isinactive='F'`);
  const hit = rows.find(r => (r.companyname ?? "").toLowerCase().includes(want.toLowerCase()));
  if (!hit) { console.error(`No customer matching "${want}"`); process.exit(1); }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`Extracting profile for ${hit.companyname}…`);
  const corpus = await gatherCustomerCorpus(hit.id);
  const pm = profileMessages(corpus, hit.companyname);
  const pRes = await client.messages.create({
    model: PROFILE_MODEL, max_tokens: 8000, system: pm.system, messages: pm.messages,
    tools: [PROFILE_TOOL], tool_choice: { type: "tool", name: PROFILE_TOOL.name },
  });
  const pTool = pRes.content.find(b => b.type === "tool_use");
  if (!pTool || pTool.type !== "tool_use") { console.error("no profile"); process.exit(1); }
  const { profile } = resolveContradictions(validateProfile(pTool.input));

  const facts = quotableFacts({ ...profile, customer_name: hit.companyname, human_verified: verified });
  console.log(`\nprofile human_verified = ${verified}`);
  console.log(`quotable: ${facts.painPoints.length} pain · ${facts.manualProcesses.length} manual · ${facts.customisations.length} custom`);
  console.log(`withheld: ${facts.withheld.total}`, JSON.stringify(facts.withheld.byReason));

  const hm = healthCheckMessages(facts, {
    daysSinceLastHour: 12,
    flagTitle: "Engagement halved",
    flagReason: "Hours over the last 90 days are well down on the 90 before.",
    contactName: null,
  });
  const hRes = await client.messages.create({
    model: HEALTHCHECK_MODEL, max_tokens: 1200, system: hm.system, messages: hm.messages,
    tools: [HEALTHCHECK_TOOL], tool_choice: { type: "tool", name: HEALTHCHECK_TOOL.name },
  });
  const hTool = hRes.content.find(b => b.type === "tool_use");
  if (!hTool || hTool.type !== "tool_use") { console.error("no draft"); process.exit(1); }
  const d = hTool.input as {subject:string;body:string;rationale:string;factsUsed:string[]};

  console.log(`\n═══ DRAFT ═══`);
  console.log(`Subject: ${d.subject}\n`);
  console.log(d.body);
  console.log(`\n─── for the reviewer ───`);
  console.log(`Rationale: ${d.rationale}`);
  console.log(`Facts used: ${(d.factsUsed ?? []).join(" | ") || "(none)"}`);
  const lint = lintDraft(d.body);
  console.log(`Lint: ${lint.length ? lint.join(", ") : "clean"}`);
  console.log(`Length: ${d.body.split(/[.!?]\s/).filter(Boolean).length} sentences, ${d.body.length} chars`);
}
main().catch(e => { console.error("FAILED:", e instanceof Error?e.message:e); process.exit(1); });
