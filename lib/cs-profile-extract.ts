import type Anthropic from "@anthropic-ai/sdk";
import type { CustomerCorpus } from "@/lib/cs-profile-corpus";

// ─── Customer profile extraction ─────────────────────────────────────────────
//
// Turns the corpus into the structured profile in docs/02-CUSTOMER-PROFILES.md.
// Prompt, schema and validation live here; the route owns the Anthropic client,
// matching lib/status-report-ai.ts.
//
// Three rules from the spec are enforced in code rather than trusted to the
// model, because each one is the difference between a profile you can quote in a
// customer email and one you cannot:
//
//   1. EVERY CLAIM CARRIES EVIDENCE. A pain point with no case or memo behind it
//      is a hallucination. Items arriving without evidence_refs are dropped, not
//      downgraded — see validateProfile().
//   2. OBSERVED IS NOT INFERRED. "Owns Advanced Inventory" read off a project
//      name is a fact; "struggles with inventory reconciliation" drawn from three
//      tickets is a reading. They are stored separately so outreach can use the
//      first freely and the second only after sign-off.
//   3. CONFIDENCE IS THREE LEVELS, and only high + human-verified medium may
//      reach a customer. That gate belongs to the draft queue in Phase 4; this
//      module's job is to label honestly.

export const PROFILE_MODEL = "claude-sonnet-4-6";

/** Bumped when the prompt or schema changes; stored on the row so a profile can be traced. */
export const EXTRACTION_VERSION = "2026-09-19.1";

export type Confidence = "high" | "medium" | "low";
export type Basis      = "observed" | "inferred";

export interface EvidencedItem {
  description:  string;
  evidence_refs: string[];
  confidence:   Confidence;
  basis:        Basis;
}

export interface ExtractedProfile {
  modules_owned:   string[];
  integrations:    string[];
  netsuite_edition: string | null;
  industry:        string | null;
  company_size:    string | null;
  customisations:  EvidencedItem[];
  pain_points:     EvidencedItem[];
  manual_processes: EvidencedItem[];
  features_enquired_not_purchased: EvidencedItem[];
  declined_items:  EvidencedItem[];
}

const evidencedArray = (what: string, guidance: string) => ({
  type: "array" as const,
  description: `${what}. ${guidance}`,
  items: {
    type: "object" as const,
    properties: {
      description:   { type: "string", description: `The ${what.toLowerCase()}, in one specific sentence. Use the customer's own words where the source uses them.` },
      evidence_refs: {
        type: "array", items: { type: "string" },
        description: "Identifiers from the corpus that support this: case ids as 'case:1234', project numbers as 'project:413', or a short verbatim quote from a memo. Never empty — an item you cannot evidence must be omitted entirely.",
      },
      confidence: {
        type: "string", enum: ["high", "medium", "low"],
        description: "high = from a structured source such as a project name or licence record. medium = consistently stated across several unstructured sources. low = a single ambiguous mention.",
      },
      basis: {
        type: "string", enum: ["observed", "inferred"],
        description: "observed = stated outright in a source. inferred = your reading across several sources.",
      },
    },
    required: ["description", "evidence_refs", "confidence", "basis"],
  },
});

export const PROFILE_TOOL: Anthropic.Tool = {
  name: "record_customer_profile",
  description: "Record the structured profile extracted from this customer's delivery history.",
  input_schema: {
    type: "object",
    properties: {
      modules_owned: {
        type: "array", items: { type: "string" },
        description: "NetSuite modules, SuiteApps and Loop ERP modules this customer demonstrably uses. Project names are the strongest evidence — 'Advanced Procurement Implementation' means they have Advanced Procurement. Do not list a module you cannot point at.",
      },
      integrations: {
        type: "array", items: { type: "string" },
        description: "Systems integrated with NetSuite (e.g. Shopify, Celigo, Salesforce). Again, usually named outright in a project title.",
      },
      netsuite_edition: { type: ["string", "null"], description: "OneWorld, Standard, etc. Null unless actually stated." },
      industry:         { type: ["string", "null"], description: "Null unless the sources make it clear." },
      company_size:     { type: ["string", "null"], description: "Null unless the sources make it clear." },
      customisations:   evidencedArray("Customisation or script built for this customer", "Bundles, SuiteScripts, custom records, workflows."),
      pain_points:      evidencedArray("Recurring friction or problem", "Look for repetition. One ticket is an incident; the same theme five times is a pain point."),
      manual_processes: evidencedArray(
        "Manual process or workaround",
        "THE HIGHEST-VALUE FIELD. Spreadsheet workarounds, double entry, manual reconciliation, exports to Excel, offline approvals. Each is a concrete cross-sell case with its business case already written in the customer's own words. A memo repeated many times often describes one of these.",
      ),
      features_enquired_not_purchased: evidencedArray("Capability they asked about but did not buy", "Include the outcome if visible."),
      declined_items:   evidencedArray("Something explicitly declined or deferred", "Drives suppression — we must not pitch these again."),
    },
    required: [
      "modules_owned", "integrations", "netsuite_edition", "industry", "company_size",
      "customisations", "pain_points", "manual_processes",
      "features_enquired_not_purchased", "declined_items",
    ],
  },
};

const SYSTEM = `You build customer profiles for a NetSuite implementation partner, from the delivery record of work already done for that customer.

These profiles are read by people who will speak to the customer directly, so a confident guess is worse than an admission of ignorance. An empty array is a perfectly good answer.

Rules, in order of importance:

1. Every item carries evidence_refs pointing at what you read. If you cannot evidence it, omit it. Do not pad a thin profile.
2. Mark observed facts and your own inferences differently. A project named "Advanced Procurement Implementation" is observed evidence of that module. "They struggle with procurement" is inferred.
3. Prefer the customer's own phrasing. A pain point in their words is usable in an email; a paraphrase into vendor language is not.
4. Repetition is signal. A memo written thirty times describes a routine activity. A ticket theme recurring across months is a real problem, not an incident.
5. Be specific. "Inventory issues" is useless. "Transfer price shows as 0 on transfer orders between subsidiaries" is actionable.
6. Do not list the same capability as both owned and not-bought. If something belongs in features_enquired_not_purchased or declined_items, it must not also appear in modules_owned or integrations. Discussing a tool is not owning it — look for a project or configuration work before calling it owned.`;

/** Assemble the corpus into prompt text, newest and densest first, within budget. */
export function buildProfilePrompt(corpus: CustomerCorpus, customerName: string, budgetChars = 380_000): string {
  const parts: string[] = [];

  parts.push(`CUSTOMER: ${customerName}`);
  parts.push(`Delivery history covering the last ${corpus.windowMonths} months.\n`);

  parts.push(`## Projects (${corpus.projects.length})`);
  parts.push(`Project names are the most reliable evidence of modules and integrations.`);
  for (const p of corpus.projects) {
    parts.push(`- project:${p.entityid} — ${p.name}${p.userNotes ? `\n    notes: ${p.userNotes}` : ""}`);
  }

  if (corpus.taskTitles.length) {
    parts.push(`\n## Project task names\n${corpus.taskTitles.join(" · ")}`);
  }

  if (corpus.timeMemos.length) {
    parts.push(`\n## Consultant time-entry memos (${corpus.timeMemos.length} unique; "N×" is how often written)`);
    parts.push(`Written at the point of work. The richest source of manual processes.`);
    for (const m of corpus.timeMemos) parts.push(`- ${m.count}× ${m.text}`);
  }

  if (corpus.cases.length) {
    parts.push(`\n## Support cases (${corpus.cases.length}, newest first)`);
    for (const c of corpus.cases) {
      parts.push(`\n### case:${c.id} [${c.date}] ${c.title}`);
      if (c.text) parts.push(c.text);
    }
  }

  let text = parts.join("\n");
  if (text.length > budgetChars) {
    // Cases are last and newest-first, so truncation drops the oldest ticket
    // detail rather than the project list or the memos.
    text = text.slice(0, budgetChars) + "\n\n[older case detail omitted for length]";
  }
  return text;
}

export function profileMessages(corpus: CustomerCorpus, customerName: string) {
  return {
    system: SYSTEM,
    messages: [{ role: "user" as const, content: buildProfilePrompt(corpus, customerName) }],
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const BASES:       Basis[]      = ["observed", "inferred"];

const str = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map(str).filter(Boolean))] : [];

function validateItems(v: unknown): EvidencedItem[] {
  if (!Array.isArray(v)) return [];
  const out: EvidencedItem[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const description   = str(r.description);
    const evidence_refs = strArray(r.evidence_refs);

    // The spec's hard rule: no evidence, no claim. Dropped rather than kept at
    // low confidence — an unevidenced item cannot be drilled into, and a profile
    // whose claims cannot be checked is worse than a shorter one.
    if (!description || evidence_refs.length === 0) continue;

    const confidence = CONFIDENCES.includes(r.confidence as Confidence) ? r.confidence as Confidence : "low";
    const basis      = BASES.includes(r.basis as Basis) ? r.basis as Basis : "inferred";
    out.push({ description, evidence_refs, confidence, basis });
  }
  return out;
}

/** Coerce the model's output into the stored shape. A malformed field degrades to empty. */
export function validateProfile(input: unknown): ExtractedProfile {
  const r = (input ?? {}) as Record<string, unknown>;
  const nullable = (v: unknown) => { const s = str(v); return s && s.toLowerCase() !== "null" ? s : null; };

  return {
    modules_owned:    strArray(r.modules_owned),
    integrations:     strArray(r.integrations),
    netsuite_edition: nullable(r.netsuite_edition),
    industry:         nullable(r.industry),
    company_size:     nullable(r.company_size),
    customisations:   validateItems(r.customisations),
    pain_points:      validateItems(r.pain_points),
    manual_processes: validateItems(r.manual_processes),
    features_enquired_not_purchased: validateItems(r.features_enquired_not_purchased),
    declined_items:   validateItems(r.declined_items),
  };
}

/**
 * Capabilities listed as owned AND as not-bought.
 *
 * Seen on the first real run: Salt and Stone came back with Bill.com and Ramp in
 * `integrations` while `features_enquired_not_purchased` said neither was ever
 * implemented. Both readings were defensible from the sources — the tools are
 * discussed — but an email built on the owned list would have thanked them for
 * using software they never bought.
 *
 * Reported rather than auto-corrected: which side is wrong depends on the
 * evidence, and quietly deleting from one list would hide the disagreement
 * instead of getting it resolved.
 */
export function findContradictions(p: ExtractedProfile): string[] {
  const owned = [...p.modules_owned, ...p.integrations];
  const notOwned = [...p.features_enquired_not_purchased, ...p.declined_items];
  const out: string[] = [];

  for (const o of owned) {
    const token = o.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim();
    if (token.length < 4 || GENERIC_TOKENS.has(token)) continue;
    if (notOwned.some(n => n.description.toLowerCase().includes(token))) {
      out.push(o);
    }
  }
  return [...new Set(out)];
}

/**
 * Words too common to mean anything as a contradiction.
 *
 * "NetSuite" appears in almost every not-purchased description — "Salesforce–
 * NetSuite integration was scoped but not signed off" — so matching on it fires
 * on essentially every customer. A warning that always fires is one nobody
 * reads, which is the same reason the Customer Success tab is not RAG-coloured.
 */
const GENERIC_TOKENS = new Set([
  "netsuite", "erp", "netsuite core erp", "integration", "module", "modules",
  "inventory management", "reporting", "suitescript", "oracle",
]);

/** How much of the model's output survived validation — surfaced so silent drops are visible. */
export function extractionDrops(raw: unknown, clean: ExtractedProfile): Record<string, number> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const drops: Record<string, number> = {};
  for (const key of ["customisations", "pain_points", "manual_processes", "features_enquired_not_purchased", "declined_items"] as const) {
    const before = Array.isArray(r[key]) ? (r[key] as unknown[]).length : 0;
    const after  = clean[key].length;
    if (before > after) drops[key] = before - after;
  }
  return drops;
}
