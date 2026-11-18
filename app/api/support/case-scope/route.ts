import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { runSuiteQL } from "@/lib/netsuite";
import { scopeKey, type CaseScopeResult, type ScopeVerdict, type SupportTier } from "@/lib/support-scope";

export const revalidate = 0;
export const maxDuration = 120;

/**
 * POST /api/support/case-scope  { items: [{ caseId, tier }] }
 *
 * Reads each case's opening message (supportcase.incomingmessage) and asks
 * Claude whether it falls inside the customer's support agreement. Returns one
 * verdict per (case, tier). Read-only — nothing is written to NetSuite.
 *
 * Verdicts are cached per warm instance by case + tier + priority: the opening
 * message never changes after creation, but the priority can, and Standard
 * support's scope depends on it.
 */

const MODEL = "claude-sonnet-4-6";
const MAX_ITEMS = 200;
const BATCH = 30;
const MSG_CHARS = 1500;

const SCOPE_RULES: Record<SupportTier, string> = {
  gc: `GENERAL CONSULTING — includes break-fix, administration, configuration, training and project work.
Almost everything is in scope. Flag only work clearly outside all of those.`,
  msa: `MANAGED SERVICES AGREEMENT (MSA) — includes break-fix, bug fixes and administration requests
(new reports, saved searches, role changes, minor configuration), drawn down against the monthly hours bucket.
NEW DEVELOPMENT (new scripts, new customisations, new integrations, new features) is NOT included: it is a
service request with its own Statement of Work → "sow".`,
  standard: `STANDARD SUPPORT — includes Critical issues (the customer's business cannot operate), plus bug fixes and
patches in the Loop ERP application and its modules.
- High, Medium and Low severity issues that are not Loop ERP bugs → "billable".
- Administration requests (reports, saved searches, roles, minor config) → "billable".
- Implementation, configuration, training and project work → "sow".
- Issues in the NetSuite base product (not Loop ERP) are only covered under Platinum → "billable".`,
  premium: `PREMIUM SUPPORT — includes issues at all four severity levels with contractual first-response times,
bug fixes and patches, and the priority phone line, for the Loop ERP application and its modules.
- Administration requests (reports, saved searches, roles, minor config) → "billable".
- Implementation, configuration, training and project work → "sow".
- Issues in the NetSuite base product (not Loop ERP) are only covered under Platinum → "billable".`,
  platinum: `PLATINUM SUPPORT — everything in Premium (all severity levels, bug fixes and patches), extended to the
NetSuite base product. Loop is the single point of contact for every case and manages Oracle on the customer's behalf,
so NetSuite base-product issues ARE in scope.
- Administration requests (reports, saved searches, roles, minor config) → "billable".
- Implementation, configuration, training and project work → "sow".`,
};

const SYSTEM = `You review support cases for Loop Services, a NetSuite partner that also sells the Loop ERP
application built on NetSuite. For each case you get the customer's support agreement type, the case priority,
its title and the opening message the customer sent. Decide whether the request is covered by that agreement.

Verdicts:
- "in_scope": covered by the agreement.
- "billable": outside the agreement and chargeable as extra work.
- "sow": needs its own Statement of Work / service request (implementation, configuration, training,
  project work, or for MSA new development).

Only return "billable" or "sow" when the case text reasonably supports it. When the message is too thin to
tell, or it reads like a fault or bug report, return "in_scope". Keep each reason to one short sentence a PM can
act on, naming what the request is.

Agreement rules:
${(Object.keys(SCOPE_RULES) as SupportTier[]).map(t => `\n[${t}]\n${SCOPE_RULES[t]}`).join("\n")}`;

const TOOL: Anthropic.Tool = {
  name: "record_case_scope",
  description: "Record a scope verdict for every case supplied.",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key:     { type: "string", description: "The case key exactly as given." },
            verdict: { type: "string", enum: ["in_scope", "billable", "sow"] },
            reason:  { type: "string" },
          },
          required: ["key", "verdict", "reason"],
        },
      },
    },
    required: ["results"],
  },
};

const cache = new Map<string, CaseScopeResult>();

const TIERS: SupportTier[] = ["msa", "gc", "standard", "premium", "platinum"];
const VERDICTS: ScopeVerdict[] = ["in_scope", "billable", "sow"];

function plainText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });

  let body: { items?: Array<{ caseId?: unknown; tier?: unknown }> };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  // Case ids go into SuiteQL, so only plain integers are accepted.
  const items = (body.items ?? [])
    .map(i => ({ caseId: String(i.caseId ?? ""), tier: i.tier as SupportTier }))
    .filter(i => /^\d+$/.test(i.caseId) && TIERS.includes(i.tier))
    .slice(0, MAX_ITEMS);
  if (items.length === 0) return NextResponse.json({ results: [] });

  try {
    const ids = [...new Set(items.map(i => i.caseId))];
    const rows = await runSuiteQL<{
      id: string; casenumber: string | null; title: string | null;
      incomingmessage: string | null; priority: string | null;
    }>(`
      SELECT sc.id, sc.casenumber, sc.title, sc.incomingmessage, BUILTIN.DF(sc.priority) AS priority
      FROM supportcase sc
      WHERE sc.id IN (${ids.join(",")})
    `);
    const byId = new Map(rows.map(r => [String(r.id), r]));

    const results: CaseScopeResult[] = [];
    const todo: Array<{ key: string; cacheKey: string; caseId: string; tier: SupportTier; text: string }> = [];

    for (const i of items) {
      const r = byId.get(i.caseId);
      if (!r) continue;
      const cacheKey = `${scopeKey(i.caseId, i.tier)}|${r.priority ?? ""}`;
      const hit = cache.get(cacheKey);
      if (hit) { results.push(hit); continue; }
      const message = plainText(r.incomingmessage ?? "").slice(0, MSG_CHARS) || "(no message)";
      todo.push({
        key: scopeKey(i.caseId, i.tier),
        cacheKey,
        caseId: i.caseId,
        tier: i.tier,
        text: `KEY: ${scopeKey(i.caseId, i.tier)}\nAGREEMENT: ${i.tier}\nPRIORITY: ${r.priority ?? "—"}\n`
          + `TITLE: ${r.title ?? "(no title)"}\nMESSAGE:\n${message}`,
      });
    }

    const client = new Anthropic({ apiKey });
    const batches: typeof todo[] = [];
    for (let k = 0; k < todo.length; k += BATCH) batches.push(todo.slice(k, k + BATCH));

    await Promise.all(batches.map(async batch => {
      const reply = await client.messages.create({
        model: MODEL,
        max_tokens: 4_000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{
          role: "user",
          content: `Classify these ${batch.length} cases.\n\n${batch.map(b => b.text).join("\n\n---\n\n")}`,
        }],
      });
      const toolUse = reply.content.find((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
      const out = (toolUse?.input as { results?: Array<{ key?: string; verdict?: string; reason?: string }> })?.results ?? [];
      const wanted = new Map(batch.map(b => [b.key, b]));
      for (const o of out) {
        const b = o.key ? wanted.get(o.key) : undefined;
        if (!b) continue;   // a key we did not send is ignored
        const verdict = VERDICTS.includes(o.verdict as ScopeVerdict) ? o.verdict as ScopeVerdict : "in_scope";
        const res: CaseScopeResult = {
          caseId: b.caseId, tier: b.tier, verdict,
          reason: String(o.reason ?? "").slice(0, 300),
        };
        cache.set(b.cacheKey, res);
        results.push(res);
      }
    }));

    return NextResponse.json({ results });
  } catch (e) {
    console.error("[/api/support/case-scope]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
