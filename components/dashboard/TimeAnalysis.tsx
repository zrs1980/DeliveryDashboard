"use client";
import { useState, useEffect, useRef } from "react";
import { C } from "@/lib/constants";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

type PeriodKey = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "thisQuarter" | "lastQuarter" | "custom";

interface PeriodMetrics {
  total: number;
  billable: number;
  utilized: number;
  productive: number;
  billablePct: number;
  utilizedPct: number;
  productivePct: number;
}

interface WeekPoint extends PeriodMetrics { weekStart: string; }

interface TimeEntry {
  id: number;
  date: string;
  hours: number;
  memo: string;
  billable: boolean;
  utilized: boolean;
}

interface ProjectBreakdown {
  projectId:   number | null;
  clientName:  string;
  projectName: string;
  total:       number;
  billable:    number;
  utilized:    number;
  productive:  number;
  billablePct: number;
  entries:     TimeEntry[];
}

interface EmployeeTimeData {
  employeeId: number;
  employeeName: string;
  employeeType: string;
  periods: Partial<Record<PeriodKey, PeriodMetrics>>;
  weeklyTrend: WeekPoint[];
  projectBreakdown: Partial<Record<PeriodKey, ProjectBreakdown[]>>;
}

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Today", yesterday: "Yesterday",
  thisWeek: "This Week", lastWeek: "Last Week",
  thisMonth: "This Month", lastMonth: "Last Month",
  thisQuarter: "This Quarter", lastQuarter: "Last Quarter",
  custom: "Custom",
};
const TARGETS = { billable: 0.65, utilized: 0.75, productive: 0.85 };

function fmtH(n: number) { return `${n.toFixed(2)}h`; }
function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtNSDate(raw: string): string {
  const p = raw.split("/");
  if (p.length !== 3) return raw;
  const d = new Date(+p[2], +p[0] - 1, +p[1]);
  return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]} ${+p[1]} ${MONTHS_SHORT[+p[0]-1]}`;
}

function PctBar({ value, target, color, slim }: { value: number; target: number; color: string; slim?: boolean }) {
  const pct = Math.min(value * 100, 100);
  const targetPct = Math.min(target * 100, 100);
  const isAbove = value >= target;
  const h = slim ? 5 : 7;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: h, background: "#F1F5F9", borderRadius: 4, position: "relative" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: isAbove ? color : "#EF4444", transition: "width 0.3s" }} />
        <div style={{ position: "absolute", top: -3, left: `${targetPct}%`, width: 2, height: h + 6, background: "#94A3B8", borderRadius: 1, transform: "translateX(-50%)" }} />
      </div>
      <span style={{ fontSize: slim ? 11 : 12, fontFamily: C.mono, fontWeight: 700, minWidth: 34, color: isAbove ? C.green : C.red }}>
        {fmtPct(value)}
      </span>
    </div>
  );
}

// ── Allocation helpers (must match ManagerReview.tsx exactly) ────────────────

function parseAllocDate(s: string): Date | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T12:00:00");
  const p = s.split("/");
  if (p.length === 3) return new Date(parseInt(p[2]), parseInt(p[0]) - 1, parseInt(p[1]));
  return null;
}

function getMondayOf(d: Date): Date {
  const r = new Date(d); r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

function weeklyAllocHours(seg: { pct: number; hrsPerDay: number }): number {
  return seg.pct > 0 ? (seg.pct / 100) * 40 : seg.hrsPerDay * 5;
}

function segHoursForWeek(seg: { startDate: string; endDate: string; pct: number; hrsPerDay: number }, weekStart: Date, rangeFrom: Date, rangeTo: Date): number {
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const windowStart = rangeFrom > weekStart ? rangeFrom : weekStart;
  const windowEnd   = rangeTo   < weekEnd   ? rangeTo   : weekEnd;
  if (windowStart > windowEnd) return 0;
  const s = parseAllocDate(seg.startDate);
  const e = parseAllocDate(seg.endDate);
  if (!s || !e || s > windowEnd || e < windowStart) return 0;
  const overlapStart = s > windowStart ? s : windowStart;
  const overlapEnd   = e < windowEnd   ? e : windowEnd;
  let workDays = 0;
  const cur = new Date(overlapStart); cur.setHours(0, 0, 0, 0);
  const last = new Date(overlapEnd);  last.setHours(0, 0, 0, 0);
  while (cur <= last) { const dow = cur.getDay(); if (dow >= 1 && dow <= 5) workDays++; cur.setDate(cur.getDate() + 1); }
  return (weeklyAllocHours(seg) / 5) * workDays;
}

function allocatedForPeriod(allocs: { startDate: string; endDate: string; pct: number; hrsPerDay: number }[], from: Date, to: Date): number {
  if (allocs.length === 0) return 0;
  let total = 0;
  const cur = getMondayOf(from);
  while (cur <= to) {
    for (const seg of allocs) total += segHoursForWeek(seg, cur, from, to);
    cur.setDate(cur.getDate() + 7);
  }
  return Math.round(total * 100) / 100;
}

function isCustomerType(projectType: string): boolean {
  const pt = (projectType ?? "").toLowerCase().trim();
  return pt !== "" && pt !== "internal";
}

interface MgrPeriodCache { employees: any[]; rangeFrom: string; rangeTo: string; }

export function TimeAnalysis() {
  const [employees, setEmployees] = useState<EmployeeTimeData[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [period, setPeriod]       = useState<PeriodKey>("thisMonth");
  const [expandedEmp, setExpandedEmp] = useState<number | null>(null);
  const [expandedProj, setExpandedProj] = useState<Set<string>>(new Set());
  const [mgrCache, setMgrCache]   = useState<Record<string, MgrPeriodCache>>({});
  const [mgrLoading, setMgrLoading] = useState<Record<string, boolean>>({});
  const [openAllocProj, setOpenAllocProj] = useState<Set<string>>(new Set());
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const mgrRequested = useRef<Set<string>>(new Set());

  const mgrCacheKey = period === "custom" && customFrom && customTo
    ? `custom_${customFrom}_${customTo}` : period;

  async function load(from?: string, to?: string) {
    setLoading(true); setError(null);
    try {
      const url = from && to ? `/api/time-analysis?from=${from}&to=${to}` : "/api/time-analysis";
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setEmployees(json.employees ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }

  function applyCustom() {
    if (!customFrom || !customTo || customFrom > customTo) return;
    setPeriod("custom");
    load(customFrom, customTo);
    const key = `custom_${customFrom}_${customTo}`;
    mgrRequested.current.delete(key);
    setMgrCache(prev => { const n = { ...prev }; delete n[key]; return n; });
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (expandedEmp === null) return;
    if (period === "custom" && (!customFrom || !customTo)) return;
    if (mgrRequested.current.has(mgrCacheKey)) return;
    mgrRequested.current.add(mgrCacheKey);
    const key = mgrCacheKey;
    const url = period === "custom" && customFrom && customTo
      ? `/api/manager-review?period=custom&from=${customFrom}&to=${customTo}`
      : `/api/manager-review?period=${period}`;
    setMgrLoading(s => ({ ...s, [key]: true }));
    fetch(url)
      .then(r => r.json())
      .then(json => setMgrCache(s => ({ ...s, [key]: { employees: json.employees ?? [], rangeFrom: json.rangeFrom ?? "", rangeTo: json.rangeTo ?? "" } })))
      .catch(() => {})
      .finally(() => setMgrLoading(s => ({ ...s, [key]: false })));
  }, [expandedEmp, mgrCacheKey]);

  // ── Team totals ──────────────────────────────────────────────────────────
  const active = employees.filter(e => (e.periods[period]?.total ?? 0) > 0);
  const teamTotals = active.reduce(
    (acc, e) => { const p = e.periods[period]; if (!p) return acc; acc.total += p.total; acc.billable += p.billable; acc.utilized += p.utilized; acc.productive += p.productive; return acc; },
    { total: 0, billable: 0, utilized: 0, productive: 0 },
  );
  const tt = teamTotals.total;
  const teamBillablePct   = tt > 0 ? teamTotals.billable   / tt : 0;
  const teamUtilizedPct   = tt > 0 ? teamTotals.utilized   / tt : 0;
  const teamProductivePct = tt > 0 ? teamTotals.productive / tt : 0;

  // ── Chart data ───────────────────────────────────────────────────────────
  const chartEmp = expandedEmp !== null ? employees.find(e => e.employeeId === expandedEmp) : null;
  const chartData = (() => {
    const base = chartEmp ? chartEmp.weeklyTrend : employees[0]?.weeklyTrend ?? [];
    return base.map((_, i) => {
      const src = chartEmp ? [chartEmp] : employees;
      const agg = src.reduce((a, e) => { const w = e.weeklyTrend[i]; a.total += w.total; a.billable += w.billable; a.utilized += w.utilized; a.productive += w.productive; return a; }, { total: 0, billable: 0, utilized: 0, productive: 0 });
      const t = agg.total;
      return { week: base[i].weekStart.slice(5), hours: Math.round(t * 10) / 10, billable: t > 0 ? Math.round(agg.billable / t * 100) : 0, utilized: t > 0 ? Math.round(agg.utilized / t * 100) : 0, productive: t > 0 ? Math.round(agg.productive / t * 100) : 0 };
    });
  })();

  const hasData = employees.length > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: C.text }}>Time Analysis</div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>Billable · Utilized · Productive — from NetSuite timebill records</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, fontFamily: C.font, background: period === p ? C.blue : "transparent", color: period === p ? "#fff" : C.textMid, border: `1px solid ${period === p ? C.blue : C.border}`, borderRadius: 7, cursor: "pointer", transition: "all 0.15s" }}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
            <button onClick={() => load()} disabled={loading} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, fontFamily: C.font, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 7, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "↻ Loading…" : "↻ Refresh"}
            </button>
          </div>
          {period === "custom" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                style={{ padding: "5px 10px", fontSize: 12, fontFamily: C.font, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: "#fff" }} />
              <span style={{ fontSize: 12, color: C.textSub }}>to</span>
              <input type="date" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value)}
                style={{ padding: "5px 10px", fontSize: 12, fontFamily: C.font, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: "#fff" }} />
              <button onClick={applyCustom} disabled={!customFrom || !customTo || customFrom > customTo}
                style={{ padding: "5px 14px", fontSize: 12, fontWeight: 700, fontFamily: C.font, background: (!customFrom || !customTo || customFrom > customTo) ? C.alt : C.blue, color: (!customFrom || !customTo || customFrom > customTo) ? C.textSub : "#fff", border: "none", borderRadius: 6, cursor: (!customFrom || !customTo || customFrom > customTo) ? "not-allowed" : "pointer" }}>
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.red, fontSize: 13 }}>⚠ {error}</div>}

      {/* Team KPI cards */}
      {hasData && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
          {([
            { label: "Total Hours", value: fmtH(tt), sub: `${active.length} active consultants`, color: C.blue, bg: C.blueBg, bd: C.blueBd, target: null },
            { label: "Billable",    value: fmtPct(teamBillablePct),   sub: `${fmtH(teamTotals.billable)} logged`,   color: teamBillablePct   >= TARGETS.billable   ? C.green : C.red, bg: teamBillablePct   >= TARGETS.billable   ? C.greenBg : C.redBg, bd: teamBillablePct   >= TARGETS.billable   ? C.greenBd : C.redBd, target: TARGETS.billable },
            { label: "Utilized",    value: fmtPct(teamUtilizedPct),   sub: `${fmtH(teamTotals.utilized)} logged`,   color: teamUtilizedPct   >= TARGETS.utilized   ? C.green : C.red, bg: teamUtilizedPct   >= TARGETS.utilized   ? C.greenBg : C.redBg, bd: teamUtilizedPct   >= TARGETS.utilized   ? C.greenBd : C.redBd, target: TARGETS.utilized },
            { label: "Productive",  value: fmtPct(teamProductivePct), sub: `${fmtH(teamTotals.productive)} logged`, color: teamProductivePct >= TARGETS.productive ? C.green : C.red, bg: teamProductivePct >= TARGETS.productive ? C.greenBg : C.redBg, bd: teamProductivePct >= TARGETS.productive ? C.greenBd : C.redBd, target: TARGETS.productive },
          ] as const).map(card => (
            <div key={card.label} style={{ background: card.bg, border: `1px solid ${card.bd}`, borderRadius: 10, padding: "14px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: card.color, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                {card.label}{card.target !== null && <span style={{ fontWeight: 400, opacity: 0.65, marginLeft: 6 }}>target {fmtPct(card.target)}</span>}
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: C.mono, color: card.color, lineHeight: 1.1 }}>{card.value}</div>
              <div style={{ fontSize: 11, color: card.color, opacity: 0.65, marginTop: 4 }}>{card.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Employee table */}
      {hasData && (
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 22 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.alt, borderBottom: `1px solid ${C.border}` }}>
                <th style={{ textAlign: "left", padding: "10px 18px", fontWeight: 600, fontSize: 11, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>Consultant</th>
                <th style={{ textAlign: "right", padding: "10px 18px", fontWeight: 600, fontSize: 11, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>Total Hours</th>
                <th style={{ padding: "10px 18px", fontWeight: 600, fontSize: 11, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 210 }}>Billable <span style={{ color: "#94A3B8", fontWeight: 400 }}>({fmtPct(TARGETS.billable)})</span></th>
                <th style={{ padding: "10px 18px", fontWeight: 600, fontSize: 11, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 210 }}>Utilized <span style={{ color: "#94A3B8", fontWeight: 400 }}>({fmtPct(TARGETS.utilized)})</span></th>
                <th style={{ padding: "10px 18px", fontWeight: 600, fontSize: 11, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 210 }}>Productive <span style={{ color: "#94A3B8", fontWeight: 400 }}>({fmtPct(TARGETS.productive)})</span></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const grouped = employees.reduce((acc, emp) => {
                  const t = emp.employeeType || "Other";
                  if (!acc[t]) acc[t] = [];
                  acc[t].push(emp);
                  return acc;
                }, {} as Record<string, EmployeeTimeData[]>);
                const groups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
                let rowIdx = 0;
                return groups.flatMap(([type, emps]) => [
                  <tr key={`group-${type}`}>
                    <td colSpan={5} style={{ padding: "8px 18px 4px", background: C.bg, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      {type}
                    </td>
                  </tr>,
                  ...emps.map((emp) => {
                    const i = rowIdx++;

                const p          = emp.periods[period] ?? { total: 0, billable: 0, utilized: 0, productive: 0, billablePct: 0, utilizedPct: 0, productivePct: 0 };
                const isExpanded = expandedEmp === emp.employeeId;
                const initials   = emp.employeeName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <>
                    {/* Summary row */}
                    <tr
                      key={`row-${emp.employeeId}`}
                      onClick={() => setExpandedEmp(isExpanded ? null : emp.employeeId)}
                      style={{ background: isExpanded ? "#EBF5FF" : i % 2 === 0 ? "#fff" : C.alt, borderBottom: isExpanded ? "none" : `1px solid ${C.border}`, cursor: "pointer", transition: "background 0.1s" }}
                    >
                      <td style={{ padding: "12px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: isExpanded ? C.blue : "#E2E8F0", color: isExpanded ? "#fff" : C.textMid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                            {initials}
                          </div>
                          <span style={{ fontWeight: 600, color: C.text }}>{emp.employeeName}</span>
                          <span style={{ fontSize: 14, color: C.textSub, marginLeft: "auto" }}>{isExpanded ? "▲" : "▼"}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 18px", textAlign: "right" }}>
                        {p.total > 0 ? <span style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 14, color: C.text }}>{fmtH(p.total)}</span> : <span style={{ color: C.textSub, fontSize: 12 }}>No data</span>}
                      </td>
                      <td style={{ padding: "10px 18px" }}>
                        {p.total > 0 ? <div><div style={{ fontSize: 11, color: C.textSub, marginBottom: 5 }}>{fmtH(p.billable)}</div><PctBar value={p.billablePct} target={TARGETS.billable} color={C.blue} /></div> : <span style={{ color: C.textSub }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 18px" }}>
                        {p.total > 0 ? <div><div style={{ fontSize: 11, color: C.textSub, marginBottom: 5 }}>{fmtH(p.utilized)}</div><PctBar value={p.utilizedPct} target={TARGETS.utilized} color={C.teal} /></div> : <span style={{ color: C.textSub }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 18px" }}>
                        {p.total > 0 ? <div><div style={{ fontSize: 11, color: C.textSub, marginBottom: 5 }}>{fmtH(p.productive)}</div><PctBar value={p.productivePct} target={TARGETS.productive} color={C.purple} /></div> : <span style={{ color: C.textSub }}>—</span>}
                      </td>
                    </tr>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <tr key={`detail-${emp.employeeId}`}>
                        <td colSpan={5} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ background: "#F8FAFC", borderTop: `1px solid ${C.border}`, padding: "20px 24px" }}>

                            {/* Per-resource Billable + Utilized cards */}
                            {p.total > 0 && (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 20 }}>
                                {[
                                  { label: "Billable",  hours: p.billable,  pct: p.billablePct,  target: TARGETS.billable,  color: C.blue, bg: p.billablePct  >= TARGETS.billable  ? C.greenBg : C.blueBg,  bd: p.billablePct  >= TARGETS.billable  ? C.greenBd : C.blueBd  },
                                  { label: "Utilized",  hours: p.utilized,  pct: p.utilizedPct,  target: TARGETS.utilized,  color: C.teal, bg: p.utilizedPct  >= TARGETS.utilized  ? C.greenBg : C.tealBg,  bd: p.utilizedPct  >= TARGETS.utilized  ? C.greenBd : C.tealBd  },
                                ].map(g => (
                                  <div key={g.label} style={{ background: g.bg, border: `1px solid ${g.bd}`, borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 16 }}>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                                        {g.label} <span style={{ fontWeight: 400, opacity: 0.65 }}>target {fmtPct(g.target)}</span>
                                      </div>
                                      <div style={{ fontFamily: C.mono, fontWeight: 800, fontSize: 22, color: g.color, lineHeight: 1 }}>{fmtH(g.hours)}</div>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <PctBar value={g.pct} target={g.target} color={g.color} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

                              {/* ── Left: Project breakdown ── */}
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12 }}>
                                  Project Breakdown <span style={{ fontWeight: 400, color: C.textSub, fontSize: 11 }}>— {PERIOD_LABELS[period]}</span>
                                </div>
                                {(() => {
                                  const allProj = emp.projectBreakdown[period] ?? [];
                                  if (allProj.length === 0) return <div style={{ color: C.textSub, fontSize: 13 }}>No project data for this period.</div>;

                                  const utilised     = allProj.filter(p => p.utilized > 0);
                                  const nonUtilised  = allProj.filter(p => p.utilized === 0);
                                  const utilBill    = utilised.filter(p => p.billable > 0);
                                  const utilNonBill = utilised.filter(p => p.billable === 0);

                                  const utilTotal    = utilised.reduce((s, p) => s + p.total, 0);
                                  const utilBillTotal = utilBill.reduce((s, p) => s + p.total, 0);
                                  const utilNonBillTotal = utilNonBill.reduce((s, p) => s + p.total, 0);
                                  const nonUtilTotal = nonUtilised.reduce((s, p) => s + p.total, 0);

                                  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                                  function fmtDate(raw: string) {
                                    const pts = raw.split("/");
                                    if (pts.length !== 3) return raw;
                                    const d = new Date(+pts[2], +pts[0]-1, +pts[1]);
                                    return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]} ${+pts[1]} ${months[+pts[0]-1]}`;
                                  }

                                  const ProjRow = ({ proj }: { proj: typeof allProj[0] }) => {
                                    const key = `${emp.employeeId}-${proj.projectId ?? "int"}`;
                                    const open = expandedProj.has(key);
                                    const toggle = () => setExpandedProj(prev => {
                                      const next = new Set(prev);
                                      next.has(key) ? next.delete(key) : next.add(key);
                                      return next;
                                    });
                                    return (
                                      <>
                                        <div
                                          onClick={toggle}
                                          style={{ display: "grid", gridTemplateColumns: "16px 1fr auto auto", gap: "0 8px", padding: "7px 10px", borderBottom: `1px solid ${C.border}`, alignItems: "center", cursor: "pointer", background: open ? C.blueBg : "transparent" }}
                                          onMouseEnter={e => { if (!open) (e.currentTarget as HTMLDivElement).style.background = C.alt; }}
                                          onMouseLeave={e => { if (!open) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                                        >
                                          <span style={{ fontSize: 8, color: C.textSub, transition: "transform 0.15s", display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                          <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                              {proj.clientName || (proj.projectId ? `Project #${proj.projectId}` : "Internal / Admin")}
                                            </div>
                                            {proj.projectName && proj.projectName !== proj.clientName && (
                                              <div style={{ fontSize: 10, color: C.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.projectName}</div>
                                            )}
                                          </div>
                                          <div style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 12, color: C.text, textAlign: "right", whiteSpace: "nowrap" }}>{fmtH(proj.total)}</div>
                                          {proj.billable > 0 && proj.billable < proj.total && (
                                            <div style={{ fontFamily: C.mono, fontSize: 10, color: C.blue, textAlign: "right", whiteSpace: "nowrap" }}>{fmtH(proj.billable)} bill</div>
                                          )}
                                          {(proj.billable === 0 || proj.billable === proj.total) && <div />}
                                        </div>
                                        {open && proj.entries.length > 0 && (
                                          <div style={{ background: C.alt, borderBottom: `1px solid ${C.border}` }}>
                                            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 70px", padding: "4px 10px 4px 34px", fontSize: 9, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${C.border}` }}>
                                              <div>Date</div><div>Memo</div><div style={{ textAlign: "right" }}>Hours</div>
                                            </div>
                                            {proj.entries.map(e => (
                                              <div key={e.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 70px", padding: "5px 10px 5px 34px", fontSize: 11, borderBottom: `1px solid ${C.border}`, alignItems: "center" }}>
                                                <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textSub }}>{fmtDate(e.date)}</div>
                                                <div style={{ color: e.memo ? C.text : C.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{e.memo || <em>no memo</em>}</div>
                                                <div style={{ fontFamily: C.mono, fontWeight: 600, fontSize: 11, color: C.text, textAlign: "right" }}>{fmtH(e.hours)}</div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    );
                                  };

                                  const GroupHeader = ({ label, total, color, bg, borderColor }: { label: string; total: number; color: string; bg: string; borderColor: string }) => (
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: bg, borderBottom: `2px solid ${borderColor}`, borderTop: `1px solid ${borderColor}` }}>
                                      <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                                      <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color }}>{fmtH(total)}</span>
                                    </div>
                                  );

                                  const SubHeader = ({ label, total, color, bg }: { label: string; total: number; color: string; bg: string }) => (
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 10px 5px 24px", background: bg, borderBottom: `1px solid ${C.border}` }}>
                                      <span style={{ fontSize: 10, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: "0.05em" }}>↳ {label}</span>
                                      <span style={{ fontFamily: C.mono, fontSize: 11, color }}>{fmtH(total)}</span>
                                    </div>
                                  );

                                  return (
                                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", fontSize: 12 }}>
                                      {/* UTILIZED */}
                                      {utilised.length > 0 && <>
                                        <GroupHeader label="Utilized" total={utilTotal} color={C.teal} bg={C.tealBg} borderColor={C.tealBd} />
                                        {utilBill.length > 0 && <>
                                          <SubHeader label="Billable" total={utilBillTotal} color={C.blue} bg={C.blueBg} />
                                          {utilBill.map((p, i) => <ProjRow key={i} proj={p} />)}
                                        </>}
                                        {utilNonBill.length > 0 && <>
                                          <SubHeader label="Non-Billable" total={utilNonBillTotal} color={C.textMid} bg={C.alt} />
                                          {utilNonBill.map((p, i) => <ProjRow key={i} proj={p} />)}
                                        </>}
                                      </>}
                                      {/* NON-UTILIZED */}
                                      {nonUtilised.length > 0 && <>
                                        <GroupHeader label="Non-Utilized" total={nonUtilTotal} color={C.textSub} bg={C.bg} borderColor={C.border} />
                                        {nonUtilised.map((p, i) => <ProjRow key={i} proj={p} />)}
                                      </>}
                                    </div>
                                  );
                                })()}

                                {/* Summary + gap cards */}
                                {p.total > 0 && (
                                  <div style={{ marginTop: 16 }}>
                                    {/* Positive: Billable & Utilized */}
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 8 }}>
                                      {[
                                        { label: "Billable",  hours: p.billable,  pct: p.billablePct,  target: TARGETS.billable,  color: C.blue,   bg: p.billablePct  >= TARGETS.billable  ? C.greenBg : C.blueBg,  bd: p.billablePct  >= TARGETS.billable  ? C.greenBd : C.blueBd  },
                                        { label: "Utilized",  hours: p.utilized,  pct: p.utilizedPct,  target: TARGETS.utilized,  color: C.teal,   bg: p.utilizedPct  >= TARGETS.utilized  ? C.greenBg : C.tealBg,  bd: p.utilizedPct  >= TARGETS.utilized  ? C.greenBd : C.tealBd  },
                                      ].map(g => (
                                        <div key={g.label} style={{ background: g.bg, border: `1px solid ${g.bd}`, borderRadius: 8, padding: "10px 12px" }}>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                                            {g.label} <span style={{ fontWeight: 400, opacity: 0.65 }}>target {fmtPct(g.target)}</span>
                                          </div>
                                          <div style={{ fontFamily: C.mono, fontWeight: 800, fontSize: 16, color: g.color }}>{fmtH(g.hours)}</div>
                                          <div style={{ fontSize: 10, color: g.color, opacity: 0.8 }}>{fmtPct(g.pct)} of total</div>
                                        </div>
                                      ))}
                                    </div>
                                    {/* Negative: Non-billable, Non-utilized, Non-productive */}
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                                      {[
                                        { label: "Non-billable",   hours: p.total - p.billable,   gap: TARGETS.billable   - p.billablePct   },
                                        { label: "Non-utilized",   hours: p.total - p.utilized,   gap: TARGETS.utilized   - p.utilizedPct   },
                                        { label: "Non-productive", hours: p.total - p.productive, gap: TARGETS.productive - p.productivePct },
                                      ].map(g => (
                                        <div key={g.label} style={{ background: g.gap > 0 ? C.redBg : C.greenBg, border: `1px solid ${g.gap > 0 ? C.redBd : C.greenBd}`, borderRadius: 8, padding: "10px 12px" }}>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: g.gap > 0 ? C.red : C.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{g.label}</div>
                                          <div style={{ fontFamily: C.mono, fontWeight: 800, fontSize: 16, color: g.gap > 0 ? C.red : C.green }}>{fmtH(g.hours)}</div>
                                          <div style={{ fontSize: 10, color: g.gap > 0 ? C.red : C.green, opacity: 0.8 }}>{g.gap > 0 ? `${Math.round(g.gap * 100)}pp below target` : "On target"}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* ── Right: Allocation vs Actuals ── */}
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12 }}>
                                  Allocation vs Actuals <span style={{ fontWeight: 400, color: C.textSub, fontSize: 11 }}>— {PERIOD_LABELS[period]}</span>
                                </div>
                                {mgrLoading[mgrCacheKey] ? (
                                  <div style={{ color: C.textSub, fontSize: 12, padding: "20px 0", textAlign: "center" }}>Loading allocation data…</div>
                                ) : (() => {
                                  const cached = mgrCache[mgrCacheKey];
                                  if (!cached) return <div style={{ color: C.textSub, fontSize: 12, padding: "20px 0" }}>Allocation data will load when you expand a row.</div>;

                                  const mgrEmp = cached.employees.find((e: any) => e.employeeId === emp.employeeId);
                                  if (!mgrEmp || mgrEmp.projects.length === 0) return (
                                    <div style={{ color: C.textSub, fontSize: 12, padding: "20px 0" }}>No allocation data for this period.</div>
                                  );

                                  const from = new Date(cached.rangeFrom + "T00:00:00");
                                  const to   = new Date(cached.rangeTo   + "T23:59:59");
                                  // For in-progress periods, allocation covers the full period window
                                  // (not capped at today) so the full week/month commitment is shown
                                  const allocTo = (() => {
                                    if (period === "thisWeek") {
                                      const sun = new Date(from); sun.setDate(from.getDate() + 6); sun.setHours(23, 59, 59, 999); return sun;
                                    }
                                    if (period === "thisMonth") return new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59, 999);
                                    if (period === "thisQuarter") { const q = Math.floor(from.getMonth() / 3); return new Date(from.getFullYear(), (q + 1) * 3, 0, 23, 59, 59, 999); }
                                    return to;
                                  })();

                                  const customerProjs = mgrEmp.projects.filter((proj: any) => isCustomerType(proj.projectType));
                                  const internalProjs = mgrEmp.projects.filter((proj: any) => !isCustomerType(proj.projectType));

                                  const colHdr = { fontSize: 10, fontWeight: 700 as const, color: C.textSub, textTransform: "uppercase" as const, letterSpacing: "0.05em", textAlign: "right" as const };
                                  const colVal = { fontFamily: C.mono, fontSize: 11, fontWeight: 600 as const, textAlign: "right" as const };

                                  const ProjAllocRow = ({ proj }: { proj: any }) => {
                                    const alloc    = allocatedForPeriod(proj.allocations, from, allocTo);
                                    const actual   = proj.actualHours;
                                    const bill     = proj.billableHours;
                                    const nonBill  = Math.round((actual - bill) * 100) / 100;
                                    const gap      = Math.round((actual - alloc) * 100) / 100;
                                    const gapColor = gap > 2 ? C.orange : gap < -2 ? C.red : C.green;
                                    const rowKey   = `${emp.employeeId}-alloc-${proj.projectId ?? "int"}`;
                                    const open     = openAllocProj.has(rowKey);
                                    const hasEntries = proj.entries && proj.entries.length > 0;
                                    const toggle   = () => hasEntries && setOpenAllocProj(prev => {
                                      const next = new Set(prev);
                                      next.has(rowKey) ? next.delete(rowKey) : next.add(rowKey);
                                      return next;
                                    });
                                    return (
                                      <>
                                        <div
                                          onClick={toggle}
                                          style={{ display: "grid", gridTemplateColumns: "16px 1fr 54px 54px 54px 54px 58px", gap: "0 4px", padding: "6px 10px", borderBottom: `1px solid ${C.border}`, alignItems: "center", cursor: hasEntries ? "pointer" : "default", background: open ? C.blueBg : "transparent" }}
                                          onMouseEnter={e => { if (hasEntries && !open) (e.currentTarget as HTMLDivElement).style.background = C.alt; }}
                                          onMouseLeave={e => { if (!open) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                                        >
                                          <span style={{ fontSize: 8, color: C.textSub, display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", visibility: hasEntries ? "visible" : "hidden" }}>▶</span>
                                          <div style={{ fontSize: 11, color: C.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.projectName}</div>
                                          <div style={{ ...colVal, color: C.textMid }}>{fmtH(alloc)}</div>
                                          <div style={{ ...colVal, color: C.text }}>{fmtH(actual)}</div>
                                          <div style={{ ...colVal, color: bill > 0 ? C.green : C.textSub }}>{fmtH(bill)}</div>
                                          <div style={{ ...colVal, color: nonBill > 0 ? C.textMid : C.textSub }}>{fmtH(nonBill)}</div>
                                          <div style={{ ...colVal, color: gapColor, fontWeight: 700 }}>{gap > 0 ? "+" : ""}{fmtH(gap)}</div>
                                        </div>
                                        {open && hasEntries && (
                                          <div style={{ borderBottom: `1px solid ${C.border}` }}>
                                            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 64px", padding: "4px 10px 4px 26px", fontSize: 9, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", background: C.alt, borderBottom: `1px solid ${C.border}` }}>
                                              <div>Date</div><div>Memo</div><div style={{ textAlign: "right" }}>Hours</div>
                                            </div>
                                            {proj.entries.map((entry: any) => (
                                              <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 64px", padding: "5px 10px 5px 26px", fontSize: 11, borderBottom: `1px solid ${C.border}`, alignItems: "center", background: C.surface }}>
                                                <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textSub }}>{fmtNSDate(entry.date)}</div>
                                                <div style={{ color: entry.memo ? C.text : C.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>{entry.memo || <em>no memo</em>}</div>
                                                <div style={{ fontFamily: C.mono, fontWeight: 600, fontSize: 11, color: C.text, textAlign: "right" }}>{fmtH(entry.hours)}</div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    );
                                  };

                                  const SectionHdr = ({ label, bg, color }: { label: string; bg: string; color: string }) => (
                                    <div style={{ padding: "5px 10px", background: bg, fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}` }}>{label}</div>
                                  );

                                  return (
                                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}>
                                      <div style={{ display: "grid", gridTemplateColumns: "16px 1fr 54px 54px 54px 54px 58px", gap: "0 4px", padding: "5px 10px", background: C.alt, borderBottom: `1px solid ${C.border}` }}>
                                        <div />
                                        <div style={{ ...colHdr, textAlign: "left" }}>Project</div>
                                        <div style={colHdr}>Alloc</div>
                                        <div style={colHdr}>Actual</div>
                                        <div style={colHdr}>Bill</div>
                                        <div style={colHdr}>Non-Bill</div>
                                        <div style={colHdr}>Gap</div>
                                      </div>
                                      {customerProjs.length > 0 && <>
                                        <SectionHdr label="Customer Projects" bg={C.alt} color={C.textMid} />
                                        {customerProjs.map((proj: any, i: number) => <ProjAllocRow key={i} proj={proj} />)}
                                      </>}
                                      {internalProjs.length > 0 && <>
                                        <SectionHdr label="Internal" bg={C.blueBg} color={C.blue} />
                                        {internalProjs.map((proj: any, i: number) => <ProjAllocRow key={i} proj={proj} />)}
                                      </>}
                                    </div>
                                  );
                                })()}
                              </div>

                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                  );
                }),
                ]);
              })()}
            </tbody>
          </table>
          <div style={{ padding: "8px 18px", borderTop: `1px solid ${C.border}`, background: C.alt, fontSize: 11, color: C.textSub }}>
            Click a row to expand project breakdown and allocation data · Expanded row also filters the chart below
          </div>
        </div>
      )}

      {/* Weekly trend chart */}
      {hasData && chartData.length > 0 && (
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
                {chartEmp ? `${chartEmp.employeeName} — Weekly Utilisation Trend` : "Team — Weekly Utilisation Trend"}
              </div>
              <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>Last 12 weeks · % of logged hours · dashed lines = targets</div>
            </div>
            {expandedEmp !== null && (
              <button onClick={() => setExpandedEmp(null)} style={{ fontSize: 11, color: C.textSub, border: `1px solid ${C.border}`, background: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: C.font }}>
                ✕ Show all
              </button>
            )}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: C.textSub }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: C.textSub }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={(val) => [`${val}%`]} contentStyle={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <ReferenceLine y={65} stroke={C.blue}   strokeDasharray="5 4" strokeWidth={1.5} />
              <ReferenceLine y={75} stroke={C.teal}   strokeDasharray="5 4" strokeWidth={1.5} />
              <ReferenceLine y={85} stroke={C.purple} strokeDasharray="5 4" strokeWidth={1.5} />
              <Bar dataKey="billable"   name="Billable %"   fill={C.blue}   radius={[3, 3, 0, 0]} />
              <Bar dataKey="utilized"   name="Utilized %"   fill={C.teal}   radius={[3, 3, 0, 0]} />
              <Bar dataKey="productive" name="Productive %"  fill={C.purple} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!hasData && !loading && !error && (
        <div style={{ textAlign: "center", padding: "48px 24px", color: C.textSub, fontSize: 14 }}>No time data found. Click Refresh to load.</div>
      )}
    </div>
  );
}
