import type Anthropic from "@anthropic-ai/sdk";
import { SHARED_TOOL_DEFS, SHARED_SOURCE_KINDS } from "./cs-agent-tools";

/**
 * The account research agent.
 *
 * ⚠ THIS IS THE ONE GENUINELY AGENTIC SURFACE IN THE MODULE, AND IT EARNS IT.
 * Searching an unstructured Drive folder of proposals, UAT sign-offs and
 * meeting notes is not something a fixed query can do: which document matters
 * depends on what the earlier ones said. Everything else in the CS layer —
 * scoring, rules, flags, the renewal clock, suppression, every PDF — stays
 * ordinary deterministic code. The agent proposes; it does not decide, score,
 * or send.
 *
 * ⚠ READ-ONLY BY CONSTRUCTION. There is no write tool. Not "a write tool the
 * prompt tells it not to use" — none is defined, so the loop has no way to
 * reach one. The proposal it produces lands in the existing draft queue behind
 * the existing human approval, so there is one approval path rather than a
 * second one with its own rules.
 */

export const RESEARCH_MODEL = "claude-sonnet-4-6";

/**
 * Hard bounds. An unbounded loop is the failure mode to design against, so
 * these are enforced in the route, not requested in the prompt.
 *
 * 14 calls is roughly: list documents, read 5-7 of them, list projects, pull
 * ClickUp once, search cases twice, submit. Enough to form a view on the
 * richest account in the book (Salt and Stone: 5 Drive folders, 4 ClickUp
 * lists) without letting a confused run read forever.
 */
export const MAX_TOOL_CALLS = 14;
/** Wall-clock stop, comfortably inside the route's maxDuration. */
export const TIME_BUDGET_MS = 240_000;

/**
 * The terminal tool. This one IS the motion — everything else the research
 * agent can do is a shared read tool, defined in lib/cs-agent-tools.ts.
 */
const SUBMIT_FINDINGS: Anthropic.Tool =
  {
    name: "submit_findings",
    description:
      "Finish. Submit what you found. Call this exactly once, when you have "
      + "enough to be useful or you are running out of budget.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "2-4 sentences on where this account stands. Name specifics, not generalities.",
        },
        findings: {
          type: "array",
          description:
            "What you established. Every finding MUST cite evidence you actually "
            + "read. A finding you cannot cite must be left out, not softened.",
          items: {
            type: "object",
            properties: {
              title:      { type: "string", description: "One line." },
              detail:     { type: "string", description: "2-4 sentences with specifics." },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              evidence: {
                type: "array",
                description: "At least one. Where you read this.",
                items: {
                  type: "object",
                  properties: {
                    kind:  { type: "string", enum: ["document", "project", "clickup", "case"] },
                    ref:   { type: "string", description: "File id, project number, task id or case number." },
                    label: { type: "string", description: "Human name, e.g. \"UAT Signoff v3\"." },
                  },
                  required: ["kind", "ref", "label"],
                },
              },
            },
            required: ["title", "detail", "confidence", "evidence"],
          },
        },
        nextSteps: {
          type: "array",
          description:
            "What the account manager should do. At least one must cost the "
            + "customer nothing — a set of recommendations that all carry a price "
            + "tag reads as a sales document and the whole thing collapses.",
          items: {
            type: "object",
            properties: {
              action:     { type: "string", description: "Start with a verb. Be specific." },
              rationale:  { type: "string", description: "Why, referring to a finding." },
              chargeable: { type: "boolean", description: "True if this is billable work or an upsell." },
            },
            required: ["action", "rationale", "chargeable"],
          },
        },
      },
      required: ["summary", "findings", "nextSteps"],
    },
  };

/** Five shared read tools, then the one that ends the run. */
export const RESEARCH_TOOLS: Anthropic.Tool[] = [...SHARED_TOOL_DEFS, SUBMIT_FINDINGS];
export const TERMINAL_TOOL = SUBMIT_FINDINGS.name;


export const RESEARCH_SYSTEM = `
You are a customer success analyst at Loop Services, a NetSuite implementation
partner. You are researching ONE customer account so an account manager can walk
into a conversation knowing where things stand.

HOW TO WORK
- Start from the snapshot you are given, then look at what it points to.
- Read selectively. You have a small, hard budget of tool calls; spend it on the
  material most likely to change what someone would do.
- Follow threads. If a document mentions a defect, look for the support case. If
  a project is over budget, look at what its tasks say.
- Call submit_findings once, at the end.

WHAT MAKES THIS USEFUL
- Specifics. "Phase 2 UAT slipped twice on the same SPS EDI defect" is useful.
  "There have been some delays" is not, and is not worth reporting.
- Every finding must cite something you actually read. If you cannot cite it,
  leave it out — do not soften it into a vaguer claim. A confident-sounding
  finding with nothing behind it is worse than a shorter report, because it gets
  believed anyway.
- Say when the material is thin. "Three documents, all from the 2025 kickoff,
  nothing since" is a real and useful finding about an account. Never pad a
  report to look thorough.

WHAT YOU MUST NOT DO
- Do not infer commercial terms, contract dates or renewal positions. You are
  not shown them and guessing at them produces confident, wrong deadlines.
- Do not write customer-facing text. Your output is read by the account manager.
- Do not recommend only chargeable work. At least one next step must cost the
  customer nothing.
`.trim();

export interface ResearchEvidence { kind: string; ref: string; label: string }
export interface ResearchFinding {
  title: string; detail: string; confidence: "high" | "medium" | "low";
  evidence: ResearchEvidence[];
}
export interface ResearchNextStep { action: string; rationale: string; chargeable: boolean }
export interface ResearchOutput {
  summary: string;
  findings: ResearchFinding[];
  nextSteps: ResearchNextStep[];
  /** Findings dropped for citing nothing, reported rather than hidden. */
  droppedFindings: number;
  /** True when every next step was chargeable and one had to be flagged. */
  allChargeable: boolean;
}

const CONFIDENCE = new Set(["high", "medium", "low"]);
// Pinned to the kinds the shared tools actually emit — an agent with a
// different tool set needs its own enum, and this set must match the one in the
// submit_findings schema above.
const KINDS = new Set<string>(SHARED_SOURCE_KINDS);

/**
 * Re-validate everything the model returned.
 *
 * ⚠ A FINDING WITH NO EVIDENCE IS DROPPED, NOT DOWNGRADED. Same rule as profile
 * extraction: a claim nobody can drill into is worse than a shorter report,
 * because it gets believed anyway. The count dropped is reported so a thin
 * result is visibly thin DATA rather than a weak model.
 */
export function validateResearch(raw: unknown): ResearchOutput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => String(v ?? "").trim();

  const rawFindings = Array.isArray(o.findings) ? o.findings : [];
  const findings: ResearchFinding[] = [];
  let dropped = 0;

  for (const f of rawFindings) {
    const r = (f ?? {}) as Record<string, unknown>;
    const evidence = (Array.isArray(r.evidence) ? r.evidence : [])
      .map(e => (e ?? {}) as Record<string, unknown>)
      .filter(e => s(e.ref) && s(e.label) && KINDS.has(s(e.kind)))
      .map(e => ({ kind: s(e.kind), ref: s(e.ref), label: s(e.label) }));

    if (!s(r.title) || !s(r.detail) || evidence.length === 0) { dropped++; continue; }

    findings.push({
      title: s(r.title), detail: s(r.detail),
      confidence: (CONFIDENCE.has(s(r.confidence)) ? s(r.confidence) : "low") as ResearchFinding["confidence"],
      evidence,
    });
  }

  const nextSteps: ResearchNextStep[] = (Array.isArray(o.nextSteps) ? o.nextSteps : [])
    .map(n => (n ?? {}) as Record<string, unknown>)
    .filter(n => s(n.action))
    .map(n => ({
      action: s(n.action), rationale: s(n.rationale),
      chargeable: Boolean(n.chargeable),
    }));

  // Reported rather than silently rewritten: the model was told the rule, and a
  // reviewer should see that it did not follow it.
  const allChargeable = nextSteps.length > 0 && nextSteps.every(n => n.chargeable);

  return {
    summary: s(o.summary), findings, nextSteps,
    droppedFindings: dropped, allChargeable,
  };
}
