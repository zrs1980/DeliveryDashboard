// ─── Weekly Status Report — server-side assembly ──────────────────────────────
//
// Turns live NetSuite (project + phase budgets) and ClickUp (task detail) data
// into a fully pre-populated StatusReport draft. Everything here is derived and
// overridable — the PM edits in the wizard and Claude can rewrite the prose.

import { EMPLOYEES, PMS } from "./constants";
import { isBlocked, isClientPending, isDone } from "./clickup";
import { canonicalPhase, isPhaseRow } from "./health";
import type { CUTask, Project } from "./types";
import {
  type ActionItem, type Bullet, type BudgetPhaseRow, type Deliverable,
  type DeliverableState, type MilestoneRow, type MilestoneState, type OverallStatus,
  type PhaseTrackerEntry, type Risk, type StatusReport,
  fmtHrs, fmtShort, mondayOf, newId, toISODate,
} from "./status-report";

// ─── Baselines ────────────────────────────────────────────────────────────────

export interface Baselines {
  milestones: Record<string, { date: string | null; label: string | null }>;
  phases:     Record<string, { hours: number | null; label: string | null }>;
}

export const EMPTY_BASELINES: Baselines = { milestones: {}, phases: {} };

// ─── Loop Services roster matching ────────────────────────────────────────────

const ROSTER = [...new Set([...Object.values(EMPLOYEES), ...Object.values(PMS)])];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Is this ClickUp assignee a Loop Services person?
 * ClickUp usernames are inconsistent (full name, first name, or email local-part),
 * so match on normalised full name, then on a first+last-initial pattern.
 */
function isLoopPerson(username: string): boolean {
  const u = norm(username);
  if (!u) return false;
  return ROSTER.some(name => {
    const n = norm(name);
    if (n === u || n.includes(u) || u.includes(n)) return true;
    const [first, last] = name.toLowerCase().split(/\s+/);
    if (!last) return false;
    return u === norm(first) || u === norm(first + last[0]) || u === norm(first[0] + last);
  });
}

const ownerOf = (t: CUTask): string =>
  t.assignees.length > 0 ? t.assignees.map(a => a.username).join(", ") : "Unassigned";

// ─── Date helpers ─────────────────────────────────────────────────────────────

const dayMs = 86_400_000;

function parseDue(t: CUTask): number | null {
  if (!t.due_date) return null;
  const n = parseInt(t.due_date);
  return isNaN(n) ? null : n;
}

function closedAt(t: CUTask): number | null {
  for (const raw of [t.date_done, t.date_closed, t.date_updated]) {
    if (!raw) continue;
    const n = parseInt(raw);
    if (!isNaN(n)) return n;
  }
  return null;
}

const isoFromMs = (ms: number | null): string | null =>
  ms == null ? null : toISODate(new Date(ms));

/** Next occurrence of a given weekday (0=Sun) on or after `from`. */
function nextWeekday(from: Date, weekday: number): string {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7 || 7));
  return toISODate(d);
}

// ─── Task classification ──────────────────────────────────────────────────────

function deliverableState(t: CUTask): DeliverableState {
  if (isDone(t))    return "done";
  if (isBlocked(t)) return "blocked";
  const st = t.status.status.toLowerCase();
  if (st.includes("progress") || st.includes("review") || st.includes("uat")) return "in_progress";
  return "pending";
}

const MEETING_RE = /\b(meeting|session|call|kick.?off|walkthrough|workshop|demo|training|show and tell|cadence|review)\b/i;

function isMeetingTask(t: CUTask): boolean {
  return t.tags.some(g => /meeting|session|call/i.test(g.name)) || MEETING_RE.test(t.name);
}

// ─── Phase tracker ────────────────────────────────────────────────────────────

const PHASE_NAMES: Record<number, string> = {
  1: "Planning & Design",
  2: "Configuration",
  3: "Training & UAT",
  4: "Readiness",
  5: "Go Live",
};

interface NSPhaseRow {
  phase_id:       string;
  phase_name:     string;
  budgeted_hours: string;
  actual_hours:   string;
  phase_status:   string;
  parent_id?:     string | null;
}

const num = (v: string | null | undefined) => parseFloat(v ?? "") || 0;

/**
 * Reduce a project's projecttask rows to the handful that are actually phases.
 *
 * SuiteQL can't filter on tasktype, and isPhaseRow() matches loosely (any title
 * containing "planning", "design", "pm"…), so filtering on title alone returns
 * task rows too — one real project came back with 20 "phases". Two discriminators,
 * in order of reliability:
 *
 *  1. parent IS NULL — phases sit at the top of the project task tree, tasks hang
 *     off them. Also avoids double-counting, since a phase's actualwork rolls up
 *     its children.
 *  2. one row per canonical phase number, largest budget wins, so a stray
 *     top-level task that happens to match a phase pattern can't displace the
 *     real phase.
 *
 * Falls back progressively: canonical phases → any top-level row carrying hours →
 * nothing (caller then uses project-level totals).
 */
function selectPhaseRows(rows: NSPhaseRow[]): NSPhaseRow[] {
  const hasParentInfo = rows.some(r => r.parent_id !== undefined);
  const topLevel = hasParentInfo
    ? rows.filter(r => r.parent_id == null || String(r.parent_id).trim() === "")
    : rows;
  const base = topLevel.length > 0 ? topLevel : rows;

  // One row per canonical phase number.
  const best = new Map<number, NSPhaseRow>();
  for (const r of base) {
    if (!isPhaseRow(r.phase_name)) continue;
    const n = phaseNumOf(r.phase_name);
    if (n === null) continue;
    const cur = best.get(n);
    if (!cur || num(r.budgeted_hours) > num(cur.budgeted_hours)) best.set(n, r);
  }
  if (best.size >= 2) {
    return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  }

  // No recognisable phase structure — fall back to top-level rows that carry hours,
  // keeping whatever the PM actually named them.
  const withHours = base.filter(r => num(r.budgeted_hours) > 0 || num(r.actual_hours) > 0);
  if (withHours.length > 0) return withHours.slice(0, 8);

  return [];
}

const phaseNumOf = (name: string): number | null => {
  const c = canonicalPhase(name);
  if (!c) return null;
  const m = c.match(/Phase (\d)/);
  return m ? parseInt(m[1]) : 0;  // "PM" → 0
};

function nsPhaseIsComplete(row: NSPhaseRow): boolean {
  const s = (row.phase_status ?? "").toUpperCase();
  if (s.includes("COMPLETE") || s === "FINISHED") return true;
  const budget = num(row.budgeted_hours);
  const actual = num(row.actual_hours);
  return budget > 0 && actual >= budget;
}

/** Expects rows already narrowed by selectPhaseRows(). */
function buildPhaseTracker(rows: NSPhaseRow[]): PhaseTrackerEntry[] {
  const byNum = new Map<number, NSPhaseRow>();
  for (const r of rows) {
    const n = phaseNumOf(r.phase_name);
    if (n !== null && n >= 1 && n <= 5 && !byNum.has(n)) byNum.set(n, r);
  }

  const complete = new Set<number>();
  const started  = new Set<number>();
  for (const [n, r] of byNum) {
    if (nsPhaseIsComplete(r)) complete.add(n);
    if (num(r.actual_hours) > 0) started.add(n);
  }

  // Current = furthest-along started-but-incomplete phase, else the first incomplete one.
  const inFlight = [...started].filter(n => !complete.has(n)).sort((a, b) => b - a);
  const current  = inFlight[0] ?? [1, 2, 3, 4, 5].find(n => !complete.has(n)) ?? 5;

  return [1, 2, 3, 4, 5].map(n => ({
    number: n,
    name:   PHASE_NAMES[n],
    state:  complete.has(n) ? "complete" as const : n === current ? "current" as const : "upcoming" as const,
  }));
}

// ─── Budget rows ──────────────────────────────────────────────────────────────

/** Expects rows already narrowed by selectPhaseRows(). */
function buildBudgetRows(rows: NSPhaseRow[], baselines: Baselines, project: Project): BudgetPhaseRow[] {
  const phaseRows = rows
    .map(r => {
      const n         = phaseNumOf(r.phase_name);
      const allocated = num(r.budgeted_hours);
      const actual    = num(r.actual_hours);
      const base      = baselines.phases[r.phase_id]?.hours ?? null;

      return {
        id:                     r.phase_id,
        phaseNumber:            n,
        name:                   n && n >= 1 && n <= 5 ? PHASE_NAMES[n] : r.phase_name.trim(),
        allocatedHours:         allocated,
        // Only surface a baseline when it actually differs — drives "(adjusted from N)".
        originalAllocatedHours: base != null && Math.abs(base - allocated) > 0.01 ? base : null,
        actualHours:            actual,
        remainingHours:         Math.max(0, allocated - actual),
        status:                 nsPhaseIsComplete(r) ? "Complete"
                              : actual > 0          ? "In Progress"
                              :                       "Not Started",
      };
    })
    .sort((a, b) => (a.phaseNumber ?? 99) - (b.phaseNumber ?? 99));

  if (phaseRows.length > 0) return phaseRows;

  // No NetSuite phase breakdown — fall back to the project-level hours.
  return [{
    id:                     `proj-${project.id}`,
    phaseNumber:            null,
    name:                   "Project Total",
    allocatedHours:         project.budget_hours,
    originalAllocatedHours: null,
    actualHours:            project.actual,
    remainingHours:         project.rem,
    status:                 project.pct >= 1 ? "Complete" : project.actual > 0 ? "In Progress" : "Not Started",
  }];
}

// ─── Milestones ───────────────────────────────────────────────────────────────

function milestoneState(t: CUTask, now: number): MilestoneState {
  if (isDone(t)) return "complete";
  const due = parseDue(t);
  if (due != null && due < now) return "at_risk";
  const st = t.status.status.toLowerCase();
  if (st.includes("progress") || st.includes("review") || st.includes("uat")) return "in_progress";
  if (due != null && due < now + 14 * dayMs) return "on_track";
  return "upcoming";
}

function buildMilestones(project: Project, baselines: Baselines, now: number): MilestoneRow[] {
  return project.milestones
    .map(t => {
      const est  = isoFromMs(parseDue(t));
      const orig = baselines.milestones[t.id]?.date ?? est;
      return {
        id:          t.id,
        name:        t.name,
        highlight:   t.assignees.length > 0 ? `Owner: ${ownerOf(t)}` : "",
        estDueDate:  est,
        origDueDate: orig,
        status:      milestoneState(t, now),
        extended:    !!(est && orig && est > orig),
      };
    })
    .sort((a, b) => (a.estDueDate ?? "9999").localeCompare(b.estDueDate ?? "9999"));
}

// ─── Risk detection ───────────────────────────────────────────────────────────

function detectRisks(project: Project, budgetRows: BudgetPhaseRow[], now: number): Risk[] {
  const risks: Risk[] = [];
  const add = (r: Omit<Risk, "id" | "source">) => risks.push({ ...r, id: newId("risk"), source: "auto" });

  // Blocked work
  if (project.blocked.length > 0) {
    const names = project.blocked.slice(0, 3).map(t => t.name).join("; ");
    add({
      title:      `${project.blocked.length} blocked task${project.blocked.length > 1 ? "s" : ""}`,
      severity:   project.blocked.length >= 3 ? "high" : "medium",
      impact:     `Work cannot progress on: ${names}${project.blocked.length > 3 ? `, +${project.blocked.length - 3} more` : ""}.`,
      mitigation: "Review each blocker on the weekly call and assign a named owner with a clear-by date.",
      owner:      project.pm || "PM",
    });
  }

  // Waiting on the client
  if (project.clientPending.length > 0) {
    const names = project.clientPending.slice(0, 3).map(t => t.name).join("; ");
    add({
      title:      `${project.clientPending.length} item${project.clientPending.length > 1 ? "s" : ""} awaiting client action`,
      severity:   project.clientPending.length >= 4 ? "high" : "medium",
      impact:     `Downstream tasks are held pending: ${names}${project.clientPending.length > 3 ? `, +${project.clientPending.length - 3} more` : ""}.`,
      mitigation: "Confirm owners and due dates with the client team on the Tuesday status call.",
      owner:      project.client,
    });
  }

  // Overdue open work
  const overdue = project.tasks.filter(t => {
    const due = parseDue(t);
    return due != null && due < now && !isDone(t);
  });
  if (overdue.length > 0) {
    add({
      title:      `${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}`,
      severity:   overdue.length >= 5 ? "high" : "medium",
      impact:     `Schedule slippage against plan; oldest item is "${overdue[0].name}".`,
      mitigation: "Re-baseline due dates that are no longer realistic and escalate the rest.",
      owner:      project.pm || "PM",
    });
  }

  // Burning hours faster than progressing
  if (project.budgetGap > 0.15) {
    add({
      title:      "Hours consumed ahead of delivered progress",
      severity:   project.budgetGap > 0.25 ? "high" : "medium",
      impact:     `${Math.round(project.burnRate * 100)}% of budget consumed against ${Math.round(project.pct * 100)}% completion (SPI ${project.spi.toFixed(2)}).`,
      mitigation: "Review scope against remaining hours and raise a change order if the gap persists.",
      owner:      project.pm || "PM",
    });
  }

  // Nearly out of hours
  if (project.rem <= 0) {
    add({
      title:      "Project budget exhausted",
      severity:   "high",
      impact:     `${fmtHrs(project.actual)} logged against a ${fmtHrs(project.budget_hours)} budget — remaining hours are ${fmtHrs(project.rem)}.`,
      mitigation: "Approve additional hours or formally reduce remaining scope before further work is booked.",
      owner:      project.pm || "PM",
    });
  } else if (project.rem < 15 && project.pct < 0.85) {
    add({
      title:      "Remaining hours low relative to outstanding scope",
      severity:   "high",
      impact:     `Only ${fmtHrs(project.rem)} remain with ${Math.round((1 - project.pct) * 100)}% of tasks still open.`,
      mitigation: "Forecast the hours needed to close out and agree a top-up or scope cut this week.",
      owner:      project.pm || "PM",
    });
  }

  // Phases over budget
  const over = budgetRows.filter(r => r.allocatedHours > 0 && r.actualHours / r.allocatedHours > 1.1);
  if (over.length > 0) {
    add({
      title:      `${over.length} phase${over.length > 1 ? "s" : ""} over allocated hours`,
      severity:   "medium",
      impact:     over.map(r => `${r.name} at ${fmtHrs(r.actualHours)} of ${fmtHrs(r.allocatedHours)}`).join("; ") + ".",
      mitigation: "Reallocate hours from later phases or adjust the phase baseline with the client's sign-off.",
      owner:      project.pm || "PM",
    });
  }

  // Go-live date missing
  if (!project.goliveDate) {
    add({
      title:      "Go-live date not set in NetSuite",
      severity:   "medium",
      impact:     "No deadline to plan the readiness and cutover phases against, and no overdue tracking.",
      mitigation: "Agree a target go-live date with the client and set it on the NetSuite project record.",
      owner:      project.pm || "PM",
    });
  } else if (project.isOverdue) {
    add({
      title:      "Past the planned go-live date",
      severity:   "high",
      impact:     `Go-live was ${fmtShort(project.goliveDate)}, ${Math.abs(project.daysLeft ?? 0)} days ago, and the project is not closed out.`,
      mitigation: "Agree a revised go-live date and communicate the new cutover plan.",
      owner:      project.pm || "PM",
    });
  }

  // NetSuite remaining-hours drift
  if (project.timebillWarning) {
    add({
      title:      "NetSuite remaining hours look out of date",
      severity:   "medium",
      impact:     "Logged time in NetSuite disagrees with the project's remaining-hours field, so budget figures in this report may understate consumption.",
      mitigation: "Ask the PM to refresh the remaining-hours field on the NetSuite project record.",
      owner:      project.pm || "PM",
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ─── Main assembly ────────────────────────────────────────────────────────────

export interface DeriveInput {
  project:     Project;
  nsPhases:    NSPhaseRow[];
  baselines:   Baselines;
  prevReport:  StatusReport | null;
  weekEnding:  string;   // ISO date (Friday)
  preparedBy:  string;
}

export function deriveStatusReport({
  project, nsPhases, baselines, prevReport, weekEnding, preparedBy,
}: DeriveInput): StatusReport {
  const weekEnd     = new Date(weekEnding + "T00:00:00");
  const weekStart   = mondayOf(weekEnd);
  const weekStartMs = weekStart.getTime();
  // Inclusive of the whole Sunday that closes the reporting week.
  const weekEndMs   = weekStartMs + 7 * dayMs;
  const now         = Date.now();

  const overallStatus: OverallStatus =
    project.health === "green" ? "on_track" : project.health === "yellow" ? "at_risk" : "critical";

  // Narrow the project's task rows to the real phases once, then feed both the
  // tracker and the budget table from the same set so they can't disagree.
  const selectedPhases = selectPhaseRows(nsPhases);
  const phaseTracker   = buildPhaseTracker(selectedPhases);
  const budgetRows     = buildBudgetRows(selectedPhases, baselines, project);
  const currentPhase = phaseTracker.find(p => p.state === "current");
  const nextPhase    = phaseTracker.find(p => p.number === (currentPhase?.number ?? 0) + 1);

  // ── Accomplishments: closed inside the reporting week ──
  const closedThisWeek = project.tasks.filter(t => {
    if (!isDone(t)) return false;
    const c = closedAt(t);
    return c != null && c >= weekStartMs && c < weekEndMs;
  });

  const accomplishments: Bullet[] = closedThisWeek.slice(0, 6).map(t => ({
    id:     newId("acc"),
    lead:   t.name,
    detail: `Completed${t.assignees.length ? ` by ${ownerOf(t)}` : ""}.`,
  }));

  // ── Deliverables this week, split Loop vs customer ──
  const inWeek = (t: CUTask) => {
    const due = parseDue(t);
    return due != null && due >= weekStartMs && due < weekEndMs;
  };
  const overdueOpen = (t: CUTask) => {
    const due = parseDue(t);
    return due != null && due < now && !isDone(t);
  };

  const candidates = project.tasks.filter(
    t => inWeek(t) || overdueOpen(t) || isClientPending(t) || isBlocked(t),
  );

  const toDeliverable = (t: CUTask): Deliverable => ({
    id:      t.id,
    title:   t.name,
    owner:   ownerOf(t),
    status:  t.status.status,
    dueDate: isoFromMs(parseDue(t)),
    state:   deliverableState(t),
    note:    isBlocked(t) ? "Blocked" : overdueOpen(t) ? "Overdue" : "",
  });

  const isCustomerSide = (t: CUTask) =>
    isClientPending(t) ||
    t.tags.some(g => /client|customer/i.test(g.name)) ||
    (t.assignees.length > 0 && !t.assignees.some(a => isLoopPerson(a.username)));

  const byDue = (a: Deliverable, b: Deliverable) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

  const deliverables = {
    loop:     candidates.filter(t => !isCustomerSide(t)).map(toDeliverable).sort(byDue).slice(0, 12),
    customer: candidates.filter(isCustomerSide).map(toDeliverable).sort(byDue).slice(0, 12),
  };

  // ── What's next: the week after the reporting week ──
  const nextStart = weekStartMs + 7 * dayMs;
  const nextEnd   = nextStart + 7 * dayMs;

  const nextWeekTasks = project.tasks.filter(t => {
    if (isDone(t)) return false;
    const due = parseDue(t);
    return due != null && due >= nextStart && due < nextEnd;
  }).sort((a, b) => (parseDue(a) ?? 0) - (parseDue(b) ?? 0));

  const nextDeliverables: Bullet[] = nextWeekTasks
    .filter(t => !isMeetingTask(t))
    .slice(0, 6)
    .map(t => ({
      id:     newId("nx"),
      lead:   t.name,
      detail: [ownerOf(t), t.due_date ? `due ${fmtShort(isoFromMs(parseDue(t)))}` : ""].filter(Boolean).join(" · "),
    }));

  const meetings = [
    // The standing PMO cadence call.
    {
      id:        newId("mtg"),
      title:     "Weekly Status Call",
      date:      nextWeekday(weekEnd, 2),   // Tuesday
      attendees: [project.pm, project.client].filter(Boolean).join(", "),
    },
    ...project.tasks
      .filter(t => !isDone(t) && isMeetingTask(t))
      .filter(t => {
        const due = parseDue(t);
        return due != null && due >= nextStart && due < nextStart + 21 * dayMs;
      })
      .sort((a, b) => (parseDue(a) ?? 0) - (parseDue(b) ?? 0))
      .slice(0, 5)
      .map(t => ({
        id:        newId("mtg"),
        title:     t.name,
        date:      isoFromMs(parseDue(t)),
        attendees: t.assignees.length ? ownerOf(t) : "",
      })),
  ];

  const phaseLine = currentPhase
    ? nextPhase && nextPhase.state === "upcoming"
      ? `Phase ${currentPhase.number}: ${currentPhase.name} → Phase ${nextPhase.number}: ${nextPhase.name}`
      : `Phase ${currentPhase.number}: ${currentPhase.name}`
    : "Phase not set";

  // ── Risks ──
  const risks = detectRisks(project, budgetRows, now);

  // ── Action items ──
  const actionItems: ActionItem[] = [
    ...project.blocked.slice(0, 4).map(t => ({
      id:        newId("act"),
      action:    `Clear blocker on "${t.name}"`,
      owner:     t.assignees.length ? ownerOf(t) : project.pm || "PM",
      ownerSide: "loop" as const,
      dueDate:   isoFromMs(parseDue(t)),
      status:    "Open",
    })),
    ...project.clientPending.slice(0, 5).map(t => ({
      id:        newId("act"),
      action:    `Provide input required for "${t.name}"`,
      owner:     t.assignees.length ? ownerOf(t) : project.client,
      ownerSide: "customer" as const,
      dueDate:   isoFromMs(parseDue(t)),
      status:    "Open",
    })),
  ].slice(0, 8);

  // ── Metrics and week-over-week delta ──
  const metrics = {
    pctComplete:         project.pct,
    tasksDone:           project.tasks.filter(isDone).length,
    tasksTotal:          project.tasks.length,
    tasksClosedThisWeek: closedThisWeek.length,
    hoursLogged:         project.actual,
    hoursBudget:         project.budget_hours,
    hoursRemaining:      project.rem,
    spi:                 project.spi,
    burnRate:            project.burnRate,
  };

  const delta = prevReport ? {
    prevWeekEnding:      prevReport.meta.weekEnding,
    prevOverallStatus:   prevReport.recap.overallStatus,
    prevPctComplete:     prevReport.recap.metrics.pctComplete,
    prevHoursLogged:     prevReport.recap.metrics.hoursLogged,
    hoursBurnedThisWeek: +(project.actual - prevReport.recap.metrics.hoursLogged).toFixed(1),
    pctPointsGained:     Math.round((project.pct - prevReport.recap.metrics.pctComplete) * 100),
  } : null;

  // ── Status reason ──
  const reasons: string[] = [];
  if (project.isOverdue)          reasons.push("past the planned go-live date");
  if (project.budgetGap > 0.15)   reasons.push(`burning hours ${Math.round(project.budgetGap * 100)}pp ahead of progress`);
  if (project.spi < 0.85)         reasons.push(`SPI at ${project.spi.toFixed(2)}`);
  if (project.rem <= 0)           reasons.push("budget exhausted");
  else if (project.rem < 15 && project.pct < 0.85) reasons.push(`only ${fmtHrs(project.rem)} remaining`);
  if (project.blocked.length)     reasons.push(`${project.blocked.length} blocked task${project.blocked.length > 1 ? "s" : ""}`);
  if (project.clientPending.length) reasons.push(`${project.clientPending.length} item${project.clientPending.length > 1 ? "s" : ""} awaiting client`);

  const statusReason = reasons.length
    ? `Health score ${project.score}/100 — driven by ${reasons.join(", ")}.`
    : `Health score ${project.score}/100 — no material schedule or budget variance this week.`;

  // ── Placeholder prose (Claude fills these in via /draft) ──
  const doneStr  = `${metrics.tasksDone} of ${metrics.tasksTotal} tasks complete (${Math.round(project.pct * 100)}%)`;
  const keyMessage =
    `${project.client} is in ${phaseLine.split(" → ")[0]} with ${doneStr}. ` +
    `${fmtHrs(project.actual)} of ${fmtHrs(project.budget_hours)} budgeted hours are consumed, leaving ${fmtHrs(project.rem)}. ` +
    (project.goliveDate
      ? `Go-live is set for ${fmtShort(project.goliveDate)}${project.daysLeft != null && !project.isOverdue ? ` (${project.daysLeft} days out)` : ""}.`
      : `A go-live date has not yet been set.`);

  return {
    version: 1,
    meta: {
      projectNsId:  String(project.id),
      projectLabel: project.label,
      client:       project.client,
      projectName:  project.projectName,
      projectType:  project.projectType,
      pm:           project.pm,
      preparedBy,
      weekStarting: toISODate(weekStart),
      weekEnding,
      reportDate:   toISODate(new Date()),
      goLiveDate:   project.goliveDate,
      daysToGoLive: project.daysLeft,
      nsUrl:        project.nsUrl,
      clickupUrl:   project.clickupUrl,
    },
    recap: {
      overallStatus,
      statusReason,
      keyMessage,
      phaseTracker,
      accomplishments,
      metrics,
      delta,
    },
    deliverables,
    whatsNext: {
      phase:        phaseLine,
      focus:        nextPhase && nextPhase.state === "upcoming"
                      ? `Close out Phase ${currentPhase?.number} deliverables and open Phase ${nextPhase.number}: ${nextPhase.name}.`
                      : `Continue ${currentPhase?.name ?? "delivery"} workstreams.`,
      deliverables: nextDeliverables,
      meetings,
    },
    risks: {
      assessment: risks.length
        ? `${risks.filter(r => r.severity === "high").length} high and ${risks.filter(r => r.severity === "medium").length} medium severity risks are open this week.`
        : "No material risks identified from project data this week.",
      risks,
    },
    budget: {
      rows: budgetRows,
      note: "Billing based on actual hours",
      dataWarning: project.timebillWarning
        ? "NetSuite remaining hours disagree with logged time — figures may understate consumption."
        : null,
    },
    milestones: buildMilestones(project, baselines, now),
    actions: {
      recap: "",
      items: actionItems,
    },
  };
}
