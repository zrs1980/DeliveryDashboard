import type Anthropic from "@anthropic-ai/sdk";

// ─── Release matching ───────────────────────────────────────────────────────
//
// docs/05-RELEASE-MATCHING.md calls this "the core value of the whole build",
// and the reasoning is worth keeping in front of whoever works on it next:
//
//   NetSuite ships two major releases a year, each with hundreds of changes.
//   Customers ignore the release notes because they are written for everyone and
//   therefore land for no one. We know each customer's modules, customisations,
//   pain points and manual processes — so we can send each one a document
//   containing ONLY what affects them, with customer-specific reasoning.
//
//   Ten customers receive ten different PDFs. That is the differentiator. It
//   turns upsell outreach from a pitch into a service.
//
// The failure mode is generating ten near-identical documents and calling them
// personalised. The spec's validation step exists for exactly that: generate
// three, read them side by side, and if they are substantially similar the
// matching is not working and the profiles are too thin. A generic "personalised"
// document is worse than sending nothing, because it teaches the customer to
// ignore you.

export const RELEASE_MODEL = "claude-sonnet-4-6";

export type ReleaseCategory = "new_feature" | "enhancement" | "deprecation" | "breaking_change";

export interface ReleaseItem {
  id?:               string;
  product:           "netsuite" | "loop_erp";
  release_version:   string;
  release_date:      string | null;
  title:             string;
  description:       string;
  source_url:        string | null;
  modules_affected:  string[];
  relevance_criteria: Record<string, unknown>;
  category:          ReleaseCategory | null;
}

// ─── Ingestion ──────────────────────────────────────────────────────────────
//
// Manual paste is a first-class path, not a fallback. The spec is blunt about
// why: "release note formats change and an ingestion pipeline that breaks twice
// a year at exactly the moment you need it is worse than a paste box."

export const PARSE_TOOL: Anthropic.Tool = {
  name: "record_release_items",
  description: "Break pasted release notes into individual, separately-matchable items.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "One entry per distinct change. Split aggressively — an item covering three unrelated features cannot be matched to anyone properly.",
        items: {
          type: "object",
          properties: {
            title:       { type: "string", description: "Short and concrete, as the release notes phrase it." },
            description: { type: "string", description: "What actually changes, in two or three sentences. Keep the vendor's specifics; drop the marketing." },
            modules_affected: {
              type: "array", items: { type: "string" },
              description: "NetSuite modules, SuiteApps or feature areas this touches — e.g. 'Advanced Inventory', 'SuiteTax', 'Work Orders'. This is the primary matching key, so be precise rather than broad.",
            },
            category: {
              type: "string", enum: ["new_feature", "enhancement", "deprecation", "breaking_change"],
              description: "Deprecations and breaking changes matter as much as new features — they are a reason to call that has nothing to do with selling.",
            },
            relevance_criteria: {
              type: "object",
              description: "Structured conditions for matching.",
              properties: {
                requires_modules:   { type: "array", items: { type: "string" }, description: "Modules a customer must own for this to be relevant at all." },
                addresses_problems: { type: "array", items: { type: "string" }, description: "Kinds of pain or manual work this removes, in plain terms — e.g. 'manual inventory counting', 'spreadsheet-based reconciliation'." },
                affects_integrations: { type: "array", items: { type: "string" }, description: "Integrations or customisations this could disturb." },
                action_required:    { type: "boolean", description: "True if a customer using this must do something before the release lands." },
              },
            },
          },
          required: ["title", "description", "modules_affected", "category", "relevance_criteria"],
        },
      },
    },
    required: ["items"],
  },
};

const PARSE_SYSTEM = `You break NetSuite (or Loop ERP) release notes into individually matchable items.

Downstream, each item is matched against individual customer profiles — what modules they own, what hurts, what they still do by hand. So the split matters more than the prose: one item covering three unrelated changes cannot be matched to anyone properly.

- Split aggressively. One change, one item.
- Keep the vendor's specifics. "Cycle counting now supports handheld scanning of serialised items" is matchable; "inventory improvements" is not.
- modules_affected is the primary key. Be precise: "Advanced Inventory", not "Inventory".
- Deprecations and breaking changes are as important as features. They are a reason to contact a customer that has nothing to do with selling, and they build the credibility that makes later commercial conversations land.
- Drop pure marketing. If an item says nothing a customer could act on, leave it out.`;

export function parseMessages(rawNotes: string, product: string, version: string) {
  return {
    system: PARSE_SYSTEM,
    messages: [{
      role: "user" as const,
      content: `PRODUCT: ${product}\nRELEASE: ${version}\n\nRELEASE NOTES:\n\n${rawNotes}`,
    }],
  };
}

// ─── Matching ───────────────────────────────────────────────────────────────

export const MATCH_TOOL: Anthropic.Tool = {
  name: "record_matches",
  description: "Record which release items matter to this specific customer, and why.",
  input_schema: {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            itemIndex: { type: "number", description: "Index of the release item, as given." },
            relevanceScore: {
              type: "number",
              description: "0 to 1. Reserve above 0.8 for items addressing a pain point or manual process this customer actually has. General module relevance alone is below 0.4.",
            },
            reasoning: {
              type: "string",
              description: "TWO OR THREE SENTENCES THAT APPEAR VERBATIM IN THEIR PDF. Written to the customer, about them. Name the specific process, ticket or workaround this touches — 'the month-end reconciliation your team described as taking two days' — not 'this may benefit your organisation'. If you cannot say something specific, score it low and say why here.",
            },
            matchedOn: {
              type: "array", items: { type: "string" },
              description: "Which profile attributes drove this: the module owned, the pain point, the manual process. Must be things you were actually given.",
            },
            actionRequired: { type: "boolean", description: "True if this customer must do something before the release lands." },
          },
          required: ["itemIndex", "relevanceScore", "reasoning", "matchedOn", "actionRequired"],
        },
      },
    },
    required: ["matches"],
  },
};

const MATCH_SYSTEM = `You decide which items in a software release actually matter to one specific customer, and write the reason they will read.

Your reasoning text goes verbatim into a PDF that customer receives. That is the entire product. If it reads like it could have been written about any customer, the document has failed and is no better than the vendor's own release notes, which they already ignore.

Scoring, highest first:
- Deprecation or breaking change affecting something they use — critical, regardless of any commercial angle. Must be told.
- Addresses a pain point they actually have — the strongest positive match.
- Removes a manual process they actually run — equally strong, and the clearest business case.
- Relates to something they asked about before and did not buy — a dormant opportunity worth reopening.
- Affects an existing customisation or integration — risk-flavoured, worth flagging.
- General relevance because they own the module — weak. Include sparingly and score below 0.4.

Rules:
- Only claim a match against something you were given. If the profile does not mention a manual reconciliation, do not say they have one.
- matchedOn must name the actual profile attributes used.
- Be ruthless. A document with thirty items IS a release note, which is the thing they already ignore. Better three items that land than fifteen that do not.
- Never invent a business impact figure. "Removes the export step" is fine; "saves 12 hours a month" is not, unless you were told it.`;

export function matchMessages(
  items: Array<Pick<ReleaseItem, "title" | "description" | "modules_affected" | "category" | "relevance_criteria">>,
  profile: {
    customerName: string;
    modules: string[];
    integrations: string[];
    painPoints: string[];
    manualProcesses: string[];
    customisations: string[];
    enquiredNotPurchased: string[];
    declined: string[];
  },
) {
  const parts: string[] = [];
  parts.push(`CUSTOMER: ${profile.customerName}`);
  parts.push(`MODULES OWNED: ${profile.modules.join(", ") || "(none recorded)"}`);
  parts.push(`INTEGRATIONS: ${profile.integrations.join(", ") || "(none recorded)"}`);

  const block = (label: string, xs: string[]) => {
    if (!xs.length) return;
    parts.push(`\n${label}:`);
    for (const x of xs) parts.push(`- ${x}`);
  };
  block("PAIN POINTS", profile.painPoints);
  block("MANUAL PROCESSES THEY STILL RUN", profile.manualProcesses);
  block("BUILT FOR THEM", profile.customisations);
  block("ASKED ABOUT, DID NOT BUY", profile.enquiredNotPurchased);
  if (profile.declined.length) {
    block("EXPLICITLY DECLINED — do not pitch these again", profile.declined);
  }

  parts.push(`\n─── RELEASE ITEMS ───`);
  items.forEach((it, i) => {
    parts.push(`\n[${i}] ${it.title}  (${it.category ?? "uncategorised"})`);
    parts.push(`modules: ${it.modules_affected.join(", ") || "—"}`);
    parts.push(it.description);
  });

  parts.push(
    `\nReturn matches only for items that genuinely matter to THIS customer. ` +
    `Returning three strong matches is a better outcome than fifteen weak ones.`,
  );

  return { system: MATCH_SYSTEM, messages: [{ role: "user" as const, content: parts.join("\n") }] };
}

/** How different are two customers' matched sets? The spec's validation test, as a number. */
export function overlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = a.filter(x => setB.has(x)).length;
  return shared / Math.min(a.length, b.length);
}
