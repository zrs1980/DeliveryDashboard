import type { CustomerSignals } from "@/lib/cs-signals";

// ─── Rules engine ───────────────────────────────────────────────────────────
//
// docs/03-HEALTH-SCORING.md: "Rules should be data, not code — stored,
// versioned, editable in the UI without deploy." So a rule is a plain object
// with declarative conditions, serialisable as-is into a table when one exists.
// Nothing here closes over a function, which is what would make that move a
// rewrite.
//
// Two properties the whole thing rests on:
//
// 1. A NULL SIGNAL NEVER SATISFIES A COMPARISON. Absent data must not fire a
//    rule. cs_contacts, cs_commitments and cs_consultant_sentiment are all empty
//    today, and treating "no contacts recorded" as "all contacts gone" would
//    flag the entire book on the first run. Only `isNull` matches a null,
//    deliberately and explicitly.
//
// 2. COMPOUND RULES, NOT SINGLE SIGNALS. The spec is blunt: "Any one signal
//    alone is noise." Quiet is normal here — 40 of 55 accounts have no hours in
//    90 days because their implementation finished. Quiet AND nothing booked AND
//    an active contract is a different statement.

export const RULES_VERSION = "2026-09-21.1";

export type Severity = "low" | "medium" | "high" | "critical";
export type Band     = "healthy" | "watch" | "at_risk" | "critical";

export type Op = "lt" | "lte" | "gt" | "gte" | "eq" | "ne" | "isNull" | "notNull";

export interface RuleCondition {
  signal: keyof CustomerSignals;
  op:     Op;
  value?: number | string | boolean;
}

export interface CsRule {
  id:       string;
  severity: Severity;
  title:    string;
  /** Template; {signalName} is substituted with the live value. */
  reason:   string;
  /** ANDed together. */
  all:      RuleCondition[];
  /** Signals to carry as evidence so the flag can be drilled into. */
  evidence: Array<keyof CustomerSignals>;
  enabled:  boolean;
  /** Set when a rule cannot run yet; explains what it is waiting for. */
  requires?: string;
}

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 5, medium: 12, high: 22, critical: 35,
};

// ─── The starter set ────────────────────────────────────────────────────────
// Rules the spec lists but which no data supports yet are present and DISABLED,
// with `requires` naming the gap. Better visible and dormant than forgotten.

export const STARTER_RULES: CsRule[] = [
  {
    id: "silent_account",
    severity: "high",
    title: "Gone quiet with nothing booked",
    reason: "No consultant hours in {daysSinceLastHour} days and no forward-booked work, on an active contract.",
    all: [
      { signal: "daysSinceLastHour",  op: "gt",  value: 45 },
      { signal: "forwardBookedHours", op: "lte", value: 0 },
      // The spec's own example carries this clause and it is load-bearing.
      // Without it the rule fired on 38 of 55 accounts on the first real run,
      // because most of them are finished implementations, not live
      // relationships going quiet. An account with no contract on file is not
      // known to be a live relationship at all, so its silence says nothing.
      // With contracts recorded, this fires on exactly the accounts where
      // silence is worth something.
      { signal: "contractStatus",     op: "eq",  value: "active" },
    ],
    evidence: ["daysSinceLastHour", "forwardBookedHours", "hoursLast90", "activeProjects"],
    enabled: true,
  },
  {
    id: "deep_silence",
    severity: "critical",
    title: "No activity of any kind",
    reason: "No hours in {daysSinceLastHour} days, no support cases in 90 days, nothing booked — on an active contract.",
    all: [
      { signal: "daysSinceLastHour",  op: "gt",  value: 90 },
      { signal: "casesLast90",        op: "lte", value: 0 },
      { signal: "forwardBookedHours", op: "lte", value: 0 },
      { signal: "contractStatus",     op: "eq",  value: "active" },
    ],
    evidence: ["daysSinceLastHour", "casesLast90", "forwardBookedHours", "contractStatus"],
    enabled: true,
  },
  {
    id: "engagement_decline",
    severity: "medium",
    title: "Engagement halved",
    reason: "Hours over the last 90 days are {hoursLast90}h against {hoursPrior90}h in the 90 before — less than half.",
    all: [
      { signal: "hoursTrendRatio", op: "lt",  value: 0.5 },
      { signal: "hoursLast90",     op: "gt",  value: 0 },
    ],
    evidence: ["hoursLast90", "hoursPrior90", "hoursTrendRatio"],
    enabled: true,
  },
  {
    id: "never_engaged",
    severity: "low",
    title: "No recorded delivery history",
    reason: "No actual time has ever been logged against this customer.",
    all: [{ signal: "daysSinceLastHour", op: "isNull" }],
    evidence: ["activeProjects", "casesLast90"],
    enabled: true,
  },
  {
    id: "renewal_notice_near",
    severity: "critical",
    title: "Notice deadline approaching",
    reason: "Notice is due in {daysToNotice} days. Past that the contract commits for another term.",
    all: [
      { signal: "daysToNotice", op: "lte", value: 90 },
      { signal: "daysToNotice", op: "gte", value: 0 },
    ],
    evidence: ["daysToNotice", "contractStatus", "autoRenew"],
    enabled: true,
  },
  {
    id: "renewal_notice_passed",
    severity: "high",
    title: "Notice window closed",
    reason: "The notice date has passed. On auto-renew this is already committed.",
    all: [
      { signal: "daysToNotice", op: "lt",  value: 0 },
      { signal: "autoRenew",    op: "eq",  value: true },
    ],
    evidence: ["daysToNotice", "autoRenew", "contractStatus"],
    enabled: true,
  },
  {
    id: "delivery_over_budget",
    severity: "medium",
    title: "Project over budget",
    reason: "{projectsOverBudget} active project(s) have run past their budgeted hours.",
    all: [{ signal: "projectsOverBudget", op: "gte", value: 1 }],
    evidence: ["projectsOverBudget", "activeProjects"],
    enabled: true,
  },
  {
    id: "support_escalation",
    severity: "medium",
    title: "Support volume doubled",
    reason: "{casesLast90} cases in 90 days against {casesPrior90} in the 90 before.",
    all: [
      { signal: "caseTrendRatio", op: "gte", value: 2 },
      { signal: "casesLast90",    op: "gte", value: 3 },
    ],
    evidence: ["casesLast90", "casesPrior90", "caseTrendRatio"],
    enabled: true,
  },
  {
    id: "ageing_cases",
    severity: "medium",
    title: "Cases going stale",
    reason: "{openCasesAgeing} open case(s) untouched for more than a week.",
    all: [{ signal: "openCasesAgeing", op: "gte", value: 3 }],
    evidence: ["openCasesAgeing", "casesLast90"],
    enabled: true,
  },
  {
    id: "stalled_work",
    severity: "low",
    title: "Project stalled",
    reason: "{stalledProjects} open project(s) with nothing logged in 30 days, while other work continues.",
    all: [
      { signal: "stalledProjects", op: "gte", value: 1 },
      // Without this the rule fired on 38 of 55 accounts, because a NetSuite
      // project left at entitystatus=2 after the work finished looks identical
      // to one that has stalled. Requiring recent hours elsewhere on the account
      // makes it the real signal — work IS happening here, but this project is
      // stuck — rather than a report of stale project records.
      { signal: "hoursLast90",     op: "gt",  value: 0 },
    ],
    evidence: ["stalledProjects", "activeProjects", "hoursLast90"],
    enabled: true,
  },
  {
    id: "consultant_red",
    severity: "high",
    title: "Consultant flagged red",
    reason: "A consultant on site rated this account red. That outranks any derived metric here.",
    all: [{ signal: "latestSentiment", op: "eq", value: "red" }],
    evidence: ["latestSentiment"],
    enabled: true,
  },

  // ── Specced, not yet computable ──────────────────────────────────────────
  {
    id: "champion_lost", severity: "high", title: "Champion has gone silent",
    reason: "The champion contact has not appeared anywhere in 60 days.",
    all: [], evidence: ["activeContacts"], enabled: false,
    requires: "cs_contacts, with roles assigned and last_seen_at maintained",
  },
  {
    id: "contact_contraction", severity: "medium", title: "Contacts halved",
    reason: "Active contacts are down more than half against the prior period.",
    all: [], evidence: ["activeContacts"], enabled: false,
    requires: "cs_contacts, with last_seen_at maintained",
  },
  {
    id: "broken_promise", severity: "high", title: "We owe them something overdue",
    reason: "An open commitment we owe is past its due date.",
    all: [], evidence: [], enabled: false,
    requires: "cs_commitments",
  },
  {
    id: "resolution_degrading", severity: "medium", title: "Resolution time worsening",
    reason: "Average time to resolution is up more than half over two months.",
    all: [], evidence: [], enabled: false,
    requires: "case resolution timestamps — supportcase exposes status but no resolved-at",
  },
];

// ─── Evaluation ─────────────────────────────────────────────────────────────

function satisfies(signals: CustomerSignals, c: RuleCondition): boolean {
  const v = signals[c.signal] as unknown;

  if (c.op === "isNull")  return v === null || v === undefined;
  if (c.op === "notNull") return v !== null && v !== undefined;

  // The safety property: absent data satisfies nothing.
  if (v === null || v === undefined) return false;

  if (c.op === "eq") return v === c.value;
  if (c.op === "ne") return v !== c.value;

  const a = Number(v), b = Number(c.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;

  switch (c.op) {
    case "lt":  return a <  b;
    case "lte": return a <= b;
    case "gt":  return a >  b;
    case "gte": return a >= b;
    default:    return false;
  }
}

function renderReason(template: string, signals: CustomerSignals): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = signals[key as keyof CustomerSignals];
    if (v === null || v === undefined) return "—";
    return typeof v === "number" ? String(Math.round(v * 10) / 10) : String(v);
  });
}

export interface FiredFlag {
  ruleId:   string;
  severity: Severity;
  title:    string;
  reason:   string;
  evidence: Record<string, unknown>;
}

export function evaluateRules(signals: CustomerSignals, rules: CsRule[] = STARTER_RULES): FiredFlag[] {
  const fired: FiredFlag[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.all.length === 0) continue;
    if (!rule.all.every(c => satisfies(signals, c))) continue;

    const evidence: Record<string, unknown> = {};
    for (const key of rule.evidence) evidence[key] = signals[key];

    fired.push({
      ruleId:   rule.id,
      severity: rule.severity,
      title:    rule.title,
      reason:   renderReason(rule.reason, signals),
      evidence,
    });
  }
  return fired;
}

/**
 * Composite score and band.
 *
 * Starts at 100 and deducts by severity. A critical flag forces the critical
 * band regardless of arithmetic — the spec asks for that, and it stops a single
 * catastrophic issue being averaged away by an otherwise healthy account.
 */
export function scoreFrom(flags: FiredFlag[]): { score: number; band: Band } {
  let score = 100;
  for (const f of flags) score -= SEVERITY_WEIGHT[f.severity];
  score = Math.max(0, Math.min(100, score));

  if (flags.some(f => f.severity === "critical")) return { score, band: "critical" };

  const band: Band =
    score >= 80 ? "healthy" :
    score >= 60 ? "watch"   :
    score >= 40 ? "at_risk" : "critical";

  return { score, band };
}

export const BAND_LABEL: Record<Band, string> = {
  healthy: "Healthy", watch: "Watch", at_risk: "At risk", critical: "Critical",
};
