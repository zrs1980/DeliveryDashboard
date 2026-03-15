"use client";
import { useState, useEffect } from "react";
import { C } from "@/lib/constants";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

type PeriodKey = "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";

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

interface ProjectBreakdown {
  projectId: number | null;
  projectName: string;
  companyName: string;
  total: number;
  billable: number;
  utilized: number;
  productive: number;
  billablePct: number;
}

interface EmployeeTimeData {
  employeeId: number;
  employeeName: string;
  periods: Record<PeriodKey, PeriodMetrics>;
  weeklyTrend: WeekPoint[];
  projectBreakdown: Record<PeriodKey, ProjectBreakdown[]>;
}

interface AiState { loading: boolean; text: string | null; error: string | null; }

const PERIOD_LABELS: Record<PeriodKey, string> = {
  thisWeek: "This Week", lastWeek: "Last Week",
  thisMonth: "This Month", lastMonth: "Last Month",
};
const TARGETS = { billable: 0.65, utilized: 0.75, productive: 0.85 };

function fmtH(n: number) { return n % 1 === 0 ? `${n}h` : `${n.toFixed(1)}h`; }
function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }

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

// Render AI text the same way as AiInsights — bullet lines get a → prefix
function AiText({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.65, color: "#CBD5E1" }}>
      {text.split("\n").filter(l => l.trim()).map((line, i) => {
        const isBullet = /^[-•*]|\d+\./.test(line.trim());
        const isHeader = line.trim().endsWith(":") || /\*\*.*\*\*/.test(line);
        const clean = line.replace(/\*\*/g, "").trim();
        if (isHeader) return (
          <div key={i} style={{ fontWeight: 700, color: "#F1F5F9", marginTop: 10, marginBottom: 2 }}>{clean}</div>
        );
        if (isBullet) return (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4, paddingLeft: 4 }}>
            <span style={{ color: "#60A5FA", fontWeight: 700, flexShrink: 0 }}>→</span>
            <span>{clean.replace(/^[-•*]\s*/, "")}</span>
          </div>
        );
        return <div key={i} style={{ marginBottom: 4 }}>{clean}</div>;
      })}
    </div>
  );
}

export function TimeAnalysis() {
  const [employees, setEmployees] = useState<EmployeeTimeData[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [period, setPeriod]       = useState<PeriodKey>("thisMonth");
  const [expandedEmp, setExpandedEmp] = useState<number | null>(null);
  const [aiStates, setAiStates]   = useState<Record<number, AiState>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/time-analysis");
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setEmployees(json.employees ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function getAiAnalysis(emp: EmployeeTimeData) {
    setAiStates(s => ({ ...s, [emp.employeeId]: { loading: true, text: null, error: null } }));
    try {
      const res = await fetch("/api/time-analysis/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeName:     emp.employeeName,
          periodLabel:      PERIOD_LABELS[period],
          metrics:          emp.periods[period],
          projectBreakdown: emp.projectBreakdown[period] ?? [],
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setAiStates(s => ({ ...s, [emp.employeeId]: { loading: false, text: json.text, error: null } }));
    } catch (e) {
      setAiStates(s => ({ ...s, [emp.employeeId]: { loading: false, text: null, error: e instanceof Error ? e.message : "Unknown error" } }));
    }
  }

  // ── Team totals ──────────────────────────────────────────────────────────
  const active = employees.filter(e => e.periods[period].total > 0);
  const teamTotals = active.reduce(
    (acc, e) => { acc.total += e.periods[period].total; acc.billable += e.periods[period].billable; acc.utilized += e.periods[period].utilized; acc.productive += e.periods[period].productive; return acc; },
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: C.font, background: period === p ? C.blue : "transparent", color: period === p ? "#fff" : C.textMid, border: `1px solid ${period === p ? C.blue : C.border}`, borderRadius: 7, cursor: "pointer", transition: "all 0.15s" }}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
          <button onClick={load} disabled={loading} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: C.font, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 7, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "↻ Loading…" : "↻ Refresh"}
          </button>
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
              {employees.map((emp, i) => {
                const p          = emp.periods[period];
                const isExpanded = expandedEmp === emp.employeeId;
                const initials   = emp.employeeName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                const ai         = aiStates[emp.employeeId];
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
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

                              {/* ── Left: Project breakdown ── */}
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12 }}>
                                  Project Breakdown <span style={{ fontWeight: 400, color: C.textSub, fontSize: 11 }}>— {PERIOD_LABELS[period]}</span>
                                </div>
                                {(emp.projectBreakdown[period] ?? []).length === 0 ? (
                                  <div style={{ color: C.textSub, fontSize: 13 }}>No project data for this period.</div>
                                ) : (
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                    <thead>
                                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                                        <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, fontSize: 10, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>Project</th>
                                        <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600, fontSize: 10, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>Hours</th>
                                        <th style={{ padding: "6px 8px", fontWeight: 600, fontSize: 10, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 140 }}>Billable %</th>
                                        <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600, fontSize: 10, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>Non-bill</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(emp.projectBreakdown[period] ?? []).map((proj, pi) => {
                                        const nonBill = proj.total - proj.billable;
                                        const isInternal = !proj.projectId;
                                        return (
                                          <tr key={pi} style={{ borderBottom: `1px solid ${C.border}`, background: pi % 2 === 0 ? "#fff" : C.alt }}>
                                            <td style={{ padding: "7px 8px", maxWidth: 200 }}>
                                              <div style={{ fontWeight: 600, color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.companyName}</div>
                                              {proj.projectId && <div style={{ fontSize: 10, color: C.textSub }}>{proj.projectName.split("—")[1]?.trim() ?? ""}</div>}
                                              {isInternal && <div style={{ fontSize: 10, color: C.orange, fontWeight: 600 }}>Internal / Admin</div>}
                                            </td>
                                            <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: C.mono, fontWeight: 700, color: C.text }}>{fmtH(proj.total)}</td>
                                            <td style={{ padding: "7px 8px" }}><PctBar value={proj.billablePct} target={TARGETS.billable} color={C.blue} slim /></td>
                                            <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: C.mono, fontSize: 11, color: nonBill > 0 ? C.red : C.textSub }}>{nonBill > 0 ? fmtH(nonBill) : "—"}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}

                                {/* Gap summary cards */}
                                {p.total > 0 && (
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
                                    {[
                                      { label: "Non-billable", hours: p.total - p.billable, gap: TARGETS.billable - p.billablePct, color: C.blue },
                                      { label: "Non-utilized", hours: p.total - p.utilized, gap: TARGETS.utilized - p.utilizedPct, color: C.teal },
                                      { label: "Non-productive", hours: p.total - p.productive, gap: TARGETS.productive - p.productivePct, color: C.purple },
                                    ].map(g => (
                                      <div key={g.label} style={{ background: g.gap > 0 ? C.redBg : C.greenBg, border: `1px solid ${g.gap > 0 ? C.redBd : C.greenBd}`, borderRadius: 8, padding: "10px 12px" }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: g.gap > 0 ? C.red : C.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{g.label}</div>
                                        <div style={{ fontFamily: C.mono, fontWeight: 800, fontSize: 16, color: g.gap > 0 ? C.red : C.green }}>{fmtH(g.hours)}</div>
                                        <div style={{ fontSize: 10, color: g.gap > 0 ? C.red : C.green, opacity: 0.8 }}>{g.gap > 0 ? `${Math.round(g.gap * 100)}pp below target` : "On target"}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* ── Right: AI Analysis ── */}
                              <div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>AI Analysis</div>
                                  <button
                                    onClick={e => { e.stopPropagation(); getAiAnalysis(emp); }}
                                    disabled={ai?.loading}
                                    style={{ padding: "5px 14px", fontSize: 11, fontWeight: 700, fontFamily: C.font, background: ai?.loading ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #1A56DB, #2563EB)", color: "#fff", border: "none", borderRadius: 7, cursor: ai?.loading ? "not-allowed" : "pointer", opacity: ai?.loading ? 0.7 : 1 }}
                                  >
                                    {ai?.loading ? "↻ Analysing…" : ai?.text ? "↻ Refresh" : "✦ Get Analysis"}
                                  </button>
                                </div>

                                <div style={{ background: "linear-gradient(135deg, #0F172A, #1A3052)", borderRadius: 10, padding: "16px 18px", minHeight: 180 }}>
                                  {!ai && (
                                    <div style={{ color: "#64748B", fontSize: 13, textAlign: "center", paddingTop: 40 }}>
                                      Click <strong style={{ color: "#93C5FD" }}>Get Analysis</strong> to understand why {emp.employeeName.split(" ")[0]} is{" "}
                                      {p.billablePct < TARGETS.billable ? "missing billable targets" : p.utilizedPct < TARGETS.utilized ? "under-utilized" : "not hitting productive targets"} and what to do about it.
                                    </div>
                                  )}
                                  {ai?.loading && (
                                    <div style={{ color: "#64748B", fontSize: 13, textAlign: "center", paddingTop: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                                      <div style={{ width: 20, height: 20, border: "3px solid rgba(255,255,255,0.15)", borderTopColor: "#60A5FA", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                                      Analysing time data…
                                    </div>
                                  )}
                                  {ai?.error && <div style={{ color: "#F87171", fontSize: 12 }}>⚠ {ai.error}</div>}
                                  {ai?.text && <AiText text={ai.text} />}
                                </div>
                              </div>

                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "8px 18px", borderTop: `1px solid ${C.border}`, background: C.alt, fontSize: 11, color: C.textSub }}>
            Click a row to expand project breakdown and AI analysis · Expanded row also filters the chart below
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
