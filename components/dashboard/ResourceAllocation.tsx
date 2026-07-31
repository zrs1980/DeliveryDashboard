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
  projectType:   "Implementation" | "Service" | "Internal";
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

// ─── Cell colour helpers ──────────────────────────────────────────────────────

function pctCellStyle(pct: number): React.CSSProperties {
  if (pct === 0) return { background: "transparent", color: C.mid };
  if (pct > 100) return { background: C.redBg,    color: C.red,    fontWeight: 700, border: `1px solid ${C.redBd}` };
  if (pct >= 80)  return { background: C.orangeBg, color: C.orange, fontWeight: 700, border: `1px solid ${C.orangeBd}` };
  if (pct >= 70)  return { background: C.greenBg,  color: C.green,  fontWeight: 600, border: `1px solid ${C.greenBd}` };
  if (pct >= 50)  return { background: C.yellowBg, color: C.yellow, fontWeight: 600, border: `1px solid ${C.yellowBd}` };
  return              { background: C.redBg,    color: C.red,    fontWeight: 700, border: `1px solid ${C.redBd}` };
}

function gapStyle(gap: number): React.CSSProperties {
  if (gap < -5)  return { color: C.red,    fontWeight: 700 };
  if (gap < 10)  return { color: C.yellow, fontWeight: 700 };
  return               { color: C.green,   fontWeight: 600 };
}

// ─── Sub-tab / Forecast helpers ───────────────────────────────────────────

type SubTab = "allocation" | "forecast";
type ForecastPeriod = "week" | "month" | "quarter" | "wtd" | "mtd" | "qtd";

const PERIOD_LABELS: Record<ForecastPeriod, string> = {
  week: "Week", month: "Month", quarter: "Quarter",
  wtd: "WTD", mtd: "MTD", qtd: "QTD",
};

const FORECAST_BILL_RATIO = 0.87;

function getPeriodBounds(period: ForecastPeriod, today: Date): { start: Date; end: Date } {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
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

function getPeriodDisplayLabel(period: ForecastPeriod, today: Date): string {
  const { start, end } = getPeriodBounds(period, today);
  const q = Math.floor(today.getMonth() / 3) + 1;
  switch (period) {
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
      projectType: "Implementation" | "Service" | "Internal";
      remainingHours: number | null;
      budgetHours: number | null;
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
          rows:           [],
        });
      }
      map.get(a.projectId)!.rows.push(a);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [localAllocs]);

  // KPIs (current week)
  const kpis = useMemo(() => {
    let over = 0, high = 0, normal = 0, light = 0;
    for (const emp of byEmployee) {
      const pct = totalPctForWeek(emp.rows, today);
      if (pct > 100)      over++;
      else if (pct >= 80) high++;
      else if (pct >= 20) normal++;
      else                light++;
    }
    return { total: byEmployee.length, over, high, normal, light };
  }, [byEmployee, today]);

  const forecastData = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const { start, end } = getPeriodBounds(forecastPeriod, now);
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
      const billableRAG: "green" | "yellow" | "red" = billablePct >= billableTgtPct * 0.95 ? "green" : billablePct >= billableTgtPct * 0.8 ? "yellow" : "red";
      const utilizedRAG: "green" | "yellow" | "red" = utilizedPct >= utilizedTgtPct * 0.95 ? "green" : utilizedPct >= utilizedTgtPct * 0.8 ? "yellow" : "red";

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
    const ragFn = (pct: number, tgt: number): "green" | "yellow" | "red" => pct >= tgt * 0.95 ? "green" : pct >= tgt * 0.8 ? "yellow" : "red";

    return {
      rows, workDays, capPerPerson,
      teamCap, teamBillable, teamUtilized, teamProductive,
      teamBench: rows.reduce((s, r) => s + r.bench, 0),
      teamBillableTarget, teamUtilizedTarget,
      teamBillablePct, teamUtilizedPct, teamProductivePct,
      teamBillableTgtPct, teamUtilizedTgtPct,
      teamBillableRAG: ragFn(teamBillablePct, teamBillableTgtPct),
      teamUtilizedRAG: ragFn(teamUtilizedPct, teamUtilizedTgtPct),
    };
  }, [byEmployee, forecastPeriod, consultantRoster]);

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
          remainingHours: cell.remainingHours,
          budgetHours:    cell.budgetHours,
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
          { label: "Total Resources", value: kpis.total,  color: C.blue,   bg: C.blueBg,   bd: C.blueBd   },
          { label: "Over-allocated",  value: kpis.over,   color: kpis.over  > 0 ? C.red    : C.textSub, bg: kpis.over  > 0 ? C.redBg    : C.alt, bd: kpis.over  > 0 ? C.redBd    : C.border },
          { label: "High (≥80%)",    value: kpis.high,   color: kpis.high  > 0 ? C.orange  : C.textSub, bg: kpis.high  > 0 ? C.orangeBg : C.alt, bd: kpis.high  > 0 ? C.orangeBd : C.border },
          { label: "Normal (20–79%)", value: kpis.normal, color: C.green,   bg: C.greenBg,  bd: C.greenBd  },
          { label: "Light (<20%)",    value: kpis.light,  color: C.textSub, bg: C.alt,      bd: C.border   },
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
        {[
          { label: ">100% Over",     bg: C.redBg,    color: C.red    },
          { label: "80–100% High",  bg: C.orangeBg, color: C.orange },
          { label: "70–79% Optimal", bg: C.greenBg,  color: C.green  },
          { label: "50–69% Med",    bg: C.yellowBg, color: C.yellow },
          { label: "<50% Low",      bg: C.redBg,    color: C.red    },
        ].map(l => (
          <span key={l.label} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: l.bg, color: l.color }}>
            {l.label}
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

              const TYPE_BADGES: Array<{ key: string; color: string; bg: string }> = [
                { key: "Implementation", color: C.purple, bg: C.purpleBg },
                { key: "Service",        color: C.blue,   bg: C.blueBg   },
                { key: "Internal",       color: C.textSub, bg: C.alt     },
              ];

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
                    const TYPE_ORDER = ["Implementation", "Service", "Internal"] as const;
                    const TYPE_STYLE: Record<string, { bg: string; color: string; bd: string }> = {
                      Implementation: { bg: C.purpleBg, color: C.purple, bd: C.purpleBd },
                      Service:        { bg: C.blueBg,   color: C.blue,   bd: C.blueBd   },
                      Internal:       { bg: C.alt,      color: C.textSub, bd: C.border  },
                    };
                    const grouped: Record<string, typeof emp.rows> = {};
                    for (const a of emp.rows) {
                      const t = a.projectType ?? "Internal";
                      if (!grouped[t]) grouped[t] = [];
                      grouped[t].push(a);
                    }
                    const rowBgSub = ei % 2 === 0 ? "#F7FAFF" : "#F0F4F8";
                    const empTotalHrs = weeks.reduce((s, w) => s + emp.rows.reduce((r, a) => r + hoursForWeek(a, w), 0), 0);
                    return TYPE_ORDER.filter(t => grouped[t]?.length).flatMap(t => {
                      const style = TYPE_STYLE[t];
                      const catTotalHrs = weeks.reduce((s, w) => s + grouped[t].reduce((r, a) => r + hoursForWeek(a, w), 0), 0);
                      const catPct = empTotalHrs > 0 ? Math.round((catTotalHrs / empTotalHrs) * 100) : 0;
                      return [
                        <tr key={`${emp.name}-type-${t}`}>
                          <td colSpan={weeks.length + 1} style={{ padding: "4px 14px 4px 20px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `1px solid ${style.bd}`, ...stickyLeft }}>
                            {t}
                            <span style={{ marginLeft: 8, fontFamily: C.mono, fontSize: 10, opacity: 0.75 }}>{catPct}%</span>
                          </td>
                        </tr>,
                        ...(() => {
                          const byProj = new Map<number, { allocs: NSAllocation[]; name: string; companyName: string }>();
                          for (const a of grouped[t]) {
                            if (!byProj.has(a.projectId)) byProj.set(a.projectId, { allocs: [], name: a.projectName, companyName: a.companyName ?? "" });
                            byProj.get(a.projectId)!.allocs.push(a);
                          }
                          return Array.from(byProj.values()).map(({ allocs, name, companyName }) => (
                            <tr key={`${emp.name}-${t}-${allocs[0].projectId}`} style={{ background: rowBgSub }}>
                              <td style={{ padding: "7px 14px 7px 36px", fontSize: 11, color: C.textMid, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300, ...stickyLeft, background: rowBgSub }} title={companyName ? `${companyName} — ${name}` : name}>
                                <span style={{ color: C.mid, marginRight: 6 }}>└</span>
                                {companyName && <span style={{ fontWeight: 400, color: C.textSub, marginRight: 4 }}>{companyName} —</span>}
                                {name}
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
                          ));
                        })(),
                        <tr key={`${emp.name}-type-${t}-total`}>
                          <td style={{ padding: "4px 14px 4px 20px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `1px solid ${style.bd}`, ...stickyLeft }}>
                            {t} Total
                          </td>
                          {weeks.map((w, wi) => {
                            const total = grouped[t].reduce((s, a) => s + hoursForWeek(a, w), 0);
                            const weekPct = Math.round((total / 40) * 100);
                            return (
                              <td key={wi} style={{ padding: "4px 8px", textAlign: "center", fontSize: 10, fontFamily: C.mono, fontWeight: 600, background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `1px solid ${style.bd}`, borderLeft: `1px solid ${style.bd}` }}>
                                {total > 0 ? (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    <span style={{ fontSize: 10 }}>{total.toFixed(1)}h</span>
                                    <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 4, fontSize: 11, fontFamily: C.mono, fontWeight: 700, ...(t === "Internal" ? { background: C.alt, color: C.textSub, border: `1px solid ${C.border}` } : pctCellStyle(weekPct)) }}>
                                      {weekPct}%
                                    </span>
                                    {t === "Implementation" && (() => {
                                      const gap = 30 - total;
                                      return gap > 0 ? (
                                        <span style={{ fontFamily: C.mono, fontSize: 9, fontWeight: 600, color: C.red }}>Need {gap.toFixed(1)}h</span>
                                      ) : (
                                        <span style={{ fontFamily: C.mono, fontSize: 9, fontWeight: 600, color: C.green }}>+{Math.abs(gap).toFixed(1)}h over</span>
                                      );
                                    })()}
                                  </div>
                                ) : t === "Implementation" ? (
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    <span style={{ opacity: 0.35 }}>—</span>
                                    <span style={{ fontFamily: C.mono, fontSize: 9, fontWeight: 600, color: C.red }}>Need 30h</span>
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

      <div style={{ overflowX: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: C.sh }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 220, paddingLeft: 14, ...stickyLeft, background: C.alt }}>
                Project / Resource
              </th>
              <th style={{ ...thStyle, minWidth: 90 }}>Orig. Budget</th>
              <th style={{ ...thStyle, minWidth: 90 }}>Rem. Budget</th>
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
              const TYPE_ORDER = ["Implementation", "Service", "Internal"] as const;
              const TYPE_STYLE: Record<string, { bg: string; color: string; bd: string }> = {
                Implementation: { bg: C.purpleBg, color: C.purple,  bd: C.purpleBd },
                Service:        { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
                Internal:       { bg: C.alt,      color: C.textSub, bd: C.border   },
              };
              const grouped: Record<string, typeof byProject> = {};
              for (const proj of byProject) {
                const t = proj.projectType ?? "Internal";
                if (!grouped[t]) grouped[t] = [];
                grouped[t].push(proj);
              }
              return TYPE_ORDER.filter(t => (grouped[t]?.length ?? 0) > 0).flatMap(t => {
                const style = TYPE_STYLE[t];
                // Pre-compute group totals for the summary row
                const grpBudget     = grouped[t].some(p => p.budgetHours != null)    ? grouped[t].reduce((s, p) => s + (p.budgetHours    ?? 0), 0) : null;
                const grpRemaining  = grouped[t].some(p => p.remainingHours != null) ? grouped[t].reduce((s, p) => s + (p.remainingHours ?? 0), 0) : null;
                const grpAllocated  = grouped[t].reduce((s, p) => s + p.rows.reduce((rs, a) => rs + estimatedFutureHours(a, today), 0), 0);
                const grpGap        = grpRemaining != null ? grpRemaining - grpAllocated : null;
                const grpWeekTotals = weeks.map(w => grouped[t].reduce((s, p) => s + p.rows.reduce((rs, a) => rs + hoursForWeek(a, w), 0), 0));

                // Billable hours per week for this group, read off the project's
                // custentity_ceba_is_billable flag. Kept separate from grpWeekTotals
                // because the target below is a BILLABLE target — comparing it against
                // total allocated hours overstates attainment for any group that mixes
                // billable and non-billable projects.
                const grpWeekBillable = weeks.map(w =>
                  grouped[t].reduce((s, p) => s + p.rows.reduce(
                    (rs, a) => rs + (a.classifyAsBillable === true ? hoursForWeek(a, w) : 0), 0), 0));

                // Per-week billable target = Σ (targetUtil × 0.87 × 40) over each unique
                // employee allocated to a BILLABLE project that week. Previously this was
                // gated on the group being "Implementation", which disagreed with NetSuite:
                // some Implementation projects are flagged non-billable, and non-standard
                // types (e.g. Managed Services Agreement) are billable.
                const BILL_RATIO = 0.87;
                const grpHasBillable = grouped[t].some(p => p.rows.some(a => a.classifyAsBillable === true));
                const grpWeekTargets = grpHasBillable ? weeks.map(w => {
                  const seenEmps = new Map<number, number>(); // empId → targetUtilization
                  for (const proj of grouped[t]) {
                    for (const a of proj.rows) {
                      if (a.classifyAsBillable !== true) continue;
                      if (allocCoversWeek(a, w) && !seenEmps.has(a.employeeId)) {
                        seenEmps.set(a.employeeId, a.targetUtilization ?? 0.75);
                      }
                    }
                  }
                  return Array.from(seenEmps.values()).reduce((s, tu) => s + tu * BILL_RATIO * 40, 0);
                }) : null;
                return [
                  <tr key={`type-hdr-${t}`}>
                    <td colSpan={weeks.length + 5} style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `1px solid ${style.bd}` }}>
                      {t}
                      <span style={{ marginLeft: 8, fontFamily: C.mono, fontSize: 10, opacity: 0.7 }}>
                        {grouped[t].length} project{grouped[t].length !== 1 ? "s" : ""}
                      </span>
                    </td>
                  </tr>,
                  ...grouped[t].map((proj, pi) => {
              const isExp          = expandedProjects.has(String(proj.projectId));
              const rowBg          = pi % 2 === 0 ? C.surface : C.alt;
              const totalAllocated = proj.rows.reduce((s, a) => s + estimatedFutureHours(a, today), 0);
              const gap            = proj.remainingHours != null ? proj.remainingHours - totalAllocated : null;
              const weekTotals     = weeks.map(w => proj.rows.reduce((s, a) => s + hoursForWeek(a, w), 0));

              // Classification chips. All allocations on a project carry the same
              // project-level flags, so any row is representative.
              const flags: Array<{ k: string; on: boolean; color: string }> = [
                { k: "B", on: proj.rows.some(a => a.classifyAsBillable   === true), color: C.green },
                { k: "U", on: proj.rows.some(a => a.classifyAsUtilized    === true), color: C.blue  },
                { k: "P", on: proj.rows.some(a => a.classifyAsProductive  === true), color: C.teal  },
              ];
              const flagTitle = `Billable: ${flags[0].on ? "yes" : "no"} · Utilized: ${flags[1].on ? "yes" : "no"} · Productive: ${flags[2].on ? "yes" : "no"} (from the NetSuite project record)`;

              return (
                <>
                  {/* Project row */}
                  <tr key={proj.projectId} style={{ background: rowBg, cursor: "pointer" }} onClick={() => toggleProject(String(proj.projectId))}>
                    <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: C.text, borderBottom: isExp ? "none" : `1px solid ${C.border}`, whiteSpace: "nowrap", ...stickyLeft, background: rowBg }}>
                      <span style={{ marginRight: 6, fontSize: 10, color: C.textSub }}>{isExp ? "▼" : "▶"}</span>
                      <span style={{ display: "inline-flex", gap: 2, marginRight: 7, verticalAlign: "middle" }} title={flagTitle}>
                        {flags.map(f => (
                          <span
                            key={f.k}
                            style={{
                              fontFamily: C.mono, fontSize: 9, fontWeight: 700, lineHeight: 1.5,
                              width: 14, textAlign: "center", borderRadius: 3,
                              background: f.on ? f.color : C.alt,
                              color:      f.on ? "#fff"   : C.mid,
                              border: `1px solid ${f.on ? f.color : C.border}`,
                            }}
                          >
                            {f.k}
                          </span>
                        ))}
                      </span>
                      {proj.companyName && (
                        <span style={{ fontWeight: 400, color: C.textSub, marginRight: 4 }}>{proj.companyName} —</span>
                      )}
                      {proj.name}
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
                        <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600, color: C.textMid }}>
                          {proj.remainingHours.toFixed(1)}h
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
                            {empSaving && <span style={{ marginLeft: 8, fontSize: 10, color: C.blue }}>saving…</span>}
                            {empError  && <span style={{ marginLeft: 8, fontSize: 10, color: C.red }}>{cellError!.msg}</span>}
                          </td>

                          {/* Orig. Budget / Rem. Budget / Allocated / Gap — empty for sub-rows */}
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
                  }), // end grouped[t].map
                  // ── Group total row ──────────────────────────────────────
                  <tr key={`type-total-${t}`}>
                    <td style={{ padding: "6px 14px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", background: style.bg, color: style.color, borderTop: `1px solid ${style.bd}`, borderBottom: `2px solid ${style.bd}`, ...stickyLeft }}>
                      {t} Total
                    </td>
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
              }); // end TYPE_ORDER.flatMap
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
              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 8, fontStyle: "italic" }}>
                {getPeriodDisplayLabel(forecastPeriod, now)}
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
                    const TYPE_STYLE: Record<string, { color: string; bg: string; bd: string }> = {
                      Implementation: { color: C.purple,  bg: C.purpleBg, bd: C.purpleBd },
                      Service:        { color: C.blue,    bg: C.blueBg,   bd: C.blueBd   },
                      Internal:       { color: C.textSub, bg: C.alt,      bd: C.border   },
                    };
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
                        const ts = TYPE_STYLE[p.type] ?? TYPE_STYLE["Internal"];
                        const isLast = pi === r.breakdown.length - 1;
                        const pct = r.cap > 0 ? p.hours / r.cap : 0;
                        return (
                          <tr key={`${r.name}-${p.projectId}`} style={{ background: subBg }}>
                            <td style={{ padding: "7px 14px 7px 36px", fontSize: 11, color: C.textMid, borderBottom: isLast ? `1px solid ${C.border}` : `1px solid ${C.border}8`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280, ...stickyLeft, background: subBg }}
                                title={p.companyName ? `${p.companyName} — ${p.name}` : p.name}>
                              <span style={{ color: C.mid, marginRight: 6 }}>└</span>
                              <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: ts.bg, color: ts.color, border: `1px solid ${ts.bd}`, marginRight: 6 }}>
                                {p.type === "Implementation" ? "Impl" : p.type}
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
              Status based on Billable vs. target. All three classifications are read from the NetSuite project record;
              target utilization from the NetSuite employee record (default 75%).
            </div>
          </>
        );
      })()}
    </div>
  );
}
