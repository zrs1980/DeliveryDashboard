// ─── QBR packs ──────────────────────────────────────────────────────────────
//
// docs/06-QBR-PACK.md: a QBR is the vehicle that lets a commercial conversation
// happen without being a sales call. The structure does the work — value
// delivered first, forward-looking opportunity second — so the upsell sits
// inside a value review rather than standing alone as an ask.
//
// The agent assembles the pack. The human presents it.
//
// ⚠ TWO ARTEFACTS, AND THEY MUST NOT MIX.
//
// The spec is unambiguous: "Consultant sentiment never appears in the
// customer-facing pack. It is internal signal." So the types below separate
// them at the type level rather than relying on whoever writes the PDF to
// remember. `CustomerFacingPack` has no field sentiment could occupy, and
// `buildPack` returns the two as distinct objects. A renderer given the
// customer pack cannot leak the briefing because it was never handed it.
//
// The spec also observes that the internal briefing is "arguably more valuable
// than the pack. It is what a good CSM would have in their head walking into the
// room." It is built with the same care, not as an afterthought.

export type QbrTier = "quarterly" | "twice_yearly" | "annual";

/** Cadence by contract value. Top accounts quarterly, the long tail annually. */
export function qbrTier(annualValue: number | null, hasRenewalSoon: boolean): QbrTier {
  if (hasRenewalSoon) return "quarterly";           // a renewal in sight outranks size
  if (annualValue === null) return "annual";
  if (annualValue >= 100_000) return "quarterly";
  if (annualValue >= 25_000)  return "twice_yearly";
  return "annual";
}

export const TIER_MONTHS: Record<QbrTier, number> = {
  quarterly: 3, twice_yearly: 6, annual: 12,
};

export interface PeriodSummary {
  projectsDelivered: Array<{ name: string; entityid: string }>;
  hoursConsumed:     number;
  casesRaised:       number;
  casesResolved:     number;
  goLives:           string[];
}

export interface ForwardItem {
  title:      string;
  reasoning:  string;
  /** Where it came from, so the presenter can answer "why are you telling me this?" */
  source:     "release_match" | "manual_process" | "prior_enquiry";
}

/**
 * What the customer sees. There is deliberately nowhere in this shape to put
 * consultant sentiment, a health score, or a flag.
 */
export interface CustomerFacingPack {
  customerName:  string;
  periodLabel:   string;
  summary:       PeriodSummary;
  outcomes:      Array<{ goal: string; status: string; note: string }>;
  supportNarrative: string;
  forwardLook:   ForwardItem[];
  nextSteps:     string[];
  /** True when original engagement goals were never captured — a finding, not filler. */
  goalsUnavailable: boolean;
}

/** What the presenter reads beforehand. Never rendered into the pack. */
export interface InternalBriefing {
  healthScore:    number | null;
  healthBand:     string | null;
  scoreDelta:     number | null;
  openFlags:      Array<{ title: string; reason: string; severity: string }>;
  sentiment:      Array<{ rating: string; note: string | null; consultant: string; capturedAt: string }>;
  contractPosition: {
    product: string; endDate: string | null;
    daysToRenewal: number | null; daysToNotice: number | null;
    annualValue: number | null; autoRenew: boolean;
  } | null;
  openCommitments: Array<{ direction: string; description: string; dueDate: string | null; overdue: boolean }>;
  declinedItems:   string[];
  talkingPoints:   string[];
  avoid:           string[];
}

export interface QbrPack {
  customerFacing: CustomerFacingPack;
  internal:       InternalBriefing;
  tier:           QbrTier;
}

/**
 * Nothing generated becomes a finding.
 *
 * Section 2 of the pack reports outcomes against the goals originally agreed.
 * If those were never captured in a structured way, the spec is explicit that
 * the section should say so rather than generate filler — because the gap is
 * itself worth knowing, and fixing it means capturing success criteria at
 * kickoff, which no amount of writing here achieves.
 */
export const GOALS_UNAVAILABLE_NOTE =
  "Success criteria were not captured in a structured way at kickoff for this engagement, " +
  "so this section reports delivery rather than outcomes against agreed goals. Worth fixing " +
  "for the next phase — it is the section customers find most useful.";

/** Suggested next steps must not all carry a price tag. */
export function validateNextSteps(steps: string[]): { ok: boolean; warning?: string } {
  if (steps.length === 0) return { ok: false, warning: "No next steps proposed." };
  // The spec: "Some should cost nothing — a training session, a config review. A
  // pack where every recommendation has a price tag reads as a sales document
  // and the whole framing collapses."
  const chargeable = /\b(implement|build|licen[cs]e|purchase|upgrade|module|engagement|scope|sow|project)\b/i;
  const free = steps.filter(s => !chargeable.test(s));
  if (free.length === 0) {
    return {
      ok: false,
      warning: "Every proposed next step looks chargeable. A pack where every recommendation " +
               "has a price tag reads as a sales document and the value-review framing collapses. " +
               "Add something that costs them nothing.",
    };
  }
  return { ok: true };
}
