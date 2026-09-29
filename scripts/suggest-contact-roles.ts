/**
 * Suggest contact roles across the WHOLE book, in one pass.
 *
 *   npx tsx --env-file=.env.vercel scripts/suggest-contact-roles.ts
 *   npx tsx --env-file=.env.vercel scripts/suggest-contact-roles.ts --write
 *
 * ─── Why this exists alongside the route ────────────────────────────────────
 *
 * `POST /api/crm/contacts/suggest-roles` does one customer, driven from the
 * contacts tab. That is the right shape for adding a person — and the wrong
 * shape for the state the book is actually in. Measured September 2026:
 *
 *     815 contacts, every one role = 'unknown'
 *     0 of 87 scored customers have a contact the CSM agent may write to
 *
 * `role = 'unknown'` is never allowed for any motion, deliberately — a role
 * nobody set is not permission. So the agent is built, tested, and reaches
 * `no_suitable_contact` on every account. Clearing that by hand means opening
 * ~20 accounts and clicking through each; this does the same inference once.
 *
 * ─── What it will not do ────────────────────────────────────────────────────
 *
 * ⚠ IT WRITES `suggested_role`, NEVER `role`. Only a human accepting a
 * suggestion writes the field that authorises contacting someone. That
 * guarantee is the whole design of lib/cs-contact-roles.ts and a bulk script is
 * exactly where it would be most tempting to skip — so it does not, even with
 * --write. Accept in the contacts tab.
 *
 * ⚠ NO TITLE MEANS NO SUGGESTION. The job title is the entire basis. 747 of 815
 * contacts have none, and inventing roles for them would make the column
 * untrustworthy far faster than leaving it empty.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ROLE_MODEL, SUGGEST_TOOL, SUGGEST_SYSTEM,
  suggestionPrompt, validateSuggestions, type ContactForSuggestion,
} from "@/lib/cs-contact-roles";

// One call per chunk. The model sees name + title only, so a chunk this size is
// comfortable — and a failure costs one chunk rather than the whole run.
const CHUNK = 60;

async function main() {
  const write = process.argv.includes("--write");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const db = getSupabaseAdmin();

  const { data: rows, error } = await db
    .from("pm_crm_contacts")
    .select("id, customer_ns_id, name, job_title, role, is_active, suggested_role")
    .eq("is_active", true)
    .eq("role", "unknown");
  if (error) {
    throw new Error(`${error.message}\nRun supabase/cs-phase-a.sql in the Supabase SQL Editor.`);
  }

  const all = rows ?? [];
  const candidates: ContactForSuggestion[] = all
    .filter(c => String(c.job_title ?? "").trim())
    .map(c => ({ id: String(c.id), name: String(c.name), jobTitle: String(c.job_title) }));

  console.log(`${all.length} contact(s) with role = unknown`);
  console.log(`${candidates.length} have a job title and can be judged`);
  console.log(`${all.length - candidates.length} have none — no suggestion, by design\n`);
  if (!candidates.length) return;

  const anthropic = new Anthropic({ apiKey });
  const byId = new Map(all.map(c => [String(c.id), c]));
  const suggestions: { id: string; role: string; reason: string }[] = [];
  let dropped = 0;

  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    process.stdout.write(`  suggesting ${i + 1}–${i + chunk.length}… `);
    try {
      const reply = await anthropic.messages.create({
        model: ROLE_MODEL,
        max_tokens: 4_000,
        system: SUGGEST_SYSTEM,
        tools: [SUGGEST_TOOL],
        tool_choice: { type: "tool", name: SUGGEST_TOOL.name },
        messages: [{ role: "user", content: suggestionPrompt(chunk) }],
      });
      const toolUse = reply.content.find(b => b.type === "tool_use");
      const v = validateSuggestions(
        toolUse && toolUse.type === "tool_use" ? toolUse.input : {}, chunk);
      suggestions.push(...v.suggestions);
      dropped += v.dropped;
      console.log(`${v.suggestions.length} suggested, ${v.dropped} dropped`);
    } catch (e) {
      // One bad chunk must not lose the rest — the same rule the release
      // matcher follows for a single customer failing.
      console.log(`FAILED: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // ── Review table, grouped by account ──────────────────────────────────────
  const byCustomer = new Map<string, typeof suggestions>();
  for (const s of suggestions) {
    const cust = byId.get(s.id)?.customer_ns_id ?? "?";
    byCustomer.set(cust, [...(byCustomer.get(cust) ?? []), s]);
  }

  const { data: idx } = await db.from("cs_customer_index").select("customer_ns_id, name, stage");
  const nameOf = new Map((idx ?? []).map(r => [r.customer_ns_id, r.name]));
  const scored = new Set((idx ?? []).filter(r => r.stage === "CUSTOMER").map(r => r.customer_ns_id));

  console.log(`\n── Suggestions (${suggestions.length}) ${"─".repeat(40)}`);
  for (const [cust, list] of [...byCustomer.entries()]
      .sort((a, b) => (nameOf.get(a[0]) ?? a[0]).localeCompare(nameOf.get(b[0]) ?? b[0]))) {
    console.log(`\n  ${nameOf.get(cust) ?? cust}${scored.has(cust) ? "" : "   (not a scored customer)"}`);
    for (const s of list) {
      const c = byId.get(s.id);
      console.log(`    ${String(c?.name ?? "").slice(0, 26).padEnd(26)} ` +
                  `${String(c?.job_title ?? "").slice(0, 30).padEnd(30)} → ` +
                  `${s.role.padEnd(15)} ${s.reason}`);
    }
  }

  const reachable = [...byCustomer.keys()].filter(c => scored.has(c));
  console.log(`\n${dropped} dropped by validation (unknown id or role — never coerced).`);
  console.log(`${reachable.length} scored customer(s) would gain a usable contact once accepted.`);

  if (!write) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write to store these as`);
    console.log(`suggestions. They still land in suggested_role; accepting them in the`);
    console.log(`contacts tab is what sets role, and only a human does that.`);
    return;
  }

  let written = 0;
  for (const s of suggestions) {
    const { error: e } = await db.from("pm_crm_contacts")
      .update({ suggested_role: s.role, suggested_role_reason: s.reason })
      .eq("id", s.id)
      // Never overwrite a role a human already set, even if the read above said
      // unknown — the run takes minutes and someone may have been working.
      .eq("role", "unknown");
    if (e) { console.log(`  ⚠ ${s.id}: ${e.message}`); continue; }
    written++;
  }
  console.log(`\nWrote ${written} suggestion(s) to suggested_role. role is unchanged on every row.`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
