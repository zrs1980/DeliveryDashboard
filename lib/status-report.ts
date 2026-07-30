// ─── Weekly Project Status Report — shared data model ─────────────────────────
//
// Client-safe: types + pure display helpers only. No NetSuite/ClickUp imports so
// this can be pulled into the wizard and the PDF renderer.
// Server-side assembly lives in lib/status-report-derive.ts.

export type OverallStatus  = "on_track" | "at_risk" | "critical";
export type Severity       = "high" | "medium" | "low";
export type MilestoneState = "complete" | "in_progress" | "on_track" | "at_risk" | "upcoming";
export type DeliverableState = "done" | "in_progress" | "blocked" | "pending";

/** A bolded lead-in plus supporting detail — matches the deck's bullet style. */
export interface Bullet {
  id:     string;
  lead:   string;
  detail: string;
}

export interface StatusReportMeta {
  projectNsId:   string;
  projectLabel:  string;          // "Oxide — NetSuite Implementation"
  client:        string;
  projectName:   string;
  projectType:   string;
  pm:            string;
  preparedBy:    string;
  weekStarting:  string;          // ISO date — Monday
  weekEnding:    string;          // ISO date — Friday
  reportDate:    string;          // ISO date the report was generated
  goLiveDate:    string | null;
  daysToGoLive:  number | null;
  nsUrl:         string;
  clickupUrl:    string | null;
}

export interface PhaseTrackerEntry {
  number: number;
  name:   string;
  state:  "complete" | "current" | "upcoming";
}

export interface ReportMetrics {
  pctComplete:         number;   // 0–1
  tasksDone:           number;
  tasksTotal:          number;
  tasksClosedThisWeek: number;
  hoursLogged:         number;
  hoursBudget:         number;
  hoursRemaining:      number;
  spi:                 number;
  burnRate:            number;   // 0–1
}

/** Week-over-week movement, when a prior report exists. */
export interface ReportDelta {
  prevWeekEnding:      string;
  prevOverallStatus:   OverallStatus | null;
  prevPctComplete:     number | null;
  prevHoursLogged:     number | null;
  hoursBurnedThisWeek: number | null;
  pctPointsGained:     number | null;
}

// ─── 1. Quick recap of project status ─────────────────────────────────────────

export interface RecapSection {
  overallStatus:   OverallStatus;
  statusReason:    string;
  keyMessage:      string;
  phaseTracker:    PhaseTrackerEntry[];
  accomplishments: Bullet[];
  metrics:         ReportMetrics;
  delta:           ReportDelta | null;
}

// ─── 2. Loop's weekly deliverables vs the customer's ──────────────────────────

export interface Deliverable {
  id:      string;
  title:   string;
  owner:   string;
  status:  string;
  dueDate: string | null;
  state:   DeliverableState;
  note:    string;
}

export interface DeliverablesSection {
  loop:     Deliverable[];
  customer: Deliverable[];
}

// ─── 3. What's next ───────────────────────────────────────────────────────────

export interface Meeting {
  id:        string;
  title:     string;
  date:      string | null;
  attendees: string;
}

export interface WhatsNextSection {
  phase:        string;
  focus:        string;
  deliverables: Bullet[];
  meetings:     Meeting[];
}

// ─── 4. Risks ─────────────────────────────────────────────────────────────────

export interface Risk {
  id:         string;
  title:      string;
  severity:   Severity;
  impact:     string;
  mitigation: string;
  owner:      string;
  source:     "auto" | "manual";
}

export interface RisksSection {
  assessment: string;
  risks:      Risk[];
}

// ─── 5. Project budget overview ───────────────────────────────────────────────

export interface BudgetPhaseRow {
  id:                     string;
  phaseNumber:            number | null;
  name:                   string;
  allocatedHours:         number;
  originalAllocatedHours: number | null;   // renders as "114 (adjusted from 130)"
  actualHours:            number;
  remainingHours:         number;
  status:                 string;
}

export interface BudgetSection {
  rows:        BudgetPhaseRow[];
  note:        string;
  dataWarning: string | null;
}

// ─── Milestones ───────────────────────────────────────────────────────────────

export interface MilestoneRow {
  id:          string;
  name:        string;
  highlight:   string;
  estDueDate:  string | null;
  origDueDate: string | null;
  status:      MilestoneState;
  extended:    boolean;
}

// ─── 6. Recap and action items ────────────────────────────────────────────────

export interface ActionItem {
  id:        string;
  action:    string;
  owner:     string;
  ownerSide: "loop" | "customer";
  dueDate:   string | null;
  status:    string;
}

export interface ActionsSection {
  recap: string;
  items: ActionItem[];
}

// ─── The report ───────────────────────────────────────────────────────────────

export interface StatusReport {
  version:      1;
  meta:         StatusReportMeta;
  recap:        RecapSection;
  deliverables: DeliverablesSection;
  whatsNext:    WhatsNextSection;
  risks:        RisksSection;
  budget:       BudgetSection;
  milestones:   MilestoneRow[];
  actions:      ActionsSection;
}

// ─── Loop Services deck palette ───────────────────────────────────────────────
// Sampled from the July 2026 Oxide status deck (ppt/theme + slide fills) so the
// generated PDF matches the template the PM already sends out.

export const D = {
  navy:       "#0A1628",   // slide background
  navyDeep:   "#060E1F",   // cover background
  card:       "#0D2247",   // panel fill
  cardAlt:    "#1A3A6B",   // table header / nested fill
  cardLine:   "#1E3A5F",   // panel border
  accent:     "#3D6EC4",   // primary accent (headings, rules)
  accentSoft: "#5B8DEF",   // secondary accent (bullets, links)
  textOn:     "#FFFFFF",
  textMut:    "#AEC0D6",
  textDim:    "#8B9BB4",
  textFaint:  "#D0DCEF",
  green:      "#22C55E",
  greenDeep:  "#12351F",
  amber:      "#F5B942",
  amberDeep:  "#3A2C0C",
  red:        "#EF6461",
  redDeep:    "#3A1614",
  teal:       "#2E9E96",   // Loop Services logo teal
} as const;

// ─── Display helpers ──────────────────────────────────────────────────────────

export const STATUS_META: Record<OverallStatus, { label: string; color: string; bg: string }> = {
  on_track: { label: "ON TRACK", color: D.green, bg: D.greenDeep },
  at_risk:  { label: "AT RISK",  color: D.amber, bg: D.amberDeep },
  critical: { label: "CRITICAL", color: D.red,   bg: D.redDeep },
};

export const SEVERITY_META: Record<Severity, { label: string; color: string; bg: string }> = {
  high:   { label: "HIGH",   color: D.red,   bg: D.redDeep },
  medium: { label: "MEDIUM", color: D.amber, bg: D.amberDeep },
  low:    { label: "LOW",    color: D.green, bg: D.greenDeep },
};

export const MILESTONE_META: Record<MilestoneState, { label: string; color: string }> = {
  complete:    { label: "Complete",    color: D.green },
  in_progress: { label: "In Progress", color: D.accentSoft },
  on_track:    { label: "On Track",    color: D.green },
  at_risk:     { label: "At Risk",     color: D.amber },
  upcoming:    { label: "Upcoming",    color: D.textDim },
};

export const DELIVERABLE_META: Record<DeliverableState, { label: string; color: string }> = {
  done:        { label: "Done",        color: D.green },
  in_progress: { label: "In Progress", color: D.accentSoft },
  blocked:     { label: "Blocked",     color: D.red },
  pending:     { label: "Pending",     color: D.textDim },
};

/** "Jul 23, 2026" */
export function fmtLong(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "07/23" — the deck's milestone-table date format */
export function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export const fmtNum = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));
export const fmtHrs = (n: number) => fmtNum(n) + "h";
export const fmtPc  = (n: number) => Math.round(n * 100) + "%";

/** Monday of the week containing `d` (local time). */
export function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Friday of the week containing `d` — the default reporting week-ending date. */
export function fridayOf(d: Date): string {
  const f = mondayOf(d);
  f.setDate(f.getDate() + 4);
  return toISODate(f);
}

/** Budget totals across phase rows. */
export function budgetTotals(rows: BudgetPhaseRow[]) {
  return rows.reduce(
    (t, r) => ({
      allocated: t.allocated + (r.allocatedHours || 0),
      actual:    t.actual    + (r.actualHours    || 0),
      remaining: t.remaining + (r.remainingHours || 0),
    }),
    { allocated: 0, actual: 0, remaining: 0 },
  );
}

/** Stable-enough id for locally added rows. */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Filename for the downloaded PDF. */
export function reportFilename(meta: StatusReportMeta): string {
  const safe = `${meta.client} ${meta.projectName}`.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${safe}-Weekly-Status-${meta.weekEnding}.pdf`;
}
