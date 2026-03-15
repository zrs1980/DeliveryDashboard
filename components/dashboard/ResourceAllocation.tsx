"use client";
import { useState, useMemo } from "react";
import { C } from "@/lib/constants";
import type { NSAllocation } from "@/lib/types";

interface Props {
  allocations: NSAllocation[];
  error?: string | null;
}

// ─── Week helpers ─────────────────────────────────────────────────────────────

function getMondayOf(d: Date): Date {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const dow = day.getDay(); // 0=Sun
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
  // NetSuite SuiteQL returns dates as M/D/YYYY or YYYY-MM-DD
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

// Hours per week for an allocation (5 working days assumed)
function weeklyHours(a: NSAllocation): number {
  const isPercent = a.allocationUnit === "2" || a.percentOfMax > 0;
  if (isPercent && a.percentOfMax > 0) return (a.percentOfMax / 100) * 40;
  return a.hoursPerDay * 5;
}

// Total allocation % for a set of allocations in a week
function totalPctForWeek(allocations: NSAllocation[], weekStart: Date): number {
  return allocations
    .filter(a => allocCoversWeek(a, weekStart))
    .reduce((sum, a) => {
      const isPercent = a.allocationUnit === "2" || a.percentOfMax > 0;
      if (isPercent && a.percentOfMax > 0) return sum + a.percentOfMax;
      return sum + (a.hoursPerDay / 8) * 100;
    }, 0);
}

// Hours per week for a single allocation in a given week
function hoursForWeek(a: NSAllocation, weekStart: Date): number {
  if (!allocCoversWeek(a, weekStart)) return 0;
  return weeklyHours(a);
}

// ─── Cell colour helpers ──────────────────────────────────────────────────────

function pctCellStyle(pct: number): React.CSSProperties {
  if (pct === 0) return { background: "transparent", color: C.mid };
  if (pct > 100) return { background: C.redBg,    color: C.red,    fontWeight: 700, border: `1px solid ${C.redBd}` };
  if (pct >= 80)  return { background: C.orangeBg, color: C.orange, fontWeight: 700, border: `1px solid ${C.orangeBd}` };
  if (pct >= 50)  return { background: C.yellowBg, color: C.yellow, fontWeight: 600, border: `1px solid ${C.yellowBd}` };
  return              { background: C.greenBg,  color: C.green,  fontWeight: 600, border: `1px solid ${C.greenBd}` };
}

function hoursCellStyle(hours: number): React.CSSProperties {
  if (hours === 0) return { color: C.mid };
  return { color: C.textMid, fontWeight: 500 };
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

// ─── Main component ───────────────────────────────────────────────────────────

export function ResourceAllocation({ allocations, error }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const weeks = useMemo(() => generateWeeks(10), []);
  const today = getMondayOf(new Date());
  const todayMs = today.getTime();

  // Group allocations by employee
  const byEmployee = useMemo(() => {
    const map = new Map<string, { employeeId: number; name: string; rows: NSAllocation[] }>();
    for (const a of allocations) {
      const key = a.employeeName;
      if (!map.has(key)) map.set(key, { employeeId: a.employeeId, name: a.employeeName, rows: [] });
      map.get(key)!.rows.push(a);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allocations]);

  // KPIs (based on current week)
  const kpis = useMemo(() => {
    let over = 0, high = 0, normal = 0, light = 0;
    for (const emp of byEmployee) {
      const pct = totalPctForWeek(emp.rows, today);
      if (pct > 100)     over++;
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

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Resource Allocation</div>
        <div style={{ fontSize: 12, color: C.textSub }}>
          Weekly allocation by resource from NetSuite. Expand a row to see per-project breakdown.
        </div>
      </div>

      {/* KPI bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total Resources", value: kpis.total, color: C.blue,   bg: C.blueBg,   bd: C.blueBd   },
          { label: "Over-allocated",  value: kpis.over,  color: kpis.over  > 0 ? C.red    : C.textSub, bg: kpis.over  > 0 ? C.redBg    : C.alt, bd: kpis.over  > 0 ? C.redBd    : C.border },
          { label: "High (≥80%)",    value: kpis.high,  color: kpis.high  > 0 ? C.orange  : C.textSub, bg: kpis.high  > 0 ? C.orangeBg : C.alt, bd: kpis.high  > 0 ? C.orangeBd : C.border },
          { label: "Normal (20–79%)",value: kpis.normal,color: C.green,   bg: C.greenBg,  bd: C.greenBd  },
          { label: "Light (<20%)",   value: kpis.light, color: C.textSub, bg: C.alt,      bd: C.border   },
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

      {/* Grid */}
      <div style={{ overflowX: "auto", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: C.sh }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 200, paddingLeft: 14, position: "sticky", left: 0, background: C.alt, zIndex: 1 }}>
                Resource
              </th>
              {weeks.map(w => (
                <th key={w.toISOString()} style={{
                  ...thStyle,
                  minWidth: 80,
                  background: w.getTime() === todayMs ? "#EBF5FF" : C.alt,
                  color: w.getTime() === todayMs ? C.blue : C.textSub,
                  borderBottom: w.getTime() === todayMs ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
                }}>
                  {fmtWeekHeader(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byEmployee.map((emp, ei) => {
              const isExp   = expanded.has(emp.name);
              const rowBg   = ei % 2 === 0 ? C.surface : C.alt;
              const weekPcts = weeks.map(w => totalPctForWeek(emp.rows, w));

              return (
                <>
                  {/* Resource row */}
                  <tr key={emp.name} style={{ background: rowBg, cursor: "pointer" }} onClick={() => toggleExpand(emp.name)}>
                    <td style={{
                      padding: "10px 14px",
                      fontWeight: 700,
                      fontSize: 13,
                      color: C.text,
                      borderBottom: isExp ? "none" : `1px solid ${C.border}`,
                      whiteSpace: "nowrap",
                      position: "sticky",
                      left: 0,
                      background: rowBg,
                      zIndex: 1,
                    }}>
                      <span style={{ marginRight: 6, fontSize: 10, color: C.textSub }}>{isExp ? "▼" : "▶"}</span>
                      {emp.name}
                    </td>
                    {weekPcts.map((pct, wi) => (
                      <td key={wi} style={{
                        padding: "6px 8px",
                        textAlign: "center",
                        borderBottom: isExp ? "none" : `1px solid ${C.border}`,
                        borderLeft: `1px solid ${C.border}`,
                      }}>
                        {pct > 0 ? (
                          <span style={{
                            display: "inline-block",
                            padding: "3px 7px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontFamily: C.mono,
                            ...pctCellStyle(pct),
                          }}>
                            {Math.round(pct)}%
                          </span>
                        ) : (
                          <span style={{ color: C.mid, fontSize: 11 }}>—</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Project breakdown rows */}
                  {isExp && emp.rows.map((a, ai) => (
                    <tr key={`${emp.name}-${a.id}`} style={{ background: ei % 2 === 0 ? "#F7FAFF" : "#F0F4F8" }}>
                      <td style={{
                        padding: "7px 14px 7px 32px",
                        fontSize: 11,
                        color: C.textMid,
                        borderBottom: ai === emp.rows.length - 1 ? `1px solid ${C.border}` : `1px solid ${C.border}`,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 300,
                        position: "sticky",
                        left: 0,
                        background: ei % 2 === 0 ? "#F7FAFF" : "#F0F4F8",
                        zIndex: 1,
                      }}
                        title={a.projectName}
                      >
                        <span style={{ color: C.mid, marginRight: 6 }}>└</span>
                        {a.projectName}
                      </td>
                      {weeks.map((w, wi) => {
                        const hrs = hoursForWeek(a, w);
                        return (
                          <td key={wi} style={{
                            padding: "6px 8px",
                            textAlign: "center",
                            fontSize: 11,
                            fontFamily: C.mono,
                            borderBottom: ai === emp.rows.length - 1 ? `1px solid ${C.border}` : `1px solid ${C.border}`,
                            borderLeft: `1px solid ${C.border}`,
                            ...hoursCellStyle(hrs),
                          }}>
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

      <div style={{ marginTop: 10, fontSize: 11, color: C.textSub }}>
        Showing {weeks.length} weeks from current week. Hours per week = hours/day × 5 working days.
      </div>
    </div>
  );
}
