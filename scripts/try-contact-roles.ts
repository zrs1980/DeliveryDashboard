/**
 * Role suggestions against REAL NetSuite job titles, without writing anything.
 *
 *   npx tsx --env-file=.env.local scripts/try-contact-roles.ts [customer name]
 *
 * 07-BUILD-SEQUENCE.md: validate on known accounts and read the output yourself
 * before running at scale. The thing to check is not "did it label everyone" —
 * it is whether it DECLINED the vague ones. A suggester that labels
 * "Contact", "Info" and "Manager" trains the reviewer to click Accept without
 * looking, which is worse than no suggestions at all.
 *
 * Reads NetSuite directly and never touches Supabase, so it runs anywhere the
 * NetSuite keys are present.
 */
import Anthropic from "@anthropic-ai/sdk";
import { runSuiteQL } from "../lib/netsuite";
import {
  ROLE_MODEL, SUGGEST_TOOL, SUGGEST_SYSTEM,
  suggestionPrompt, validateSuggestions, type ContactForSuggestion,
} from "../lib/cs-contact-roles";

async function main() {
  const want = process.argv.slice(2).join(" ").trim();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }

  const where = want
    ? `AND LOWER(c.companyname) LIKE '%${want.toLowerCase().replace(/'/g, "''")}%'`
    : "AND c.entitystatus = 13";

  const rows = await runSuiteQL<Record<string, string | null>>(`
    SELECT ct.id, ct.entityid AS name, ct.title AS job_title, c.companyname AS customer
    FROM contact ct
    JOIN customer c ON c.id = ct.company
    WHERE ct.isinactive = 'F' AND c.isinactive = 'F' ${where}
    ORDER BY c.companyname, ct.id
    FETCH FIRST 40 ROWS ONLY
  `);

  if (!rows.length) { console.log("No contacts matched."); return; }

  const contacts: ContactForSuggestion[] = rows.map(r => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    jobTitle: String(r.job_title ?? "").trim() || null,
  }));

  const withTitle = contacts.filter(c => c.jobTitle);
  console.log(`${contacts.length} contacts, ${withTitle.length} with a job title`);
  console.log(`(${contacts.length - withTitle.length} have none — those are never sent to the model)\n`);
  if (!withTitle.length) return;

  const anthropic = new Anthropic({ apiKey });
  const reply = await anthropic.messages.create({
    model: ROLE_MODEL,
    max_tokens: 4_000,
    system: SUGGEST_SYSTEM,
    tools: [SUGGEST_TOOL],
    tool_choice: { type: "tool", name: SUGGEST_TOOL.name },
    messages: [{ role: "user", content: suggestionPrompt(withTitle) }],
  });

  const toolUse = reply.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
  if (!toolUse) { console.error("No tool use in the reply."); process.exit(1); }

  const { suggestions, dropped } = validateSuggestions(toolUse.input, withTitle);
  const byId = new Map(withTitle.map(c => [c.id, c]));
  const suggested = new Set(suggestions.map(s => s.id));

  console.log("SUGGESTED");
  for (const s of suggestions) {
    const c = byId.get(s.id)!;
    console.log(`  ${s.role.padEnd(15)} ${String(c.jobTitle).slice(0, 38).padEnd(40)} ${s.reason}`);
  }

  const declined = withTitle.filter(c => !suggested.has(c.id));
  console.log(`\nDECLINED (${declined.length}) — read these: they should be the genuinely ambiguous ones`);
  for (const c of declined) console.log(`  ${c.jobTitle}`);

  if (dropped) console.log(`\n${dropped} response row(s) discarded as unusable.`);
  console.log(`\n${suggestions.length} of ${withTitle.length} titled contacts labelled.`);
}

main().catch(e => { console.error(String(e).slice(0, 400)); process.exit(1); });
