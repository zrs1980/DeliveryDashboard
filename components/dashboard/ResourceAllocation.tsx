"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { C } from "@/lib/constants";
import type { NSAllocation } from "@/lib/types";

interface Props {
  allocations: NSAllocation[];
  error?: string | null;
}

interface CellEdit {
  allocationId:  string | null;   // null = creating a new allocation
  employeeId:    number;
  employeeName:  string;
  projectId:     number;
  projectName:   string;
  companyName:   string;
  remainingHours: number | null;
  budgetHours:   number | null;
  weekMs:        number;
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
  return allocations
    .filter(a => allocCoversWeek(a, weekStart))
    .reduce((sum, a) => {
      if (a.percentOfMax > 0) return sum + a.percentOfMax;
      return sum + (a.hoursPerDay / 8) * 100;
    }, 0);
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
  if (pct >= 50)  return { background: C.yellowBg, color: C.yellow, fontWeight: 600, border: `1px solid ${C.yellowBd}` };
  return              { background: C.greenBg,  color: C.green,  fontWeight: 600, border: `1px solid ${C.greenBd}` };
}

function gapStyle(gap: number): React.CSSProperties {
  if (gap < -5)  return { color: C.red,    fontWeight: 700 };
  if (gap < 10)  return { color: C.yellow, fontWeight: 700 };
  return               { color: C.green,   fontWeight: 600 };
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

export function ResourceAllocation({ allocations, error }: Props) {
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
          startDate:      fmt(weekStart),
          endDate:        fmt(weekEnd),
          allocationUnit: "P",
          percentOfMax:   (newHrs / 40) * 100,
          hoursPerDay:    0,
          companyName:    cell.companyName ?? "",
          remainingHours: cell.remainingHours,
          budgetHours:    cell.budgetHours,
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
          { label: ">100% Over",  bg: C.redBg,    color: C.red    },
          { label: "80–100% High", bg: C.orangeBg, color: C.orange },
          { label: "50–79% Med",  bg: C.yellowBg, color: C.yellow },
          { label: "<50% Low",    bg: C.greenBg,  color: C.green  },
        ].map(l => (
          <span key={l.label} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: l.bg, color: l.color }}>
            {l.label}
          </span>
        ))}
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
                  minWidth: 80,
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
                    {weekPcts.map((pct, wi) => (
                      <td key={wi} style={{ padding: "6px 8px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }}>
                        {pct > 0 ? (
                          <span style={{ display: "inline-block", padding: "3px 7px", borderRadius: 4, fontSize: 11, fontFamily: C.mono, ...pctCellStyle(pct) }}>
                            {Math.round(pct)}%
                          </span>
                        ) : (
                          <span style={{ color: C.mid, fontSize: 11 }}>—</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {isExp && emp.rows.map((a, ai) => (
                    <tr key={`${emp.name}-${a.id}`} style={{ background: ei % 2 === 0 ? "#F7FAFF" : "#F0F4F8" }}>
                      <td style={{ padding: "7px 14px 7px 32px", fontSize: 11, color: C.textMid, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300, ...stickyLeft, background: ei % 2 === 0 ? "#F7FAFF" : "#F0F4F8" }} title={a.projectName}>
                        <span style={{ color: C.mid, marginRight: 6 }}>└</span>
                        {a.projectName}
                      </td>
                      {weeks.map((w, wi) => {
                        const hrs = hoursForWeek(a, w);
                        return (
                          <td key={wi} style={{ padding: "6px 8px", textAlign: "center", fontSize: 11, fontFamily: C.mono, borderBottom: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}`, color: hrs > 0 ? C.textMid : C.mid, fontWeight: hrs > 0 ? 500 : 400 }}>
                            {hrs > 0 ? hrs.toFixed(1) : <span style={{ color: C.mid }}>—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
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
            {byProject.map((proj, pi) => {
              const isExp          = expandedProjects.has(String(proj.projectId));
              const rowBg          = pi % 2 === 0 ? C.surface : C.alt;
              const totalAllocated = proj.rows.reduce((s, a) => s + estimatedFutureHours(a, today), 0);
              const gap            = proj.remainingHours != null ? proj.remainingHours - totalAllocated : null;
              const weekTotals     = weeks.map(w => proj.rows.reduce((s, a) => s + hoursForWeek(a, w), 0));

              return (
                <>
                  {/* Project row */}
                  <tr key={proj.projectId} style={{ background: rowBg, cursor: "pointer" }} onClick={() => toggleProject(String(proj.projectId))}>
                    <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, color: C.text, borderBottom: isExp ? "none" : `1px solid ${C.border}`, whiteSpace: "nowrap", ...stickyLeft, background: rowBg }}>
                      <span style={{ marginRight: 6, fontSize: 10, color: C.textSub }}>{isExp ? "▼" : "▶"}</span>
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
                              companyName:    proj.companyName ?? "",
                              remainingHours: proj.remainingHours,
                              budgetHours:    proj.budgetHours,
                              weekMs:         wMs,
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
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: C.textSub }}>
        Allocated = estimated future hours (today → end date) at current weekly rate. Gap = Remaining Budget − Allocated. Edits write back to NetSuite immediately.
      </div>
    </div>
  );
}
