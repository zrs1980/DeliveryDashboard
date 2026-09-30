// ─── Quarterly health checks — the shared rules ──────────────────────────────
//
// ⚠ `healthchecks` IS NOT `cs_health_*`. This is the quarterly customer call:
// scheduling it, holding it, recording what was discussed. It has nothing to do
// with health SCORING, which is a judgment the CS layer makes and keeps behind
// `cs_layer`. The names are unfortunate and the distinction matters — this is
// ordinary delivery work and is visible to anyone signed in.
//
// ⚠ ONE DEFINITION OF "OVERDUE", AND IT LIVES HERE. It was written inline in
// CustomersView, derived again in buildCustomerIndex, and a per-customer tab
// would have made three copies of a rule that must not drift — the same failure
// the allocation bands had, where a consultant read "Normal" on a card and
// "Med" in the grid directly beneath it.
//
// CLIENT-SAFE: no Supabase, no NetSuite. Imported by browser components.

import { C } from "@/lib/constants";
import { qbrTier, TIER_MONTHS, type QbrTier } from "@/lib/cs-qbr";
import type { Healthcheck } from "@/app/api/healthchecks/route";

export type HCStatus = "completed" | "scheduled" | "overdue" | "unscheduled";

/** e.g. "Q3 2026". */
export function currentQuarter(d = new Date()): string {
  return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
}

/** This quarter and the next seven, for a picker. */
export function quarterList(count = 8): string[] {
  const d = new Date();
  const cur = Math.ceil((d.getMonth() + 1) / 3);
  const yr = d.getFullYear();
  const qs: string[] = [];
  for (let i = 0; i < count; i++) {
    let q = cur + i, y = yr;
    while (q > 4) { q -= 4; y += 1; }
    qs.push(`Q${q} ${y}`);
  }
  return qs;
}

/** Quarters already gone, newest first — for looking back at what was held. */
export function pastQuarters(count = 4): string[] {
  const d = new Date();
  let q = Math.ceil((d.getMonth() + 1) / 3), y = d.getFullYear();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    q -= 1;
    if (q < 1) { q = 4; y -= 1; }
    out.push(`Q${q} ${y}`);
  }
  return out;
}

/**
 * Where one customer stands in one quarter.
 *
 * ⚠ `overdue` is DERIVED, never stored — a stored "overdue" is wrong the
 * morning after the date passes and nobody re-saves the row. A check is overdue
 * when it was scheduled, the date has gone, and it was never completed.
 *
 * A completed check wins over everything else in the same quarter: a call that
 * happened is not made un-held by a second row someone left scheduled.
 */
export function hcStatus(
  customerNsId: string,
  quarter: string,
  all: Healthcheck[],
): HCStatus {
  const mine = all.filter(h => h.customer_ns_id === String(customerNsId) && h.quarter === quarter);
  if (mine.some(h => h.status === "completed")) return "completed";
  const sched = mine.find(h => h.status === "scheduled");
  if (sched) {
    if (sched.scheduled_date && new Date(sched.scheduled_date) < new Date()) return "overdue";
    return "scheduled";
  }
  return "unscheduled";
}

/** The most recent completed check, or null. */
export function lastCompleted(
  customerNsId: string,
  all: Healthcheck[],
): Healthcheck | null {
  return all
    .filter(h => h.customer_ns_id === String(customerNsId) && h.status === "completed")
    .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at))[0]
    ?? null;
}

/**
 * RAG is licensed here, and only here, because every band is a fact about a
 * DATE — held, booked, or booked and missed. None of it is an inference about
 * how the account is doing.
 */
export const HC_STATUS_STYLE: Record<HCStatus, { label: string; bg: string; color: string; bd: string }> = {
  completed:   { label: "✅ Completed",     bg: C.greenBg,  color: C.green,  bd: C.greenBd },
  scheduled:   { label: "📅 Scheduled",     bg: C.blueBg,   color: C.blue,   bd: C.blueBd  },
  overdue:     { label: "⚠ Overdue",        bg: C.redBg,    color: C.red,    bd: C.redBd   },
  unscheduled: { label: "❌ Not Scheduled", bg: C.yellowBg, color: C.yellow, bd: C.yellowBd },
};

export function fmtHcDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

/** Days since a completed check, or null if there has never been one. */
export function daysSinceLastCheck(customerNsId: string, all: Healthcheck[]): number | null {
  const last = lastCompleted(customerNsId, all);
  const when = last?.completed_at ?? last?.updated_at;
  if (!when) return null;
  const t = new Date(when).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000);
}

// ─── When is the next one due? ───────────────────────────────────────────────
//
// ⚠ THE TAB COULD SAY WHAT HAPPENED BUT NEVER WHAT TO BOOK. A status is not a
// deadline: Focus could report "0 of 87 customers have ever had a check" and
// still not answer the only question that follows — which five do I book this
// week?
//
// ⚠ THE CADENCE RULE IS THE QBR'S, NOT A SECOND ONE. `qbrTier()` in
// lib/cs-qbr.ts already decides how often an account deserves a formal
// conversation, from contract value, with a renewal in sight overriding size.
// A health check is the lighter-weight version of the same conversation and
// must not disagree about how often it is owed — two cadence rules is how you
// get a quarterly QBR on an account whose health check says annual.
//
// ⚠ It IMPORTS qbrTier rather than restating it. The first draft of this file
// copied the thresholds, which would have been a second rule three lines after
// a comment saying not to have one. lib/cs-qbr.ts has no imports at all, so it
// is client-safe and there is no excuse for a copy.

export type HcCadence = QbrTier;

export const CADENCE_MONTHS = TIER_MONTHS;

export const CADENCE_LABEL: Record<HcCadence, string> = {
  quarterly: "Quarterly", twice_yearly: "Twice a year", annual: "Annual",
};

export interface HcDue {
  cadence:   HcCadence;
  /** ISO date the next check is due. Null when no check has ever been held. */
  dueDate:   string | null;
  /** Negative = overdue by that many days. Null when never held. */
  daysUntil: number | null;
  /** Never held, so it is owed now regardless of cadence. */
  neverHeld: boolean;
  /** Why this cadence — shown to the reader, because a deadline needs a reason. */
  reason:    string;
}

/**
 * How often this account is owed a check, and when the next one falls.
 *
 * ⚠ AN ACCOUNT THAT HAS NEVER HAD ONE IS OWED ONE NOW. It does not get a
 * comfortable due date twelve months out because nobody ever started the
 * clock — that would let the least-attended accounts look the least urgent,
 * which is exactly backwards.
 */
export function healthCheckDue(
  customerNsId: string,
  all: Healthcheck[],
  opts: { annualValue?: number | null; daysToNotice?: number | null } = {},
): HcDue {
  const { annualValue = null, daysToNotice = null } = opts;

  // A renewal in sight outranks contract size — the check has to land
  // comfortably before the notice date, not after it. qbrTier() owns that rule.
  const renewalSoon = daysToNotice !== null && daysToNotice <= 180;
  const cadence = qbrTier(annualValue, renewalSoon);

  const reason =
    renewalSoon          ? "Renewal decision inside 180 days"
  : annualValue === null ? "No contract value recorded"
  :                        `Contract value $${Math.round(annualValue).toLocaleString()}`;

  const last = lastCompleted(customerNsId, all);
  const when = last?.completed_at ?? last?.scheduled_date ?? null;
  if (!when) {
    return { cadence, dueDate: null, daysUntil: null, neverHeld: true, reason };
  }

  const held = new Date(when);
  if (Number.isNaN(held.getTime())) {
    return { cadence, dueDate: null, daysUntil: null, neverHeld: true, reason };
  }

  const due = new Date(held);
  due.setMonth(due.getMonth() + CADENCE_MONTHS[cadence]);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  return {
    cadence,
    dueDate: due.toISOString().slice(0, 10),
    daysUntil: Math.round((due.getTime() - today.getTime()) / 86_400_000),
    neverHeld: false,
    reason,
  };
}
