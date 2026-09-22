import type Anthropic from "@anthropic-ai/sdk";

// ─── Health check motion ────────────────────────────────────────────────────
//
// The simplest generator, and the one that exercises the whole pipeline. A
// short, specific, personal email referencing something real about the account.
// Its purpose is a reply, not a meeting and certainly not a sale.
//
// ⚠ THE NO-FABRICATION RULE IS ENFORCED HERE, NOT IN THE PROMPT.
//
// docs/04-DRAFT-QUEUE.md is explicit: "This must be enforced in the generation
// step, not left to the model's discretion — pass only verified fields into the
// prompt." So quotableFacts() filters the profile BEFORE the model sees it. The
// model cannot reference an unverified pain point because it is never told one
// exists. A prompt instruction not to fabricate is a request; withholding the
// material is a guarantee.
//
// What qualifies (docs/02-CUSTOMER-PROFILES.md):
//   high confidence                     → usable
//   medium + the profile human-verified → usable
//   anything inferred, unless verified  → withheld
//   low confidence                      → withheld, always
//
// Everything withheld is counted and reported, so a thin draft is visibly the
// result of thin verified data rather than a weak model.

export const HEALTHCHECK_MODEL = "claude-sonnet-4-6";

interface EvidencedItem {
  description: string;
  evidence_refs: string[];
  confidence: "high" | "medium" | "low";
  basis: "observed" | "inferred";
}

export interface ProfileLike {
  customer_name?: string;
  modules_owned?: string[];
  integrations?: string[];
  pain_points?: EvidencedItem[];
  manual_processes?: EvidencedItem[];
  customisations?: EvidencedItem[];
  human_verified?: boolean;
  human_notes?: string | null;
}

export interface QuotableFacts {
  customerName:  string;
  modules:       string[];
  integrations:  string[];
  painPoints:    EvidencedItem[];
  manualProcesses: EvidencedItem[];
  customisations: EvidencedItem[];
  humanNotes:    string | null;
  withheld:      { total: number; byReason: Record<string, number> };
}

function usable(item: EvidencedItem, profileVerified: boolean): { ok: boolean; reason?: string } {
  if (item.confidence === "low") return { ok: false, reason: "low confidence" };
  if (item.basis === "inferred" && !profileVerified) return { ok: false, reason: "inferred, profile not verified" };
  if (item.confidence === "medium" && !profileVerified) return { ok: false, reason: "medium confidence, profile not verified" };
  return { ok: true };
}

export function quotableFacts(profile: ProfileLike): QuotableFacts {
  const verified = Boolean(profile.human_verified);
  const byReason: Record<string, number> = {};
  let total = 0;

  const filter = (items: EvidencedItem[] | undefined) =>
    (items ?? []).filter(i => {
      const v = usable(i, verified);
      if (!v.ok) { total++; byReason[v.reason!] = (byReason[v.reason!] ?? 0) + 1; }
      return v.ok;
    });

  return {
    customerName:    profile.customer_name ?? "",
    // Modules and integrations are structured observations, not claims — they
    // come from project names and configuration work. Safe to reference.
    modules:         profile.modules_owned ?? [],
    integrations:    profile.integrations ?? [],
    painPoints:      filter(profile.pain_points),
    manualProcesses: filter(profile.manual_processes),
    customisations:  filter(profile.customisations),
    humanNotes:      profile.human_notes ?? null,
    withheld:        { total, byReason },
  };
}

export const HEALTHCHECK_TOOL: Anthropic.Tool = {
  name: "write_health_check",
  description: "Write a short health-check email to this customer.",
  input_schema: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "Plain and specific. No marketing phrasing, no colons-and-tagline constructions. Six words or fewer is usually right.",
      },
      body: {
        type: "string",
        description: "Three to five sentences. Plain text, no greeting line beyond 'Hi <name>,' and no signature — the sender's own signature is appended by their mail client.",
      },
      rationale: {
        type: "string",
        description: "One or two sentences for the REVIEWER, not the customer: why this account, why now, and which fact you built the email around.",
      },
      factsUsed: {
        type: "array", items: { type: "string" },
        description: "The specific facts you referenced, copied from what you were given. If you could not reference anything specific, return an empty array and say so in the rationale.",
      },
    },
    required: ["subject", "body", "rationale", "factsUsed"],
  },
};

const SYSTEM = `You write short check-in emails on behalf of a NetSuite implementation partner, to customers they have delivered work for.

The goal is a REPLY. Not a meeting, not a sale, not a "quick call". A reply.

Rules, in order:

1. Reference something true and particular about this account. If the email could have been sent to any customer, it is worthless. You will be given a small set of verified facts — use one of them concretely.

2. Never state anything you were not given. You have been handed only verified material; everything unverified was deliberately withheld. If what you have is too thin to say anything specific, write a brief honest note and say so in the rationale rather than inventing detail. A vague email is recoverable; a wrong one is not.

3. Three to five sentences. Long automated email reads as marketing and gets filed accordingly.

4. One ask at most, and usually the ask is just a reply. Not a meeting invitation.

5. Lead with the observation, not the ask. "Noticed the Q3 work wrapped and it's been quiet since — did the new process settle in okay?" is the shape.

6. Write like a person who knows them. No "I hope this email finds you well". No "I wanted to reach out". No "circling back", no "touching base", no bullet-pointed value propositions, no em-dash-heavy corporate cadence. Contractions are fine. Short sentences are fine.

7. Do not thank them for business, do not mention how long it has been in a way that sounds like a reproach, and do not apologise for the silence.

8. Never mention internal metrics. Logged hours, health scores, flags and engagement trends are our instrumentation, not their world — "we noticed our logged hours have been quiet" reads to the customer as "we noticed we haven't billed you lately". The silence is your reason for writing, not your subject. Write about what happened on their side: work that wrapped, a system that went live, a problem that was solved, a process they were left running by hand.`;

export function healthCheckMessages(facts: QuotableFacts, context: {
  daysSinceLastHour: number | null;
  flagTitle: string;
  flagReason: string;
  contactName?: string | null;
}) {
  const parts: string[] = [];
  parts.push(`CUSTOMER: ${facts.customerName}`);
  if (context.contactName) parts.push(`WRITING TO: ${context.contactName}`);
  // Framed as internal on purpose. Handed over plainly, the model reaches for
  // it as the opening line, and "we noticed our logged hours have been quiet"
  // tells the customer about our billing rather than about them.
  parts.push(`\nINTERNAL — WHY THIS CAME UP (for your rationale, NOT for the email):`);
  parts.push(`${context.flagTitle} — ${context.flagReason}`);
  if (context.daysSinceLastHour !== null) {
    parts.push(`Last consultant time logged: ${context.daysSinceLastHour} days ago.`);
  }
  parts.push(`Do not mention any of the above to the customer. It is why you are writing, not what you are writing about.`);

  if (facts.modules.length)      parts.push(`\nMODULES THEY USE: ${facts.modules.join(", ")}`);
  if (facts.integrations.length) parts.push(`INTEGRATIONS: ${facts.integrations.join(", ")}`);

  const list = (label: string, items: EvidencedItem[]) => {
    if (!items.length) return;
    parts.push(`\n${label}:`);
    for (const i of items) parts.push(`- ${i.description}`);
  };
  list("VERIFIED PAIN POINTS", facts.painPoints);
  list("VERIFIED MANUAL PROCESSES", facts.manualProcesses);
  list("WORK BUILT FOR THEM", facts.customisations);

  if (facts.humanNotes) parts.push(`\nNOTES FROM THE TEAM: ${facts.humanNotes}`);

  if (facts.withheld.total > 0) {
    parts.push(
      `\n(${facts.withheld.total} further item(s) exist on this account but were withheld as ` +
      `unverified. You have not been told what they are and must not speculate about them.)`,
    );
  }

  if (!facts.painPoints.length && !facts.manualProcesses.length && !facts.customisations.length) {
    parts.push(
      `\nNOTE: there are no verified specifics for this account. Say something brief and honest ` +
      `rather than inventing detail, and flag the thinness in your rationale.`,
    );
  }

  return { system: SYSTEM, messages: [{ role: "user" as const, content: parts.join("\n") }] };
}

/** Reject obvious corporate filler the spec names explicitly. */
export const BANNED_PHRASES = [
  "hope this email finds you well",
  "hope this finds you well",
  "wanted to reach out",
  "circling back",
  "touching base",
  "just checking in to see",
  "at your earliest convenience",
  "synergy",
  "value proposition",
];

export function lintDraft(body: string): string[] {
  const lower = body.toLowerCase();
  return BANNED_PHRASES.filter(p => lower.includes(p));
}
