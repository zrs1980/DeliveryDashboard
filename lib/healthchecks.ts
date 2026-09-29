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
