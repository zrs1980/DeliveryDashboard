"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { C } from "@/lib/constants";
import type { NSAllocation, ConsultantRosterEntry } from "@/lib/types";

interface Props {
  allocations: NSAllocation[];
  consultantRoster?: ConsultantRosterEntry[];
  error?: string | null;
}

interface CellEdit {
  allocationId:  string | null;   // null = creating a new allocation
  employeeId:    number;
  employeeName:  string;
  projectId:     number;
  projectName:   string;
  projectType:   string;   // raw NetSuite jobtype name
  companyName:   string;
  remainingHours: number | null;
  budgetHours:   number | null;
  weekMs:        number;
  // Carried through so an optimistically-created allocation classifies correctly
  // before the next refresh. Without these the new row reads as undefined and is
  // excluded from every Billable/Utilized/Productive figure.
  classifyAsBillable:   boolean;
  classifyAsUtilized:   boolean;
  classifyAsProductive: boolean;
}

// ─── Week helpers ─────────────────────────────────────────────────────────────

function getMondayOf(d: Date): Date {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const dow = day.getDay();
  day.setDate(day.getDate() - ((dow + 6) % 7));
  return day;
}

function generateWeeks(n = 10): Date[] {
  const mon = getMondayOf(new Date());
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i * 7);
    return d;
  });
}

function fmtWeekHeader(d: Date): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }).toUpperCase();
}

function parseNSDate(s: string): Date | null {
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = iso ? new Date(s + "T00:00:00") : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function allocCoversWeek(a: NSAllocation, weekStart: Date): boolean {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const s = parseNSDate(a.startDate);
  const e = parseNSDate(a.endDate);
  if (!s || !e) return false;
  return s <= weekEnd && e >= weekStart;
}

function weeklyHours(a: NSAllocation): number {
  if (a.percentOfMax > 0) return (a.percentOfMax / 100) * 40;
  return a.hoursPerDay * 5;
}

function totalPctForWeek(allocations: NSAllocation[], weekStart: Date): number {
  const totalHrs = allocations
    .filter(a => allocCoversWeek(a, weekStart))
    .reduce((sum, a) => sum + hoursForWeek(a, weekStart), 0);
  return (totalHrs / 40) * 100;
}

function hoursForWeek(a: NSAllocation, weekStart: Date): number {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const s = parseNSDate(a.startDate);
  const e = parseNSDate(a.endDate);
  if (!s || !e) return 0;
  if (s > weekEnd || e < weekStart) return 0;

  // Fully covered week — return full weekly hours
  if (s <= weekStart && e >= weekEnd) return weeklyHours(a);

  // Partial week — pro-rate by working days (Mon–Fri) in the overlap
  const overlapStart = s > weekStart ? s : weekStart;
  const overlapEnd   = e < weekEnd   ? e : weekEnd;

  let workDays = 0;
  const d = new Date(overlapStart);
  d.setHours(0, 0, 0, 0);
  const last = new Date(overlapEnd);
  last.setHours(0, 0, 0, 0);
  while (d <= last) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) workDays++;
    d.setDate(d.getDate() + 1);
  }

  return (weeklyHours(a) / 5) * workDays;
}

function countWorkDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Total future hours from today to endDate — iterate week-by-week so the result
// matches the discrete work-day calculation used in hoursForWeek()
function estimatedFutureHours(a: NSAllocation, today: Date): number {
  const end = parseNSDate(a.endDate);
  if (!end) return 0;
  let total = 0;
  const week = new Date(today);
  week.setHours(0, 0, 0, 0);
  while (week <= end) {
    total += hoursForWeek(a, week);
    week.setDate(week.getDate() + 7);
  }
  return total;
}

// ─── Allocation bands ─────────────────────────────────────────────────────────
// Three bands, no middle ground: a consultant is either short of work, in the sweet
// spot, or over-committed.
//
//   under-allocated   < 70%
//   optimal           70–80%
//   over-allocated    > 80%
//
// This replaces a five-band cell scale (>100 Over / 80–100 High / 70–79 Optimal /
// 50–69 Med / <50 Low) whose KPI cards then used a THIRD set of cut-offs (≥80 High /
// 20–79 Normal / <20 Light). A consultant at 60% read "Normal" green on the card and
// "Med" amber in the grid — two answers to the same question on one screen. One
// function now drives the cards, the legend and every cell.

type AllocationBand = "under" | "optimal" | "over";

const ALLOC_OPTIMAL_MIN = 70;
const ALLOC_OPTIMAL_MAX = 80;

/**
 * Band a weekly allocation percentage.
 *
 * Rounds first, deliberately. The grid prints whole percents, and 28h of a 40-hour
 * week evaluates to 69.99999999999999 in floating point — banding the raw value would
 * paint a cell reading "70%" as under-allocated. What is shown is what is coloured.
 */
function allocationBand(pct: number): AllocationBand {
  const p = Math.round(pct);
  if (p > ALLOC_OPTIMAL_MAX) return "over";
  if (p >= ALLOC_OPTIMAL_MIN) return "optimal";
  return "under";
}

/** Colour and label for each band — the only place either is defined. */
const BAND_STYLE: Record<AllocationBand, { color: string; bg: string; bd: string; label: string }> = {
  over:    { color: C.red,    bg: C.redBg,    bd: C.redBd,    label: `Over-allocated (>${ALLOC_OPTIMAL_MAX}%)`  },
  optimal: { color: C.green,  bg: C.greenBg,  bd: C.greenBd,  label: `Optimal (${ALLOC_OPTIMAL_MIN}–${ALLOC_OPTIMAL_MAX}%)` },
  under:   { color: C.yellow, bg: C.yellowBg, bd: C.yellowBd, label: `Under-allocated (<${ALLOC_OPTIMAL_MIN}%)` },
};

const BAND_ORDER: AllocationBand[] = ["over", "optimal", "under"];

// ─── Cell colour helpers ──────────────────────────────────────────────────────

function pctCellStyle(pct: number): React.CSSProperties {
  // 0% means nothing is allocated at all, and is left blank so the dense grid stays
  // scannable rather than painting every empty cell amber. The KPI cards still count
  // it as under-allocated — a consultant with no work is exactly that.
  if (pct === 0) return { background: "transparent", color: C.mid };
  const s = BAND_STYLE[allocationBand(pct)];
  return { background: s.bg, color: s.color, fontWeight: 700, border: `1px solid ${s.bd}` };
}

function gapStyle(gap: number): React.CSSProperties {
  if (gap < -5)  return { color: C.red,    fontWeight: 700 };
  if (gap < 10)  return { color: C.yellow, fontWeight: 700 };
  return               { color: C.green,   fontWeight: 600 };
}

// ─── Project grouping ─────────────────────────────────────────────────────────
// Two bands — client-facing delivery work vs internal — each sub-grouped by the raw
// NetSuite jobtype name (Implementation, Service, Managed Services Agreement, …).
// Display grouping only: never a substitute for the Billable/Utilized/Productive
// flags, which come from the project record.

type ProjectGroup = "Customer Projects" | "Internal";

const GROUP_ORDER: readonly ProjectGroup[] = ["Customer Projects", "Internal"];

const GROUP_STYLE: Record<ProjectGroup, { bg: string; color: string; bd: string }> = {
  "Customer Projects": { bg: C.purpleBg, color: C.purple,  bd: C.purpleBd },
  "Internal":          { bg: C.alt,      color: C.textSub, bd: C.border   },
};

/** Same rule as /api/manager-review and TimeAnalysis: anything typed and not "Internal". */
function isCustomerProjectType(projectType: string | null | undefined): boolean {
  const t = (projectType ?? "").toLowerCase().trim();
  return t !== "" && t !== "internal";
}

function projectGroupOf(projectType: string | null | undefined): ProjectGroup {
  return isCustomerProjectType(projectType) ? "Customer Projects" : "Internal";
}

/** Sub-group label — NetSuite's own jobtype name, or a placeholder when unset. */
function projectTypeLabel(projectType: string | null | undefined): string {
  const t = (projectType ?? "").trim();
  return t === "" ? "Unclassified" : t;
}

// Preferred sub-group order; anything NetSuite reports that isn't listed sorts after
// these alphabetically, so a new jobtype shows up on its own rather than being hidden.
const TYPE_RANK: readonly string[] = ["implementation", "service", "managed services agreement"];

function compareProjectTypes(a: string, b: string): number {
  const ra = TYPE_RANK.indexOf(a.toLowerCase());
  const rb = TYPE_RANK.indexOf(b.toLowerCase());
  if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  return a.localeCompare(b);
}

const TYPE_TINT: Record<string, { bg: string; color: string; bd: string }> = {
  "implementation":              { bg: C.purpleBg, color: C.purple,  bd: C.purpleBd },
  "service":                     { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
  "managed services agreement":  { bg: C.tealBg,   color: C.teal,    bd: C.tealBd   },
  "technical services":          { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
  "consulting services":         { bg: C.purpleBg, color: C.purple,  bd: C.purpleBd },
  "general consulting":          { bg: C.purpleBg, color: C.purple,  bd: C.purpleBd },
  "training":                    { bg: C.orangeBg, color: C.orange,  bd: C.orangeBd },
  "internal":                    { bg: C.alt,      color: C.textSub, bd: C.border   },
};

function projectTypeTint(projectType: string | null | undefined) {
  return TYPE_TINT[(projectType ?? "").toLowerCase().trim()]
      ?? { bg: C.alt, color: C.textMid, bd: C.border };
}

/** Compact chip label, e.g. "Managed Services Agreement" → "MSA". */
function projectTypeShort(projectType: string | null | undefined): string {
  const t = (projectType ?? "").trim();
  if (t === "") return "—";
  if (/managed\s*service/i.test(t))  return "MSA";
  if (/^implementation$/i.test(t))   return "Impl";
  if (/technical\s*services/i.test(t)) return "Tech";
  if (/consulting/i.test(t))         return "Consult";
  return t.length <= 8 ? t : t.slice(0, 8) + "…";
}

/**
 * The project's "Resource Allocation Note" — identical on every allocation row of a
 * project, so the first row that carries one is representative.
 */
function resourceNoteOf(allocs: Array<{ resourceNote?: string | null }>): string | null {
  for (const a of allocs) {
    const n = (a.resourceNote ?? "").trim();
    if (n) return n;
  }
  return null;
}

/**
 * The PM's allocation note, shown beside a project row.
 *
 * Deliberately neutral grey rather than a RAG colour — this is a label the PM wrote,
 * not a health signal. Renders nothing when the project has no note, so rows on the
 * projects nobody annotates are unchanged.
 */
function NoteChip({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <span
      title={`NetSuite project User Note — "Resource Allocation Note": ${note}`}
      style={{
        marginLeft: 8, display: "inline-block", verticalAlign: "middle",
        padding: "0 6px", borderRadius: 3,
        fontSize: 10, fontWeight: 600, lineHeight: "16px",
        background: C.alt, color: C.textMid, border: `1px solid ${C.border}`,
        maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >
      ✎ {note}
    </span>
  );
}

/**
 * The same note rendered as its own line beneath a project title, for the consultant
 * table — where the project cell is nowrap/ellipsis-clipped at 440px and an inline
 * chip on a long project name (e.g. "Placeholder Project for Capacity Planning") gets
 * cut off entirely. On its own line it also wraps, so a long note stays readable.
 */
function NoteLine({ note, indent = 18 }: { note: string | null; indent?: number }) {
  if (!note) return null;
  return (
    <div
      title={`NetSuite project User Note — "Resource Allocation Note"`}
      style={{
        marginTop: 3, paddingLeft: indent,
        fontSize: 10, lineHeight: 1.4, color: C.textSub,
        whiteSpace: "normal", fontWeight: 500,
      }}
    >
      ✎ {note}
    </div>
  );
}

/** Group an array by its project group, preserving input order within each band. */
function groupByProjectGroup<T>(items: T[], typeOf: (x: T) => string | null | undefined) {
  const out: Partial<Record<ProjectGroup, T[]>> = {};
  for (const it of items) {
    const g = projectGroupOf(typeOf(it));
    (out[g] ??= []).push(it);
  }
  return out;
}

/** Split one band into its sub-groups, ordered by TYPE_RANK then alphabetically. */
function subGroupsByType<T>(items: T[], typeOf: (x: T) => string | null | undefined) {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const label = projectTypeLabel(typeOf(it));
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(it);
  }
  return [...map.entries()]
    .sort((a, b) => compareProjectTypes(a[0], b[0]))
    .map(([label, rows]) => ({ label, rows }));
}

/**
 * Weekly floor of customer-project hours per consultant, shown as "Need Xh" on the
 * Customer Projects total row when expanding a resource.
 *
 * Carried over unchanged from when this applied to the Implementation group alone.
 * NOTE: the same row now also counts Service and Managed Services Agreement work,
 * so the floor is easier to hit than it was — adjust if the intent was 30h of
 * Implementation specifically.
 */
const CUSTOMER_WEEK_FLOOR = 30;

/** B / U / P classification chips, shared by both grids. */
function ClassChips({
  billable, utilized, productive, size = 14,
}: { billable: boolean; utilized: boolean; productive: boolean; size?: number }) {
  const chips = [
    { k: "B", on: billable,   color: C.green, name: "Billable"   },
    { k: "U", on: utilized,   color: C.blue,  name: "Utilized"   },
    { k: "P", on: productive, color: C.teal,  name: "Productive" },
  ];
  return (
    <span
      style={{ display: "inline-flex", gap: 2, verticalAlign: "middle" }}
      title={chips.map(c => `${c.name}: ${c.on ? "yes" : "no"}`).join(" · ") + " (from the NetSuite project record)"}
    >
      {chips.map(c => (
        <span
          key={c.k}
          style={{
            fontFamily: C.mono, fontSize: size <= 14 ? 9 : 10, fontWeight: 700, lineHeight: `${size}px`,
            width: size, height: size, textAlign: "center", borderRadius: 3,
            background: c.on ? c.color : C.alt,
            color:      c.on ? "#fff"  : C.mid,
            border: `1px solid ${c.on ? c.color : C.border}`,
          }}
        >
          {c.k}
        </span>
      ))}
    </span>
  );
}

// ─── Sub-tab / Forecast helpers ───────────────────────────────────────────

type SubTab = "allocation" | "forecast";
type ForecastPeriod = "week" | "month" | "quarter" | "wtd" | "mtd" | "qtd" | "custom";

const PERIOD_LABELS: Record<ForecastPeriod, string> = {
  week: "Week", month: "Month", quarter: "Quarter",
  wtd: "WTD", mtd: "MTD", qtd: "QTD",
  custom: "Custom",
};

/** Inclusive ISO date range for the Custom period. */
interface CustomRange { start: string; end: string }

/** Parse a yyyy-mm-dd input value as a LOCAL date — bare `new Date(iso)` is UTC
 *  and shifts the day backwards for anyone behind Greenwich. */
function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Hard cap on the custom range span.
 *
 * countWorkDays() and hoursInRange() both walk the range a day at a time, so span
 * length drives real work. A mistyped year ("0202-01-01") parses as a valid date
 * and would otherwise mean ~600k iterations per allocation — enough to lock the
 * browser. Two years is far beyond any useful forecast window.
 */
const MAX_CUSTOM_DAYS = 731;

/** Default custom window: Monday of this week through four weeks out. */
function defaultCustomRange(today: Date): CustomRange {
  const s = getMondayOf(today);
  const e = new Date(s);
  e.setDate(s.getDate() + 27);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(s), end: iso(e) };
}

const FORECAST_BILL_RATIO = 0.87;

/**
 * Forecast RAG: the target is a floor. At or above it is green, below it is red.
 * There is no amber band — being under target is under target.
 *
 * Compared in HOURS against the hour target, not percentage against percentage.
 * The old form (`pct >= tgt * 0.95`) put consultants on a band edge and let
 * floating point decide which side they fell: 24h of a 30h target computed
 * 0.6 >= 0.6000000000000001 → false → red, while 19h of a 20h target computed
 * 0.475 >= 0.4749999999999999 → true → green. Two people equally on a boundary,
 * coloured oppositely by rounding dust.
 *
 * EPS is half the display precision (cells show 0.1h), so someone exactly at
 * target reads green even when the arithmetic lands a hair under.
 */
const RAG_EPSILON_H = 0.05;

const ragFromGap = (gapHours: number): "green" | "yellow" | "red" =>
  gapHours >= -RAG_EPSILON_H ? "green" : "red";

function getPeriodBounds(period: ForecastPeriod, today: Date, custom?: CustomRange): { start: Date; end: Date } {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);

  if (period === "custom") {
    const s = parseISODate(custom?.start);
    const e = parseISODate(custom?.end);
    if (s && e) {
      // Clamp a backwards range to a single day rather than returning a negative
      // window, which would make every capacity figure zero with no explanation.
      let end = e < s ? new Date(s) : e;
      // Then clamp the span — see MAX_CUSTOM_DAYS.
      const maxEnd = new Date(s);
      maxEnd.setDate(s.getDate() + MAX_CUSTOM_DAYS);
      if (end > maxEnd) end = maxEnd;
      return { start: s, end };
    }
    // Either date still being typed — fall back to this week so the view stays usable.
    const ws = getMondayOf(d);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    return { start: ws, end: we };
  }

  switch (period) {
    case "week": {
      const s = getMondayOf(d);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      return { start: s, end: e };
    }
    case "wtd":  return { start: getMondayOf(d), end: d };
    case "month": return {
      start: new Date(d.getFullYear(), d.getMonth(), 1),
      end:   new Date(d.getFullYear(), d.getMonth() + 1, 0),
    };
    case "mtd":  return { start: new Date(d.getFullYear(), d.getMonth(), 1), end: d };
    case "quarter": {
      const q = Math.floor(d.getMonth() / 3);
      return { start: new Date(d.getFullYear(), q * 3, 1), end: new Date(d.getFullYear(), q * 3 + 3, 0) };
    }
    case "qtd": {
      const q = Math.floor(d.getMonth() / 3);
      return { start: new Date(d.getFullYear(), q * 3, 1), end: d };
    }
  }
}

function hoursInRange(a: NSAllocation, rangeStart: Date, rangeEnd: Date): number {
  const s = parseNSDate(a.startDate);
  const e = parseNSDate(a.endDate);
  if (!s || !e) return 0;
  const os = s > rangeStart ? s : new Date(rangeStart);
  const oe = e < rangeEnd   ? e : new Date(rangeEnd);
  if (os > oe) return 0;
  let workDays = 0;
  const cur = new Date(os); cur.setHours(0, 0, 0, 0);
  const last = new Date(oe); last.setHours(0, 0, 0, 0);
  while (cur <= last) {
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5) workDays++;
    cur.setDate(cur.getDate() + 1);
  }
  return (weeklyHours(a) / 5) * workDays;
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function getPeriodDisplayLabel(period: ForecastPeriod, today: Date, custom?: CustomRange): string {
  const { start, end } = getPeriodBounds(period, today, custom);
  const q = Math.floor(today.getMonth() / 3) + 1;
  switch (period) {
    case "custom":  return `${fmtDateShort(start)} – ${fmtDateShort(end)}`;
    case "week":    return `${fmtDateShort(start)} – ${fmtDateShort(end)}`;
    case "wtd":     return `${fmtDateShort(start)} – Today`;
    case "month":   return today.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
    case "mtd":     return `${fmtDateShort(start)} – Today`;
    case "quarter": return `Q${q} ${today.getFullYear()} · ${fmtDateShort(start)} – ${fmtDateShort(end)}`;
    case "qtd":     return `Q${q} ${today.getFullYear()} – Today`;
  }
}

// ─── Mini progress bar for forecast cells ────────────────────────────────

function MiniBar({ pct, tgt, color }: { pct: number; tgt: number; color: string }) {
  const fillW = Math.min(pct * 100, 120);
  const tgtW  = Math.min(tgt * 100, 120);
  return (
    <div style={{ position: "relative", height: 5, background: C.border, borderRadius: 3, marginTop: 5, width: "100%" }}>
      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${fillW}%`, background: color, borderRadius: 3, opacity: 0.85 }} />
      <div style={{ position: "absolute", top: -2, left: `${tgtW}%`, width: 2, height: 9, background: C.textSub, borderRadius: 1, transform: "translateX(-50%)", opacity: 0.5 }} />
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: C.textSub,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: `1px solid ${C.border}`,
  background: C.alt,
  whiteSpace: "nowrap",
  textAlign: "center",
};

const stickyLeft: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
};

// ─── Main component ───────────────────────────────────────────────────────────

export function ResourceAllocation({ allocations, consultantRoster = [], error }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const weeks    = useMemo(() => generateWeeks(10), []);
  const today    = getMondayOf(new Date());
  const todayMs  = today.getTime();

  // Local copy of allocations — updated optimistically after edits
  const [localAllocs, setLocalAllocs] = useState<NSAllocation[]>(allocations);
  useEffect(() => setLocalAllocs(allocations), [allocations]);

  // Project grid state
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<CellEdit | null>(null);
  const [editValue,   setEditValue]   = useState("");
  const [savingId,    setSavingId]    = useState<string | null>(null);
  const [cellError,   setCellError]   = useState<{ id: string; msg: string } | null>(null);
  const savingRef = useRef(false);

  const [subTab, setSubTab] = useState<SubTab>("allocation");
  const [forecastPeriod, setForecastPeriod] = useState<ForecastPeriod>("week");
  const [customRange, setCustomRange]       = useState<CustomRange>(() => defaultCustomRange(new Date()));
  const [expandedForecastRows, setExpandedForecastRows] = useState<Set<string>>(new Set());

  function toggleForecastRow(name: string) {
    setExpandedForecastRows(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  // Group by employee
  const byEmployee = useMemo(() => {
    const map = new Map<string, { employeeId: number; name: string; rows: NSAllocation[] }>();
    for (const a of localAllocs) {
      const key = a.employeeName;
      if (!map.has(key)) map.set(key, { employeeId: a.employeeId, name: a.employeeName, rows: [] });
      map.get(key)!.rows.push(a);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [localAllocs]);

  // Group by project
  const byProject = useMemo(() => {
    const map = new Map<number, {
      projectId: number;
      name: string;
      companyName: string;
      projectType: string;
      remainingHours: number | null;
      budgetHours: number | null;
      consumedHours: number;
      actualHours: number;
      billableHours: number;
      isFixedFee: boolean;
      rows: NSAllocation[];
    }>();
    for (const a of localAllocs) {
      if (!map.has(a.projectId)) {
        map.set(a.projectId, {
          projectId:      a.projectId,
          name:           a.projectName,
          companyName:    a.companyName,
          projectType:    a.projectType ?? "Internal",
          remainingHours: a.remainingHours,
          budgetHours:    a.budgetHours,
          consumedHours:  a.consumedHours ?? 0,
          actualHours:    a.actualHours   ?? 0,
          billableHours:  a.billableHours ?? 0,
          isFixedFee:     a.isFixedFee    ?? false,
          rows:           [],
        });
      }
      map.get(a.projectId)!.rows.push(a);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [localAllocs]);

  // KPIs (current week)
  const kpis = useMemo(() => {
    // Counted through allocationBand() rather than with their own thresholds, so a
    // card can never disagree with the cell colours below it.
    const counts: Record<AllocationBand, number> = { over: 0, optimal: 0, under: 0 };
    for (const emp of byEmployee) {
      counts[allocationBand(totalPctForWeek(emp.rows, today))]++;
    }
    return { total: byEmployee.length, ...counts };
  }, [byEmployee, today]);

  const forecastData = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const { start, end } = getPeriodBounds(forecastPeriod, now, customRange);
    const workDays = countWorkDays(start, end);
    const capPerPerson = workDays * 8;

    // Merge consultantRoster so team targets include all consultants, not just those with allocations
    const allocatedNames = new Set(byEmployee.map(e => e.name));
    const rosterExtras = consultantRoster
      .filter(r => !allocatedNames.has(r.name))
      .map(r => ({ employeeId: r.employeeId, name: r.name, rows: [] as NSAllocation[], rosterTargetUtil: r.targetUtilization }));
    type EmpEntry = typeof byEmployee[0] | typeof rosterExtras[0];
    const allEntries: EmpEntry[] = [...byEmployee, ...rosterExtras];

    const rows = allEntries.map(emp => {
      const rosterTgt = "rosterTargetUtil" in emp ? emp.rosterTargetUtil : undefined;
      const targetUtil = rosterTgt ?? emp.rows.find(a => a.targetUtilization != null)?.targetUtilization ?? 0.75;
      // All three classifications come from the NetSuite project record via /api/resources
      // (custentity_ceba_is_billable / isutilizedtime / isproductivetime) — not from jobtype.
      const billable = emp.rows
        .filter(a => a.classifyAsBillable === true)
        .reduce((s, a) => s + hoursInRange(a, start, end), 0);
      const utilized = emp.rows
        .filter(a => a.classifyAsUtilized === true)
        .reduce((s, a) => s + hoursInRange(a, start, end), 0);
      const productive = emp.rows
        .filter(a => a.classifyAsProductive === true)
        .reduce((s, a) => s + hoursInRange(a, start, end), 0);
      const totalAllocated = emp.rows.reduce((s, a) => s + hoursInRange(a, start, end), 0);
      const billableTarget = targetUtil * FORECAST_BILL_RATIO * capPerPerson;
      const utilizedTarget = targetUtil * capPerPerson;
      const billablePct    = capPerPerson > 0 ? billable / capPerPerson : 0;
      const utilizedPct    = capPerPerson > 0 ? utilized / capPerPerson : 0;
      const billableTgtPct = targetUtil * FORECAST_BILL_RATIO;
      const utilizedTgtPct = targetUtil;
      const billableRAG = ragFromGap(billable - billableTarget);
      const utilizedRAG = ragFromGap(utilized - utilizedTarget);

      // Per-project breakdown for expandable rows
      const projMap = new Map<number, { projectId: number; name: string; companyName: string; type: string; hours: number; classifyAsBillable: boolean; classifyAsUtilized: boolean; classifyAsProductive: boolean }>();
      for (const a of emp.rows) {
        const h = hoursInRange(a, start, end);
        if (h === 0) continue;
        if (!projMap.has(a.projectId)) {
          projMap.set(a.projectId, {
            projectId:          a.projectId,
            name:               a.projectName,
            companyName:        a.companyName ?? "",
            type:               a.projectType ?? "Internal",
            hours:              0,
            classifyAsBillable:   a.classifyAsBillable   === true,
            classifyAsUtilized:   a.classifyAsUtilized   === true,
            classifyAsProductive: a.classifyAsProductive === true,
          });
        }
        projMap.get(a.projectId)!.hours += h;
      }
      const breakdown = Array.from(projMap.values()).sort((a, b) => b.hours - a.hours);

      const productivePct = capPerPerson > 0 ? productive / capPerPerson : 0;

      return {
        name: emp.name, cap: capPerPerson, workDays,
        billable, utilized, productive, bench: capPerPerson - totalAllocated,
        billableTarget, utilizedTarget,
        billablePct, utilizedPct, productivePct,
        billableTgtPct, utilizedTgtPct,
        billableGap: billable - billableTarget,
        utilizedGap: utilized - utilizedTarget,
        billableRAG, utilizedRAG, targetUtil, breakdown,
      };
    });

    const teamCap            = rows.reduce((s, r) => s + r.cap, 0);
    const teamBillable       = rows.reduce((s, r) => s + r.billable, 0);
    const teamUtilized       = rows.reduce((s, r) => s + r.utilized, 0);
    const teamProductive     = rows.reduce((s, r) => s + r.productive, 0);
    const teamBillableTarget = rows.reduce((s, r) => s + r.billableTarget, 0);
    const teamUtilizedTarget = rows.reduce((s, r) => s + r.utilizedTarget, 0);
    const teamBillablePct    = teamCap > 0 ? teamBillable / teamCap : 0;
    const teamUtilizedPct    = teamCap > 0 ? teamUtilized / teamCap : 0;
    const teamProductivePct  = teamCap > 0 ? teamProductive / teamCap : 0;
    const teamBillableTgtPct = teamCap > 0 ? teamBillableTarget / teamCap : 0;
    const teamUtilizedTgtPct = teamCap > 0 ? teamUtilizedTarget / teamCap : 0;
    return {
      rows, workDays, capPerPerson,
      teamCap, teamBillable, teamUtilized, teamProductive,
      teamBench: rows.reduce((s, r) => s + r.bench, 0),
      teamBillableTarget, teamUtilizedTarget,
      teamBillablePct, teamUtilizedPct, teamProductivePct,
      teamBillableTgtPct, teamUtilizedTgtPct,
      teamBillableRAG: ragFromGap(teamBillable - teamBillableTarget),
      teamUtilizedRAG: ragFromGap(teamUtilized - teamUtilizedTarget),
    };
  }, [byEmployee, forecastPeriod, customRange, consultantRoster]);

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleProject(id: string) {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (savingRef.current || !editingCell) return;
    const newHrs = parseFloat(editValue);
    if (isNaN(newHrs) || newHrs <= 0) { setEditingCell(null); return; }

    savingRef.current = true;
    const cell    = editingCell;
    const saveKey = cell.allocationId ?? `${cell.employeeId}-${cell.projectId}-${cell.weekMs}`;
    setEditingCell(null);
    setSavingId(saveKey);

    const fmt = (d: Date) => d.toISOString().split("T")[0];

    // Helper — POST a new allocation record, returns its new NS id
    async function createAlloc(startDate: string, endDate: string, weeklyHrs: number): Promise<string> {
      const res = await fetch("/api/resources", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ employeeId: cell.employeeId, projectId: cell.projectId, startDate, endDate, weeklyHours: weeklyHrs }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `Create failed (${res.status})`);
      }
      return ((await res.json()) as { id: string }).id;
    }

    // Helper — PATCH an existing allocation record
    async function patchAlloc(id: string, fields: { percentOfTime?: number; startDate?: string; endDate?: string }) {
      const res = await fetch(`/api/resources/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(fields),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `Patch failed (${res.status})`);
      }
    }

    try {
      if (!cell.allocationId) {
        // ── CREATE new allocation (empty cell clicked) ───────────────────
        const weekStart = new Date(cell.weekMs);
        const weekEnd   = new Date(cell.weekMs);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const newId = await createAlloc(fmt(weekStart), fmt(weekEnd), newHrs);
        const sibling = localAllocs.find(a => a.projectId === cell.projectId);
        const newAlloc: NSAllocation = {
          id:             newId,
          employeeId:     cell.employeeId,
          employeeName:   cell.employeeName,
          projectId:      cell.projectId,
          projectName:    cell.projectName,
          projectType:    cell.projectType ?? "Internal",
          startDate:      fmt(weekStart),
          endDate:        fmt(weekEnd),
          allocationUnit: "P",
          percentOfMax:   (newHrs / 40) * 100,
          hoursPerDay:    0,
          companyName:    cell.companyName ?? "",
          // The note is a property of the project, so take it from a sibling row rather
          // than nulling it — otherwise adding an allocation to project 419 would drop
          // its note off the row until the next refresh.
          resourceNote:   sibling?.resourceNote ?? null,
          remainingHours: cell.remainingHours,
          budgetHours:    cell.budgetHours,
          // Adding an allocation logs no time, so the project's hours and its
          // fixed-fee status are unchanged — take them from a sibling row rather
          // than defaulting, so the new row can't disagree with its own project.
          billableHours:  sibling?.billableHours ?? 0,
          actualHours:    sibling?.actualHours   ?? 0,
          consumedHours:  sibling?.consumedHours ?? 0,
          isFixedFee:     sibling?.isFixedFee    ?? false,
          classifyAsBillable:   cell.classifyAsBillable,
          classifyAsUtilized:   cell.classifyAsUtilized,
          classifyAsProductive: cell.classifyAsProductive,
        };
        setLocalAllocs(prev => [...prev, newAlloc]);

      } else {
        // ── EDIT existing allocation — split to preserve other weeks ─────
        const orig       = localAllocs.find(x => x.id === cell.allocationId)!;
        const allocStart = parseNSDate(orig.startDate)!;
        const allocEnd   = parseNSDate(orig.endDate)!;

        const weekStart = new Date(cell.weekMs);
        const weekEnd   = new Date(cell.weekMs);
        weekEnd.setDate(weekEnd.getDate() + 6);

        // Clip new allocation to the actual allocation bounds (handles partial weeks)
        const newStart = allocStart > weekStart ? allocStart : weekStart;
        const newEnd   = allocEnd   < weekEnd   ? allocEnd   : weekEnd;

        // Convert entered hours to weekly rate (pro-rated for partial weeks)
        const wDays      = countWorkDays(newStart, newEnd);
        const dailyHrs   = wDays > 0 ? newHrs / wDays : newHrs / 5;
        const newWeeklyH = dailyHrs * 5;
        const newPct     = (newWeeklyH / 40) * 100;

        const origWeeklyH = orig.percentOfMax / 100 * 40;

        const dayBefore = new Date(weekStart); dayBefore.setDate(dayBefore.getDate() - 1);
        const dayAfter  = new Date(weekEnd);   dayAfter.setDate(dayAfter.getDate() + 1);

        const hasBefore = allocStart < weekStart;
        const hasAfter  = allocEnd   > weekEnd;

        // Accumulate state changes, apply atomically at the end
        let nextAllocs = [...localAllocs];

        if (!hasBefore && !hasAfter) {
          // ── Case 1: allocation IS this week — just update the rate ──────
          await patchAlloc(cell.allocationId, { percentOfTime: newPct });
          nextAllocs = nextAllocs.map(x =>
            x.id === cell.allocationId ? { ...x, percentOfMax: newPct } : x,
          );

        } else if (hasBefore && !hasAfter) {
          // ── Case 2: allocation ends this week (or before) ───────────────
          // POST new allocation for this week at new rate FIRST
          const newId = await createAlloc(fmt(newStart), fmt(newEnd), newWeeklyH);
          nextAllocs.push({ ...orig, id: newId, startDate: fmt(newStart), endDate: fmt(newEnd), percentOfMax: newPct });
          // Then trim existing to end before this week
          await patchAlloc(cell.allocationId, { endDate: fmt(dayBefore) });
          nextAllocs = nextAllocs.map(x =>
            x.id === cell.allocationId ? { ...x, endDate: fmt(dayBefore) } : x,
          );

        } else if (!hasBefore && hasAfter) {
          // ── Case 3: allocation starts this week ─────────────────────────
          // POST new for this week at new rate FIRST
          const newId = await createAlloc(fmt(newStart), fmt(newEnd), newWeeklyH);
          nextAllocs.push({ ...orig, id: newId, startDate: fmt(newStart), endDate: fmt(newEnd), percentOfMax: newPct });
          // Then shift existing to start after this week (preserves original rate)
          await patchAlloc(cell.allocationId, { startDate: fmt(dayAfter) });
          nextAllocs = nextAllocs.map(x =>
            x.id === cell.allocationId ? { ...x, startDate: fmt(dayAfter) } : x,
          );

        } else {
          // ── Case 4: week is in the middle — three-way split ─────────────
          // POST new for this week at new rate
          const newId1 = await createAlloc(fmt(newStart), fmt(newEnd), newWeeklyH);
          nextAllocs.push({ ...orig, id: newId1, startDate: fmt(newStart), endDate: fmt(newEnd), percentOfMax: newPct });
          // POST new for the "after" period at original rate
          const newId2 = await createAlloc(fmt(dayAfter), fmt(allocEnd), origWeeklyH);
          nextAllocs.push({ ...orig, id: newId2, startDate: fmt(dayAfter), endDate: fmt(allocEnd), percentOfMax: orig.percentOfMax });
          // Trim existing to end before this week
          await patchAlloc(cell.allocationId, { endDate: fmt(dayBefore) });
          nextAllocs = nextAllocs.map(x =>
            x.id === cell.allocationId ? { ...x, endDate: fmt(dayBefore) } : x,
          );
        }

        setLocalAllocs(nextAllocs);
      }
    } catch (err) {
      setCellError({ id: saveKey, msg: err instanceof Error ? err.message : "Failed" });
      setTimeout(() => setCellError(null), 5000);
    } finally {
      setSavingId(null);
      savingRef.current = false;
    }
  }

  // ── Empty / error states ──────────────────────────────────────────────────

  if (error && allocations.length === 0) {
    return (
      <div style={{ padding: "24px", background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, color: C.red, fontSize: 13 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Could not load resource allocations from NetSuite.</div>
        <div style={{ fontFamily: C.mono, fontSize: 11, wordBreak: "break-all" }}>{error}</div>
      </div>
    );
  }

  if (allocations.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
        No active resource allocations found. Allocations are sourced from the NetSuite Resource Allocation table.
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: C.font, color: C.text }}>

      {/* ═══ Sub-tab nav ═══════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
        {(["allocation", "forecast"] as SubTab[]).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            style={{
              padding: "8px 22px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: "none",
              border: "none",
              borderBottom: subTab === t ? `2px solid ${C.blue}` : "2px solid transparent",
              color: subTab === t ? C.blue : C.textSub,
              marginBottom: -1,
              fontFamily: C.font,
              transition: "all 0.15s",
            }}
          >
            {t === "allocation" ? "📊 Allocation" : "📈 Forecast"}
          </button>
        ))}
      </div>

      {subTab === "allocation" && (<>

      {/* ═══ SECTION 1: Resource View ═══════════════════════════════════════ */}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Resource Allocation</div>
        <div style={{ fontSize: 12, color: C.textSub }}>
          Weekly allocation by resource from NetSuite. Expand a row to see per-project breakdown.
        </div>
      </div>

      {/* KPI bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total Resources", value: kpis.total, color: C.blue, bg: C.blueBg, bd: C.blueBd },
          // One card per band, labelled and coloured from BAND_STYLE. A band with a
          // count of zero greys out — including Optimal, which should read as "nobody
          // is in the sweet spot" rather than as a healthy green nought.
          ...BAND_ORDER.map(b => {
            const s = BAND_STYLE[b];
            const n = kpis[b];
            return {
              label: s.label,
              value: n,
              color: n > 0 ? s.color : C.textSub,
              bg:    n > 0 ? s.bg    : C.alt,
              bd:    n > 0 ? s.bd    : C.border,
            };
          }),
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.bd}`, borderRadius: 8, padding: "12px 16px", boxShadow: C.sh, flex: "1 1 0", minWidth: 120 }}>
            <div style={{ fontFamily: C.mono, fontSize: 24, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: C.textMid, fontWeight: 500, marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.textSub, fontWeight: 600 }}>Allocation %:</span>
        {BAND_ORDER.map(b => (
          <span key={b} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: BAND_STYLE[b].bg, color: BAND_STYLE[b].color }}>
            {BAND_STYLE[b].label}
          </span>
        ))}
      </div>

      {/* Metric legend — the four rows inside each week cell */}
      <div style={{ display: "flex", gap: 14, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.textSub, fontWeight: 600 }}>Each cell:</span>
        {[
          { k: "Bill", label: "Billable",   color: C.text,    note: "custentity_ceba_is_billable" },
          { k: "Util", label: "Utilized",   color: C.blue,    note: "isutilizedtime" },
          { k: "Prod", label: "Productive", color: C.teal,    note: "isproductivetime" },
          { k: "Tot",  label: "Total allocated", color: C.textMid, note: "all allocations" },
        ].map(m => (
          <span key={m.k} style={{ fontSize: 10, color: C.textMid, display: "flex", alignItems: "center", gap: 5 }} title={`NetSuite project field: ${m.note}`}>
            <span style={{ fontFamily: C.mono, fontWeight: 700, color: m.color, background: C.alt, border: `1px solid ${C.border}`, borderRadius: 3, padding: "1px 5px" }}>{m.k}</span>
            {m.label}
          </span>
        ))}
        <span style={{ fontSize: 10, color: C.textSub }}>
          % of a 40h week · classifications read from the NetSuite project record
        </span>
      </div>

      {/* Resource grid */}
      <div style={{ overflowX: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: C.sh }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 200, paddingLeft: 14, ...stickyLeft, background: C.alt }}>
                Resource
              </th>
              {weeks.map(w => (
                <th key={w.toISOString()} style={{
                  ...thStyle,
                  minWidth: 94,   // fits the Bill/Util/Prod/Tot stack without wrapping
                  background:   w.getTime() === todayMs ? "#EBF5FF" : C.alt,
                  color:        w.getTime() === todayMs ? C.blue    : C.textSub,
                  borderBottom: w.getTime() === todayMs ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
                }}>
                  {fmtWeekHeader(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byEmployee.map((emp, ei) => {
              const isExp    = expanded.has(emp.name);
              const rowBg    = ei % 2 === 0 ? C.surface : C.alt;
              const weekPcts = weeks.map(w => totalPctForWeek(emp.rows, w));

              return (
                <>
                  <tr key={emp.name} style={{ background: rowBg, cursor: "pointer" }} onClick={() => toggleExpand(emp.name)}>
                    <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: C.text, borderBottom: isExp ? "none" : `1px solid ${C.border}`, whiteSpace: "nowrap", ...stickyLeft, background: rowBg }}>
                      <span style={{ marginRight: 6, fontSize: 10, color: C.textSub }}>{isExp ? "▼" : "▶"}</span>
                      {emp.name}
                    </td>
                    {weeks.map((w, wi) => {
                      const pct = weekPcts[wi];
                      // Billable / Utilized / Productive all come from the NetSuite project
                      // record (custentity_ceba_is_billable / isutilizedtime / isproductivetime)
                      // via /api/resources. Never derive them from jobtype or projectType —
                      // several Implementation projects are non-billable, and internal projects
                      // like Training/Certification are Productive but not Utilized.
                      const hrsWhere = (pred: (a: NSAllocation) => boolean) =>
                        emp.rows.filter(pred).reduce((s, a) => s + hoursForWeek(a, w), 0);

                      const billPct = Math.round((hrsWhere(a => a.classifyAsBillable   === true) / 40) * 100);
                      const utilPct = Math.round((hrsWhere(a => a.classifyAsUtilized    === true) / 40) * 100);
                      const prodPct = Math.round((hrsWhere(a => a.classifyAsProductive  === true) / 40) * 100);
                      const totPct  = Math.round(pct);

                      // Sub-metric row. Rendered even at 0% so every cell is the same
                      // height and the grid stays scannable column-to-column.
                      const sub = (label: string, value: number, color: string) => (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 9, color: C.textSub, width: 22, textAlign: "right", fontFamily: C.font }}>{label}</span>
                          <span style={{ fontSize: 11, fontFamily: C.mono, color: value > 0 ? color : C.mid, padding: "1px 6px" }}>{value}%</span>
                        </div>
                      );

                      return (
                        <td key={wi} style={{ padding: "5px 8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                          {pct > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              {/* Billable — top, bold, RAG-coloured against the allocation bands */}
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ fontSize: 9, color: C.textSub, width: 22, textAlign: "right", fontFamily: C.font }}>Bill</span>
                                <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 4, fontSize: 12, fontFamily: C.mono, fontWeight: 700, ...pctCellStyle(billPct) }}>
                                  {billPct}%
                                </span>
                              </div>
                              {sub("Util", utilPct, C.blue)}
                              {sub("Prod", prodPct, C.teal)}
                              {/* Total — bottom, with divider */}
                              <div style={{ display: "flex", alignItems: "center", gap: 4, borderTop: `1px solid ${C.border}`, paddingTop: 2, marginTop: 1 }}>
                                <span style={{ fontSize: 9, color: C.textSub, width: 22, textAlign: "right", fontFamily: C.font }}>Tot</span>
                                <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textMid, fontWeight: 600, padding: "2px 6px" }}>{totPct}%</span>
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: C.mid, fontSize: 11 }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {isExp && (() => {
                    const grouped = groupByProjectGroup(emp.rows, a => a.projectType);
                    const rowBgSub = ei % 2 === 0 ? "#F7FAFF" : "#F0F4F8";
                    const empTotalHrs = weeks.reduce((s, w) => s + emp.rows.reduce((r, a) => r + hoursForWeek(a, w), 0), 0);
                    return GROUP_ORDER.filter(t => grouped[t]?.length).flatMap(t => {
                      const style = GROUP_STYLE[t];
                      const catTotalHrs = weeks.reduce((s, w) => s + grouped[t]!.reduce((r, a) => r + hoursForWeek(a, w), 0), 0);
                      const catPct = empTotalHrs > 0 ? Math.round((catTotalHrs / empTotalHrs) * 100) : 0;
                      return [
                        <tr key={`${emp.name}-type-${t}`}>
                          <td colSpan={weeks.length + 1} style={{ padding: "4px 14px 4px 20px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `1px solid ${style.bd}`, ...stickyLeft }}>
                            {t}
                            <span style={{ marginLeft: 8, fontFamily: C.mono, fontSize: 10, opacity: 0.75 }}>{catPct}%</span>
                          </td>
                        </tr>,
                        ...(() => {
                          const byProj = new Map<number, { allocs: NSAllocation[]; name: string; companyName: string; type: string }>();
                          for (const a of grouped[t]!) {
                            if (!byProj.has(a.projectId)) byProj.set(a.projectId, { allocs: [], name: a.projectName, companyName: a.companyName ?? "", type: a.projectType });
                            byProj.get(a.projectId)!.allocs.push(a);
                          }
                          const chipsFor = (allocs: NSAllocation[]) => ({
                            billable:   allocs.some(a => a.classifyAsBillable   === true),
                            utilized:   allocs.some(a => a.classifyAsUtilized    === true),
                            productive: allocs.some(a => a.classifyAsProductive  === true),
                          });
                          // Sorted by sub-type so projects of the same NetSuite type sit together
                          // inside the band, without adding another level of header rows here.
                          return Array.from(byProj.values())
                            .sort((x, y) => compareProjectTypes(projectTypeLabel(x.type), projectTypeLabel(y.type)) || x.name.localeCompare(y.name))
                            .map(({ allocs, name, companyName, type }) => {
                            const tint = projectTypeTint(type);
                            return (
                            <tr key={`${emp.name}-${t}-${allocs[0].projectId}`} style={{ background: rowBgSub }}>
                              <td style={{ padding: "7px 14px 7px 36px", fontSize: 11, color: C.textMid, borderBottom: `1px solid ${C.border}`, maxWidth: 440, ...stickyLeft, background: rowBgSub }} title={companyName ? `${companyName} — ${name}` : name}>
                                {/* Title line keeps the single-line clipping; the note sits
                                    below it so a long project name can't push it out of view. */}
                                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  <span style={{ color: C.mid, marginRight: 6 }}>└</span>
                                  <span
                                    style={{ display: "inline-block", padding: "0 5px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: tint.bg, color: tint.color, border: `1px solid ${tint.bd}`, marginRight: 6 }}
                                    title={projectTypeLabel(type)}
                                  >
                                    {projectTypeShort(type)}
                                  </span>
                                  <span style={{ marginRight: 7 }}>
                                    <ClassChips {...chipsFor(allocs)} size={13} />
                                  </span>
                                  {companyName && <span style={{ fontWeight: 400, color: C.textSub, marginRight: 4 }}>{companyName} —</span>}
                                  {name}
                                </div>
                                <NoteLine note={resourceNoteOf(allocs)} />
                              </td>
                              {weeks.map((w, wi) => {
                                const hrs = allocs.reduce((s, a) => s + hoursForWeek(a, w), 0);
                                return (
                                  <td key={wi} style={{ padding: "6px 8px", textAlign: "center", fontSize: 11, fontFamily: C.mono, borderBottom: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}`, color: hrs > 0 ? C.textMid : C.mid, fontWeight: hrs > 0 ? 500 : 400 }}>
                                    {hrs > 0 ? hrs.toFixed(1) : <span style={{ color: C.mid }}>—</span>}
                                  </td>
                                );
                              })}
                            </tr>
                            );
                          });
                        })(),
                        <tr key={`${emp.name}-type-${t}-total`}>
                          <td style={{ padding: "4px 14px 4px 20px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `1px solid ${style.bd}`, ...stickyLeft }}>
                            {t} Total
                          </td>
                          {weeks.map((w, wi) => {
                            const total = grouped[t]!.reduce((s, a) => s + hoursForWeek(a, w), 0);
                            const weekPct = Math.round((total / 40) * 100);
                            return (
                              <td key={wi} style={{ padding: "4px 8px", textAlign: "center", fontSize: 10, fontFamily: C.mono, fontWeight: 600, background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `1px solid ${style.bd}`, borderLeft: `1px solid ${style.bd}` }}>
                                {total > 0 ? (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    <span style={{ fontSize: 10 }}>{total.toFixed(1)}h</span>
                                    <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 4, fontSize: 11, fontFamily: C.mono, fontWeight: 700, ...(t === "Internal" ? { background: C.alt, color: C.textSub, border: `1px solid ${C.border}` } : pctCellStyle(weekPct)) }}>
                                      {weekPct}%
                                    </span>
                                    {t === "Customer Projects" && (() => {
                                      const gap = CUSTOMER_WEEK_FLOOR - total;
                                      return gap > 0 ? (
                                        <span style={{ fontFamily: C.mono, fontSize: 9, fontWeight: 600, color: C.red }}>Need {gap.toFixed(1)}h</span>
                                      ) : (
                                        <span style={{ fontFamily: C.mono, fontSize: 9, fontWeight: 600, color: C.green }}>+{Math.abs(gap).toFixed(1)}h over</span>
                                      );
                                    })()}
                                  </div>
                                ) : t === "Customer Projects" ? (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    <span style={{ opacity: 0.35 }}>—</span>
                                    <span style={{ fontFamily: C.mono, fontSize: 9, fontWeight: 600, color: C.red }}>Need {CUSTOMER_WEEK_FLOOR}h</span>
                                  </div>
                                ) : <span style={{ opacity: 0.35 }}>—</span>}
                              </td>
                            );
                          })}
                        </tr>,
                      ];
                    });
                  })()}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: C.textSub }}>
        Showing {weeks.length} weeks from current week. Hours per week = allocation % × 40h.
      </div>

      {/* ═══ SECTION 2: Project Budget vs Allocation ════════════════════════ */}

      <div style={{ marginTop: 40, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Project Budget vs Allocation</div>
        <div style={{ fontSize: 12, color: C.textSub }}>
          Compare remaining budget against forward resource commitments. Expand a project to see per-resource breakdown and edit allocations. Click a week cell to update hours.
        </div>
      </div>

      {/* Budget grid legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.textSub, fontWeight: 600 }}>Gap (Budget − Allocated):</span>
        {[
          { label: ">10h surplus",  bg: C.greenBg,  color: C.green  },
          { label: "0–10h tight",   bg: C.yellowBg, color: C.yellow },
          { label: "< 0h over",     bg: C.redBg,    color: C.red    },
        ].map(l => (
          <span key={l.label} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: l.bg, color: l.color }}>
            {l.label}
          </span>
        ))}
        <span style={{ fontSize: 10, color: C.textSub, marginLeft: 8 }}>
          Double-click a cell to edit • Enter to save • Esc to cancel
        </span>
      </div>

      {/* Classification column legend */}
      <div style={{ display: "flex", gap: 14, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.textSub, fontWeight: 600 }}>Class column:</span>
        {[
          { k: "B", label: "Billable",   color: C.green, note: "custentity_ceba_is_billable" },
          { k: "U", label: "Utilized",   color: C.blue,  note: "isutilizedtime" },
          { k: "P", label: "Productive", color: C.teal,  note: "isproductivetime" },
        ].map(m => (
          <span key={m.k} style={{ fontSize: 10, color: C.textMid, display: "flex", alignItems: "center", gap: 5 }} title={`NetSuite project field: ${m.note}`}>
            <span style={{ fontFamily: C.mono, fontSize: 9, fontWeight: 700, width: 14, height: 14, lineHeight: "14px", textAlign: "center", borderRadius: 3, background: m.color, color: "#fff", border: `1px solid ${m.color}` }}>{m.k}</span>
            {m.label}
          </span>
        ))}
        <span style={{ fontSize: 10, color: C.textSub }}>
          Filled = set on the NetSuite project · greyed = not set
        </span>
      </div>

      <div style={{ overflowX: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: C.sh }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 220, paddingLeft: 14, ...stickyLeft, background: C.alt }}>
                Project / Resource
              </th>
              <th style={{ ...thStyle, minWidth: 74 }} title="Billable / Utilized / Productive — from the NetSuite project record">
                Class
              </th>
              <th style={{ ...thStyle, minWidth: 90 }} title="Budgeted hours on the NetSuite project (custentity_ceba_project_budget_hours)">Orig. Budget</th>
              <th style={{ ...thStyle, minWidth: 90 }} title="Original budget minus time logged, calculated from time entries rather than custentity_project_remaining_hours. Time & materials projects count billable time only (timetype='A', isbillable='T'); fixed-fee projects (FF) count ALL actual time, because their entries are logged non-billable by design.">Rem. Budget</th>
              <th style={{ ...thStyle, minWidth: 90 }}>Allocated</th>
              <th style={{ ...thStyle, minWidth: 80 }}>Gap</th>
              {weeks.map(w => (
                <th key={w.toISOString()} style={{
                  ...thStyle,
                  minWidth: 70,
                  background:   w.getTime() === todayMs ? "#EBF5FF" : C.alt,
                  color:        w.getTime() === todayMs ? C.blue    : C.textSub,
                  borderBottom: w.getTime() === todayMs ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
                }}>
                  {fmtWeekHeader(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const grouped = groupByProjectGroup(byProject, p => p.projectType);
              return GROUP_ORDER.filter(t => (grouped[t]?.length ?? 0) > 0).flatMap(t => {
                const style = GROUP_STYLE[t];
                // Pre-compute group totals for the summary row
                const grpBudget     = grouped[t]!.some(p => p.budgetHours != null)    ? grouped[t]!.reduce((s, p) => s + (p.budgetHours    ?? 0), 0) : null;
                const grpRemaining  = grouped[t]!.some(p => p.remainingHours != null) ? grouped[t]!.reduce((s, p) => s + (p.remainingHours ?? 0), 0) : null;
                const grpAllocated  = grouped[t]!.reduce((s, p) => s + p.rows.reduce((rs, a) => rs + estimatedFutureHours(a, today), 0), 0);
                const grpGap        = grpRemaining != null ? grpRemaining - grpAllocated : null;
                const grpWeekTotals = weeks.map(w => grouped[t]!.reduce((s, p) => s + p.rows.reduce((rs, a) => rs + hoursForWeek(a, w), 0), 0));

                // Billable hours per week for this group, read off the project's
                // custentity_ceba_is_billable flag. Kept separate from grpWeekTotals
                // because the target below is a BILLABLE target — comparing it against
                // total allocated hours overstates attainment for any group that mixes
                // billable and non-billable projects.
                const grpWeekBillable = weeks.map(w =>
                  grouped[t]!.reduce((s, p) => s + p.rows.reduce(
                    (rs, a) => rs + (a.classifyAsBillable === true ? hoursForWeek(a, w) : 0), 0), 0));

                // Per-week billable target = Σ (targetUtil × 0.87 × 40) over each unique
                // employee allocated to a BILLABLE project that week. Previously this was
                // gated on the group being "Implementation", which disagreed with NetSuite:
                // some Implementation projects are flagged non-billable, and non-standard
                // types (e.g. Managed Services Agreement) are billable.
                const BILL_RATIO = 0.87;
                const grpHasBillable = grouped[t]!.some(p => p.rows.some(a => a.classifyAsBillable === true));
                const grpWeekTargets = grpHasBillable ? weeks.map(w => {
                  const seenEmps = new Map<number, number>(); // empId → targetUtilization
                  for (const proj of grouped[t]!) {
                    for (const a of proj.rows) {
                      if (a.classifyAsBillable !== true) continue;
                      if (allocCoversWeek(a, w) && !seenEmps.has(a.employeeId)) {
                        seenEmps.set(a.employeeId, a.targetUtilization ?? 0.75);
                      }
                    }
                  }
                  return Array.from(seenEmps.values()).reduce((s, tu) => s + tu * BILL_RATIO * 40, 0);
                }) : null;
                // Sub-groups by NetSuite jobtype. Only headed when the band actually has
                // more than one type — a single-type band needs no extra header row.
                const subGroups     = subGroupsByType(grouped[t]!, p => p.projectType);
                const showSubHeaders = subGroups.length > 1;

                return [
                  <tr key={`type-hdr-${t}`}>
                    <td colSpan={weeks.length + 6} style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `1px solid ${style.bd}` }}>
                      {t}
                      <span style={{ marginLeft: 8, fontFamily: C.mono, fontSize: 10, opacity: 0.7 }}>
                        {grouped[t]!.length} project{grouped[t]!.length !== 1 ? "s" : ""}
                      </span>
                      {showSubHeaders && (
                        <span style={{ marginLeft: 8, fontFamily: C.font, fontSize: 10, fontWeight: 500, opacity: 0.65, textTransform: "none", letterSpacing: 0 }}>
                          {subGroups.map(sg => `${sg.label} (${sg.rows.length})`).join(" · ")}
                        </span>
                      )}
                    </td>
                  </tr>,
                  ...subGroups.flatMap(sub => {
                    const subTint = projectTypeTint(sub.rows[0]?.projectType);
                    const subHrs  = sub.rows.reduce((s, p) => s + p.rows.reduce((rs, a) => rs + estimatedFutureHours(a, today), 0), 0);
                    return [
                      ...(showSubHeaders ? [(
                        <tr key={`subtype-hdr-${t}-${sub.label}`}>
                          <td colSpan={weeks.length + 6} style={{ padding: "3px 14px 3px 26px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", background: C.surface, color: subTint.color, borderBottom: `1px solid ${C.border}` }}>
                            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: subTint.color, marginRight: 7, verticalAlign: "middle" }} />
                            {sub.label}
                            <span style={{ marginLeft: 8, fontFamily: C.mono, fontSize: 10, fontWeight: 500, color: C.textSub }}>
                              {sub.rows.length} project{sub.rows.length !== 1 ? "s" : ""} · {subHrs.toFixed(1)}h allocated
                            </span>
                          </td>
                        </tr>
                      )] : []),
                      ...sub.rows.map((proj, pi) => {
              const isExp          = expandedProjects.has(String(proj.projectId));
              const rowBg          = pi % 2 === 0 ? C.surface : C.alt;
              const totalAllocated = proj.rows.reduce((s, a) => s + estimatedFutureHours(a, today), 0);
              const gap            = proj.remainingHours != null ? proj.remainingHours - totalAllocated : null;
              const weekTotals     = weeks.map(w => proj.rows.reduce((s, a) => s + hoursForWeek(a, w), 0));

              // Project-level classification — identical across a project's allocations,
              // so any row is representative.
              const isBillable   = proj.rows.some(a => a.classifyAsBillable   === true);
              const isUtilized   = proj.rows.some(a => a.classifyAsUtilized    === true);
              const isProductive = proj.rows.some(a => a.classifyAsProductive  === true);
              const typeTint     = projectTypeTint(proj.projectType);

              return (
                <>
                  {/* Project row */}
                  <tr key={proj.projectId} style={{ background: rowBg, cursor: "pointer" }} onClick={() => toggleProject(String(proj.projectId))}>
                    <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: C.text, borderBottom: isExp ? "none" : `1px solid ${C.border}`, whiteSpace: "nowrap", ...stickyLeft, background: rowBg }}>
                      <span style={{ marginRight: 6, fontSize: 10, color: C.textSub }}>{isExp ? "▼" : "▶"}</span>
                      {!showSubHeaders && (
                        <span
                          style={{ display: "inline-block", padding: "0 5px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: typeTint.bg, color: typeTint.color, border: `1px solid ${typeTint.bd}`, marginRight: 7, verticalAlign: "middle" }}
                          title={projectTypeLabel(proj.projectType)}
                        >
                          {projectTypeShort(proj.projectType)}
                        </span>
                      )}
                      {proj.companyName && (
                        <span style={{ fontWeight: 400, color: C.textSub, marginRight: 4 }}>{proj.companyName} —</span>
                      )}
                      {proj.name}
                      {/* On the capacity-planning placeholder this is the only thing saying
                          which prospects the held hours are for. */}
                      <NoteChip note={resourceNoteOf(proj.rows)} />
                    </td>

                    {/* Classification — Billable / Utilized / Productive */}
                    <td style={{ padding: "8px 6px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      <ClassChips billable={isBillable} utilized={isUtilized} productive={isProductive} />
                    </td>

                    {/* Orig. Budget */}
                    <td style={{ padding: "8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      {proj.budgetHours != null ? (
                        <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600, color: C.textMid }}>
                          {proj.budgetHours.toFixed(1)}h
                        </span>
                      ) : (
                        <span style={{ color: C.mid, fontSize: 11 }}>—</span>
                      )}
                    </td>

                    {/* Rem. Budget */}
                    <td style={{ padding: "8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      {proj.remainingHours != null ? (
                        <span
                          title={proj.isFixedFee
                            ? `Fixed fee — all actual time counts against budget.
${proj.budgetHours?.toFixed(1)}h budget − ${proj.consumedHours.toFixed(1)}h actual (of which ${proj.billableHours.toFixed(1)}h billable).`
                            : `${proj.budgetHours?.toFixed(1)}h budget − ${proj.consumedHours.toFixed(1)}h billable time logged.`}
                          style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600, color: C.textMid, cursor: "help" }}
                        >
                          {proj.remainingHours.toFixed(1)}h
                          {proj.isFixedFee && (
                            <span style={{ marginLeft: 4, fontFamily: C.font, fontSize: 8.5, fontWeight: 700, padding: "1px 4px", borderRadius: 6, background: C.tealBg, color: C.teal, border: `1px solid ${C.tealBd}`, verticalAlign: "middle" }}>
                              FF
                            </span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: C.mid, fontSize: 11 }}>—</span>
                      )}
                    </td>

                    {/* Allocated */}
                    <td style={{ padding: "8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600, color: C.textMid }}>
                        {totalAllocated.toFixed(1)}h
                      </span>
                    </td>

                    {/* Gap */}
                    <td style={{ padding: "8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      {gap != null ? (
                        <span style={{ fontFamily: C.mono, fontSize: 12, padding: "3px 8px", borderRadius: 4, ...gapStyle(gap), background: gap < -5 ? C.redBg : gap < 10 ? C.yellowBg : C.greenBg, border: `1px solid ${gap < -5 ? C.redBd : gap < 10 ? C.yellowBd : C.greenBd}` }}>
                          {gap >= 0 ? "+" : ""}{gap.toFixed(1)}h
                        </span>
                      ) : (
                        <span style={{ color: C.mid, fontSize: 11 }}>—</span>
                      )}
                    </td>

                    {/* Weekly totals */}
                    {weekTotals.map((hrs, wi) => (
                      <td key={wi} style={{ padding: "6px 8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                        {hrs > 0 ? (
                          <span style={{ fontFamily: C.mono, fontSize: 11, color: C.textMid, fontWeight: 500 }}>
                            {hrs.toFixed(1)}
                          </span>
                        ) : (
                          <span style={{ color: C.mid, fontSize: 11 }}>—</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Resource sub-rows — one row per employee, hours summed across all their allocations */}
                  {isExp && (() => {
                    // Group allocations by employee
                    const empMap = new Map<number, { name: string; allocs: NSAllocation[] }>();
                    for (const a of proj.rows) {
                      if (!empMap.has(a.employeeId)) empMap.set(a.employeeId, { name: a.employeeName, allocs: [] });
                      empMap.get(a.employeeId)!.allocs.push(a);
                    }
                    const employees = Array.from(empMap.values()).sort((a, b) => a.name.localeCompare(b.name));

                    return employees.map((emp, ei) => {
                      const isLast   = ei === employees.length - 1;
                      const subBg    = pi % 2 === 0 ? "#F7FAFF" : "#F0F4F8";
                      const empSaving = emp.allocs.some(a => savingId === a.id) || savingRef.current;
                      const empError  = emp.allocs.find(a => cellError?.id === a.id);

                      return (
                        <tr key={`${proj.projectId}-${emp.name}`} style={{ background: subBg }}>
                          {/* Resource name */}
                          <td style={{ padding: "7px 14px 7px 32px", fontSize: 11, color: C.textMid, borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, whiteSpace: "nowrap", ...stickyLeft, background: subBg }}>
                            <span style={{ color: C.mid, marginRight: 6 }}>└</span>
                            <span style={{ fontWeight: 600 }}>{emp.name}</span>
                            {/* No note chip here — the note belongs to the project, not the
                                resource, and repeating it on every nested row would imply
                                it says something about this consultant specifically. */}
                            {empSaving &&<span style={{ marginLeft: 8, fontSize: 10, color: C.blue }}>saving…</span>}
                            {empError  && <span style={{ marginLeft: 8, fontSize: 10, color: C.red }}>{cellError!.msg}</span>}
                          </td>

                          {/* Class / Orig. Budget / Rem. Budget / Allocated / Gap — empty for sub-rows */}
                          <td style={{ borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, borderLeft: `1px solid ${C.border}` }} />
                          <td style={{ borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, borderLeft: `1px solid ${C.border}` }} />
                          <td style={{ borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, borderLeft: `1px solid ${C.border}` }} />
                          <td style={{ borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, borderLeft: `1px solid ${C.border}` }} />
                          <td style={{ borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, borderLeft: `1px solid ${C.border}` }} />

                          {/* Editable week cells */}
                          {weeks.map((w, wi) => {
                            const wMs = w.getTime();
                            // Find which allocation (if any) covers this week for this employee
                            const coveringAlloc = emp.allocs.find(a => allocCoversWeek(a, w));
                            const hrs           = coveringAlloc ? hoursForWeek(coveringAlloc, w) : 0;
                            const isEditingThis =
                              editingCell !== null &&
                              editingCell.weekMs     === wMs &&
                              editingCell.employeeId === emp.allocs[0].employeeId &&
                              editingCell.projectId  === proj.projectId;

                            const cellContext: CellEdit = {
                              allocationId:   coveringAlloc?.id ?? null,
                              employeeId:     emp.allocs[0].employeeId,
                              employeeName:   emp.name,
                              projectId:      proj.projectId,
                              projectName:    proj.name,
                              projectType:    proj.projectType ?? "Internal",
                              companyName:    proj.companyName ?? "",
                              remainingHours: proj.remainingHours,
                              budgetHours:    proj.budgetHours,
                              weekMs:         wMs,
                              // Project-level flags — identical across every allocation on
                              // the project, so any row is representative.
                              classifyAsBillable:   proj.rows.some(a => a.classifyAsBillable   === true),
                              classifyAsUtilized:   proj.rows.some(a => a.classifyAsUtilized    === true),
                              classifyAsProductive: proj.rows.some(a => a.classifyAsProductive  === true),
                            };

                            return (
                              <td
                                key={wi}
                                title={!empSaving ? (coveringAlloc ? "Click to edit" : "Click to add allocation") : undefined}
                                style={{
                                  padding:      "4px 6px",
                                  textAlign:    "center",
                                  fontSize:     11,
                                  fontFamily:   C.mono,
                                  borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`,
                                  borderLeft:   `1px solid ${C.border}`,
                                  cursor:       !empSaving ? "pointer" : "default",
                                  background:   isEditingThis ? "#EBF5FF" : undefined,
                                  transition:   "background 0.1s",
                                }}
                                onClick={() => {
                                  if (empSaving) return;
                                  setEditingCell(cellContext);
                                  setEditValue(hrs > 0 ? hrs.toFixed(1) : "0");
                                }}
                              >
                                {isEditingThis ? (
                                  <input
                                    autoFocus
                                    type="number"
                                    min={0}
                                    max={40}
                                    step={0.5}
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") { e.preventDefault(); handleSave(); }
                                      if (e.key === "Escape") setEditingCell(null);
                                    }}
                                    onBlur={() => handleSave()}
                                    style={{
                                      width: 50, padding: "2px 4px", fontSize: 11,
                                      fontFamily: C.mono, border: `1.5px solid ${C.blue}`,
                                      borderRadius: 3, textAlign: "center", outline: "none",
                                      background: "#fff",
                                    }}
                                  />
                                ) : coveringAlloc ? (
                                  <span style={{ color: hrs > 0 ? C.textMid : C.mid, fontWeight: hrs > 0 ? 500 : 400 }}>
                                    {hrs > 0 ? hrs.toFixed(1) : "0"}
                                  </span>
                                ) : (
                                  <span style={{ color: C.mid, fontSize: 13, lineHeight: 1 }}>+</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  })()}
                </>
              );
                      }), // end sub.rows.map
                    ];
                  }), // end subGroups.flatMap
                  // ── Group total row ──────────────────────────────────────
                  <tr key={`type-total-${t}`}>
                    <td style={{ padding: "6px 14px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `2px solid ${style.bd}`, ...stickyLeft }}>
                      {t} Total
                    </td>
                    {/* Class — not meaningful for a mixed group */}
                    <td style={{ background: style.bg, borderTop: `1px solid ${style.bd}`, borderBottom: `2px solid ${style.bd}`, borderLeft: `1px solid ${style.bd}` }} />
                    <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: C.mono, fontSize: 11, fontWeight: 700, background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `2px solid ${style.bd}`, borderLeft: `1px solid ${style.bd}` }}>
                      {grpBudget != null ? `${grpBudget.toFixed(1)}h` : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: C.mono, fontSize: 11, fontWeight: 700, background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `2px solid ${style.bd}`, borderLeft: `1px solid ${style.bd}` }}>
                      {grpRemaining != null ? `${grpRemaining.toFixed(1)}h` : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: C.mono, fontSize: 11, fontWeight: 700, background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `2px solid ${style.bd}`, borderLeft: `1px solid ${style.bd}` }}>
                      {grpAllocated.toFixed(1)}h
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center", background: style.bg, borderTop: `1px solid ${style.bd}`, borderBottom: `2px solid ${style.bd}`, borderLeft: `1px solid ${style.bd}` }}>
                      {grpGap != null ? (
                        <span style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, ...gapStyle(grpGap), background: grpGap < -5 ? C.redBg : grpGap < 10 ? C.yellowBg : C.greenBg, border: `1px solid ${grpGap < -5 ? C.redBd : grpGap < 10 ? C.yellowBd : C.greenBd}` }}>
                          {grpGap >= 0 ? "+" : ""}{grpGap.toFixed(1)}h
                        </span>
                      ) : <span style={{ color: style.color, fontFamily: C.mono, fontSize: 11 }}>—</span>}
                    </td>
                    {grpWeekTotals.map((hrs, wi) => {
                      const target   = grpWeekTargets?.[wi] ?? 0;
                      const billable = grpWeekBillable[wi];
                      const showTgt  = target > 0;
                      // RAG compares BILLABLE hours against the billable target — not total
                      // allocated hours, which would count non-billable work toward it.
                      let cellBg    = style.bg;
                      let cellColor = hrs > 0 ? style.color : C.mid;
                      if (showTgt) {
                        const ratio = billable / target;
                        if (ratio < 0.90)       { cellBg = C.redBg;    cellColor = C.red;    }
                        else if (ratio <= 1.10) { cellBg = C.purpleBg; cellColor = C.purple; }
                        else                    { cellBg = C.greenBg;  cellColor = C.green;  }
                      }
                      return (
                        <td key={wi} style={{ padding: "6px 8px", textAlign: "center", fontFamily: C.mono, fontSize: 11, fontWeight: 700, background: cellBg, color: cellColor, borderTop: `1px solid ${style.bd}`, borderBottom: `2px solid ${style.bd}`, borderLeft: `1px solid ${style.bd}` }}
                            title={showTgt ? `${billable.toFixed(1)}h billable of ${hrs.toFixed(1)}h allocated · target ${target.toFixed(1)}h` : `${hrs.toFixed(1)}h allocated`}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                            <span style={hrs > 0 ? undefined : { color: C.mid }}>{hrs > 0 ? hrs.toFixed(1) : "—"}</span>
                            {showTgt && (
                              <span style={{ fontSize: 9, fontWeight: 500, opacity: hrs > 0 ? 0.75 : 0.7, color: hrs > 0 ? undefined : C.red }}>
                                {billable.toFixed(1)} bill / {target.toFixed(1)} tgt
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>,
                ];   // end flatMap return array
              }); // end GROUP_ORDER.flatMap
            })()}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: C.textSub }}>
        Allocated = estimated future hours (today → end date) at current weekly rate. Gap = Remaining Budget − Allocated. Edits write back to NetSuite immediately.
      </div>

      </>)}

      {subTab === "forecast" && (() => {
        const {
          rows, workDays, teamCap, teamBillable, teamUtilized, teamProductive, teamBench,
          teamBillablePct, teamUtilizedPct, teamProductivePct, teamBillableTgtPct, teamUtilizedTgtPct,
          teamBillableRAG, teamUtilizedRAG, teamBillableTarget, teamUtilizedTarget,
        } = forecastData;
        const now = new Date();

        const ragColor = (r: "green" | "yellow" | "red") => r === "green" ? C.green   : r === "yellow" ? C.yellow   : C.red;
        const ragBg    = (r: "green" | "yellow" | "red") => r === "green" ? C.greenBg : r === "yellow" ? C.yellowBg : C.redBg;
        const ragBd    = (r: "green" | "yellow" | "red") => r === "green" ? C.greenBd : r === "yellow" ? C.yellowBd : C.redBd;
        const ragLabel = (r: "green" | "yellow" | "red") => r === "green" ? "On Track" : r === "yellow" ? "At Risk"  : "Behind";

        return (
          <>
            {/* Period filter */}
            <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.textSub, letterSpacing: "0.05em", textTransform: "uppercase", marginRight: 4 }}>Period</span>
              {(Object.keys(PERIOD_LABELS) as ForecastPeriod[]).map(p => (
                <button key={p} onClick={() => setForecastPeriod(p)} style={{
                  padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  borderRadius: 20, border: `1.5px solid ${forecastPeriod === p ? C.blue : C.border}`,
                  background: forecastPeriod === p ? C.blueBg : C.surface,
                  color: forecastPeriod === p ? C.blue : C.textMid,
                  fontFamily: C.font, transition: "all 0.15s",
                }}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}

              {/* Custom range inputs — only while Custom is the active period */}
              {forecastPeriod === "custom" && (() => {
                const s = parseISODate(customRange.start);
                const e = parseISODate(customRange.end);
                const backwards = !!(s && e && e < s);
                const dateInput: React.CSSProperties = {
                  padding: "4px 8px", borderRadius: 7, fontSize: 12, fontFamily: C.font,
                  color: C.text, background: C.surface, outline: "none",
                  border: `1.5px solid ${backwards ? C.redBd : C.border}`,
                };
                return (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                    <input
                      type="date"
                      value={customRange.start}
                      max={customRange.end || undefined}
                      onChange={ev => setCustomRange(r => ({ ...r, start: ev.target.value }))}
                      style={dateInput}
                      aria-label="Forecast range start"
                    />
                    <span style={{ fontSize: 12, color: C.textSub }}>→</span>
                    <input
                      type="date"
                      value={customRange.end}
                      min={customRange.start || undefined}
                      onChange={ev => setCustomRange(r => ({ ...r, end: ev.target.value }))}
                      style={dateInput}
                      aria-label="Forecast range end"
                    />
                    <button
                      onClick={() => setCustomRange(defaultCustomRange(new Date()))}
                      title="Reset to the next four weeks"
                      style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", borderRadius: 7, border: `1px solid ${C.border}`, background: C.alt, color: C.textMid, fontFamily: C.font }}
                    >
                      Reset
                    </button>
                    {backwards && (
                      <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>
                        End is before start — showing {fmtDateShort(s!)} only
                      </span>
                    )}
                    {(!s || !e) && (
                      <span style={{ fontSize: 11, color: C.textSub }}>
                        Pick both dates — showing this week meanwhile
                      </span>
                    )}
                    {!backwards && s && e && (e.getTime() - s.getTime()) / 86400000 > MAX_CUSTOM_DAYS && (
                      <span style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>
                        Range capped at {MAX_CUSTOM_DAYS} days — check the end date
                      </span>
                    )}
                  </span>
                );
              })()}

              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 8, fontStyle: "italic" }}>
                {getPeriodDisplayLabel(forecastPeriod, now, customRange)}
                {" · "}{workDays} working day{workDays !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Team KPI cards */}
            <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
              {/* Capacity */}
              <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "14px 18px", boxShadow: C.sh, flex: "1 1 0", minWidth: 150 }}>
                <div style={{ fontFamily: C.mono, fontSize: 24, fontWeight: 700, color: C.blue, lineHeight: 1 }}>{teamCap.toFixed(0)}h</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginTop: 4 }}>Team Capacity</div>
                <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{workDays}d × {rows.length} people × 8h</div>
              </div>
              {/* Billable */}
              <div style={{ background: ragBg(teamBillableRAG), border: `1px solid ${ragBd(teamBillableRAG)}`, borderRadius: 8, padding: "14px 18px", boxShadow: C.sh, flex: "1 1 0", minWidth: 150 }}>
                <div style={{ fontFamily: C.mono, fontSize: 24, fontWeight: 700, color: ragColor(teamBillableRAG), lineHeight: 1 }}>{teamBillable.toFixed(1)}h</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginTop: 4 }}>Billable</div>
                <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{Math.round(teamBillablePct * 100)}% of capacity · target {Math.round(teamBillableTgtPct * 100)}%</div>
                <MiniBar pct={teamBillablePct} tgt={teamBillableTgtPct} color={ragColor(teamBillableRAG)} />
                <div style={{ fontSize: 10, fontFamily: C.mono, color: ragColor(teamBillableRAG), marginTop: 4, fontWeight: 600 }}>
                  {(teamBillable - teamBillableTarget) >= 0 ? `+${(teamBillable - teamBillableTarget).toFixed(1)}h` : `${(teamBillable - teamBillableTarget).toFixed(1)}h`} vs target
                </div>
              </div>
              {/* Utilized */}
              <div style={{ background: ragBg(teamUtilizedRAG), border: `1px solid ${ragBd(teamUtilizedRAG)}`, borderRadius: 8, padding: "14px 18px", boxShadow: C.sh, flex: "1 1 0", minWidth: 150 }}>
                <div style={{ fontFamily: C.mono, fontSize: 24, fontWeight: 700, color: ragColor(teamUtilizedRAG), lineHeight: 1 }}>{teamUtilized.toFixed(1)}h</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginTop: 4 }}>Utilized</div>
                <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{Math.round(teamUtilizedPct * 100)}% of capacity · target {Math.round(teamUtilizedTgtPct * 100)}%</div>
                <MiniBar pct={teamUtilizedPct} tgt={teamUtilizedTgtPct} color={ragColor(teamUtilizedRAG)} />
                <div style={{ fontSize: 10, fontFamily: C.mono, color: ragColor(teamUtilizedRAG), marginTop: 4, fontWeight: 600 }}>
                  {(teamUtilized - teamUtilizedTarget) >= 0 ? `+${(teamUtilized - teamUtilizedTarget).toFixed(1)}h` : `${(teamUtilized - teamUtilizedTarget).toFixed(1)}h`} vs target
                </div>
              </div>
              {/* Productive */}
              <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 18px", boxShadow: C.sh, flex: "1 1 0", minWidth: 150 }}>
                <div style={{ fontFamily: C.mono, fontSize: 24, fontWeight: 700, color: C.textMid, lineHeight: 1 }}>{teamProductive.toFixed(1)}h</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginTop: 4 }}>Productive</div>
                <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{Math.round(teamProductivePct * 100)}% of capacity · classify as productive</div>
                <MiniBar pct={teamProductivePct} tgt={teamUtilizedTgtPct} color={C.textMid} />
              </div>
              {/* Bench */}
              <div style={{ background: teamBench > teamCap * 0.25 ? C.redBg : teamBench > teamCap * 0.1 ? C.yellowBg : C.greenBg, border: `1px solid ${teamBench > teamCap * 0.25 ? C.redBd : teamBench > teamCap * 0.1 ? C.yellowBd : C.greenBd}`, borderRadius: 8, padding: "14px 18px", boxShadow: C.sh, flex: "1 1 0", minWidth: 150 }}>
                <div style={{ fontFamily: C.mono, fontSize: 24, fontWeight: 700, color: teamBench > teamCap * 0.25 ? C.red : teamBench > teamCap * 0.1 ? C.yellow : C.green, lineHeight: 1 }}>{teamBench.toFixed(1)}h</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginTop: 4 }}>Bench</div>
                <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{teamCap > 0 ? Math.round((teamBench / teamCap) * 100) : 0}% unallocated</div>
              </div>
            </div>

            {/* Per-consultant table */}
            <div style={{ overflowX: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: C.sh }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: "left", minWidth: 180, paddingLeft: 14, ...stickyLeft, background: C.alt }}>Consultant</th>
                    <th style={{ ...thStyle, minWidth: 90 }}>Capacity</th>
                    <th style={{ ...thStyle, minWidth: 170 }}>Billable</th>
                    <th style={{ ...thStyle, minWidth: 170 }}>Utilized</th>
                    <th style={{ ...thStyle, minWidth: 100 }}>Productive</th>
                    <th style={{ ...thStyle, minWidth: 90 }}>Bench</th>
                    <th style={{ ...thStyle, minWidth: 100 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const rowBg  = i % 2 === 0 ? C.surface : C.alt;
                    const subBg  = i % 2 === 0 ? "#F7FAFF" : "#F0F4F8";
                    const isExp  = expandedForecastRows.has(r.name);
                    return (
                      <>
                      <tr key={r.name} style={{ background: rowBg, cursor: r.breakdown.length > 0 ? "pointer" : "default" }} onClick={() => r.breakdown.length > 0 && toggleForecastRow(r.name)}>
                        <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: C.text, borderBottom: isExp ? "none" : `1px solid ${C.border}`, ...stickyLeft, background: rowBg }}>
                          {r.breakdown.length > 0 && (
                            <span style={{ marginRight: 6, fontSize: 10, color: C.textSub }}>{isExp ? "▼" : "▶"}</span>
                          )}
                          {r.name}
                          <span style={{ marginLeft: 8, fontSize: 10, fontFamily: C.mono, fontWeight: 500, color: C.textSub, background: C.alt, border: `1px solid ${C.border}`, borderRadius: 3, padding: "1px 5px" }}>
                            {Math.round(r.targetUtil * 100)}% tgt
                          </span>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                          <div style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.blue }}>{r.cap}h</div>
                          <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{r.workDays}d</div>
                        </td>
                        <td style={{ padding: "8px 12px", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 700, color: ragColor(r.billableRAG) }}>{Math.round(r.billablePct * 100)}%</span>
                            <span style={{ fontFamily: C.mono, fontSize: 11, color: ragColor(r.billableRAG), opacity: 0.75 }}>{r.billable.toFixed(1)}h</span>
                          </div>
                          <MiniBar pct={r.billablePct} tgt={r.billableTgtPct} color={ragColor(r.billableRAG)} />
                          <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>
                            target {Math.round(r.billableTgtPct * 100)}%{" · "}
                            <span style={{ color: ragColor(r.billableRAG), fontWeight: 600 }}>
                              {r.billableGap >= 0 ? `+${r.billableGap.toFixed(1)}h` : `${r.billableGap.toFixed(1)}h`}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 700, color: ragColor(r.utilizedRAG) }}>{Math.round(r.utilizedPct * 100)}%</span>
                            <span style={{ fontFamily: C.mono, fontSize: 11, color: ragColor(r.utilizedRAG), opacity: 0.75 }}>{r.utilized.toFixed(1)}h</span>
                          </div>
                          <MiniBar pct={r.utilizedPct} tgt={r.utilizedTgtPct} color={ragColor(r.utilizedRAG)} />
                          <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>
                            target {Math.round(r.utilizedTgtPct * 100)}%{" · "}
                            <span style={{ color: ragColor(r.utilizedRAG), fontWeight: 600 }}>
                              {r.utilizedGap >= 0 ? `+${r.utilizedGap.toFixed(1)}h` : `${r.utilizedGap.toFixed(1)}h`}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                          <div style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.textMid }}>{r.productive.toFixed(1)}h</div>
                          <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{Math.round(r.productivePct * 100)}%</div>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                          <div style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: r.bench > r.cap * 0.25 ? C.red : r.bench > r.cap * 0.1 ? C.yellow : C.textSub }}>
                            {r.bench.toFixed(1)}h
                          </div>
                          <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>
                            {r.cap > 0 ? Math.round((r.bench / r.cap) * 100) : 0}%
                          </div>
                        </td>
                        <td style={{ padding: "10px 8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                          <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: ragBg(r.billableRAG), color: ragColor(r.billableRAG), border: `1px solid ${ragBd(r.billableRAG)}` }}>
                            {ragLabel(r.billableRAG)}
                          </span>
                        </td>
                      </tr>

                      {/* Expandable project breakdown */}
                      {isExp && r.breakdown.map((p, pi) => {
                        const ts  = projectTypeTint(p.type);
                        const isLast = pi === r.breakdown.length - 1;
                        const pct = r.cap > 0 ? p.hours / r.cap : 0;
                        return (
                          <tr key={`${r.name}-${p.projectId}`} style={{ background: subBg }}>
                            <td style={{ padding: "7px 14px 7px 36px", fontSize: 11, color: C.textMid, borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280, ...stickyLeft, background: subBg }}
                                title={p.companyName ? `${p.companyName} — ${p.name}` : p.name}>
                              <span style={{ color: C.mid, marginRight: 6 }}>└</span>
                              {/* NetSuite jobtype; full name in the tooltip. */}
                              <span
                                style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: ts.bg, color: ts.color, border: `1px solid ${ts.bd}`, marginRight: 6 }}
                                title={`${projectGroupOf(p.type)} · NetSuite type: ${projectTypeLabel(p.type)}`}
                              >
                                {projectTypeShort(p.type)}
                              </span>
                              {p.companyName && <span style={{ color: C.textSub, marginRight: 4 }}>{p.companyName} —</span>}
                              {p.name}
                            </td>
                            <td colSpan={2} style={{ padding: "7px 12px", borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, borderLeft: `1px solid ${C.border}` }}>
                              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                                <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: ts.color }}>{p.hours.toFixed(1)}h</span>
                                <span style={{ fontFamily: C.mono, fontSize: 11, color: C.textSub }}>{Math.round(pct * 100)}% of cap</span>
                              </div>
                              <div style={{ position: "relative", height: 4, background: C.border, borderRadius: 2, marginTop: 4, width: "100%" }}>
                                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${Math.min(pct * 100, 100)}%`, background: ts.color, borderRadius: 2, opacity: 0.7 }} />
                              </div>
                            </td>
                            <td colSpan={4} style={{ padding: "7px 12px", borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, borderLeft: `1px solid ${C.border}`, fontSize: 11 }}>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {p.classifyAsBillable
                                  ? <span style={{ color: C.green,   fontWeight: 600 }}>● Billable</span>
                                  : <span style={{ color: C.textSub              }}>○ Non-billable</span>}
                                {p.classifyAsUtilized
                                  ? <span style={{ color: C.blue,    fontWeight: 600 }}>● Utilized</span>
                                  : <span style={{ color: C.textSub              }}>○ Not Utilized</span>}
                                {p.classifyAsProductive
                                  ? <span style={{ color: C.textMid, fontWeight: 600 }}>● Productive</span>
                                  : <span style={{ color: C.textSub              }}>○ Not Productive</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      </>
                    );
                  })}

                  {/* Team total row */}
                  <tr style={{ background: C.alt }}>
                    <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: C.text, borderTop: `2px solid ${C.border}`, ...stickyLeft, background: C.alt }}>
                      Team Total
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "center", borderTop: `2px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      <div style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.blue }}>{teamCap.toFixed(0)}h</div>
                    </td>
                    <td style={{ padding: "8px 12px", borderTop: `2px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 700, color: ragColor(teamBillableRAG) }}>{teamBillable.toFixed(1)}h</span>
                        <span style={{ fontFamily: C.mono, fontSize: 12, color: ragColor(teamBillableRAG) }}>{Math.round(teamBillablePct * 100)}%</span>
                      </div>
                      <MiniBar pct={teamBillablePct} tgt={teamBillableTgtPct} color={ragColor(teamBillableRAG)} />
                      <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>
                        target {Math.round(teamBillableTgtPct * 100)}%{" · "}
                        <span style={{ color: ragColor(teamBillableRAG), fontWeight: 600 }}>
                          {(teamBillable - teamBillableTarget) >= 0 ? `+${(teamBillable - teamBillableTarget).toFixed(1)}h` : `${(teamBillable - teamBillableTarget).toFixed(1)}h`}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "8px 12px", borderTop: `2px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 700, color: ragColor(teamUtilizedRAG) }}>{teamUtilized.toFixed(1)}h</span>
                        <span style={{ fontFamily: C.mono, fontSize: 12, color: ragColor(teamUtilizedRAG) }}>{Math.round(teamUtilizedPct * 100)}%</span>
                      </div>
                      <MiniBar pct={teamUtilizedPct} tgt={teamUtilizedTgtPct} color={ragColor(teamUtilizedRAG)} />
                      <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>
                        target {Math.round(teamUtilizedTgtPct * 100)}%{" · "}
                        <span style={{ color: ragColor(teamUtilizedRAG), fontWeight: 600 }}>
                          {(teamUtilized - teamUtilizedTarget) >= 0 ? `+${(teamUtilized - teamUtilizedTarget).toFixed(1)}h` : `${(teamUtilized - teamUtilizedTarget).toFixed(1)}h`}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "center", borderTop: `2px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      <div style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.textMid }}>{teamProductive.toFixed(1)}h</div>
                      <div style={{ fontSize: 10, color: C.textSub, marginTop: 2 }}>{Math.round(teamProductivePct * 100)}%</div>
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "center", borderTop: `2px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      <div style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: teamBench > teamCap * 0.25 ? C.red : teamBench > teamCap * 0.1 ? C.yellow : C.textSub }}>
                        {teamBench.toFixed(1)}h
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "center", borderTop: `2px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: ragBg(teamBillableRAG), color: ragColor(teamBillableRAG), border: `1px solid ${ragBd(teamBillableRAG)}` }}>
                        {ragLabel(teamBillableRAG)}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: C.textSub }}>
              <strong>Billable</strong>: hours on projects flagged billable in NetSuite ·{" "}
              <strong>Utilized</strong>: hours on projects flagged &ldquo;utilized time&rdquo; ·{" "}
              <strong>Productive</strong>: hours on projects flagged &ldquo;productive time&rdquo; ·{" "}
              <strong>Bench</strong>: unallocated time ·{" "}
              Status based on Billable vs. target. <strong>Target is a floor</strong> — at or above it is green, below it is red.
              All three classifications are read from the NetSuite project record;
              target utilization from the NetSuite employee record (default 75%).
            </div>
          </>
        );
      })()}
    </div>
  );
}
