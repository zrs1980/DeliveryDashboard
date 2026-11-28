"use client";
import { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/constants";
import { isMilestone, startOfToday } from "@/lib/clickup";
import type { CUTask, Project } from "@/lib/types";
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

/**
 * Projects tab → Metrics/KPIs subtab. Implementation/Service projects only.
 *
 * Hours come from NetSuite (/api/metrics/hours, actual time only); deliverables
 * and on-time figures from the ClickUp tasks already on each Project. A
 * "deliverable" is a ClickUp milestone (isMilestone).
 */

type PeriodKey = "thisMonth" | "last3" | "last6" | "last12" | "ytd";

const PERIODS: Array<{ id: PeriodKey; label: string }> = [
  { id: "thisMonth", label: "This month" },
  { id: "last3",     label: "Last 3 months" },
  { id: "last6",     label: "Last 6 months" },
  { id: "last12",    label: "Last 12 months" },
  { id: "ytd",       label: "Year to date" },
];

/** Achieved = finished for real. Cancelled is finished but not achieved. */
const ACHIEVED  = new Set(["done", "complete", "completed", "closed"]);
const CANCELLED = new Set(["cancelled", "canceled"]);
const statusOf  = (t: CUTask) => t.status.status.trim().toLowerCase();
const isAchieved  = (t: CUTask) => ACHIEVED.has(statusOf(t));
const isCancelled = (t: CUTask) => CANCELLED.has(statusOf(t));

/** When the task was finished, in ms. date_done is set on "done"-type statuses, date_closed on closed ones. */
function finishedAt(t: CUTask): number | null {
  const v = t.date_done ?? t.date_closed;
  const n = v ? parseInt(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const isoDay   = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf    = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

/** Whole months, oldest first, ending with the current month. */
function periodMonths(p: PeriodKey): string[] {
  const now = new Date();
  const count = p === "thisMonth" ? 1 : p === "last3" ? 3 : p === "last6" ? 6 : p === "last12" ? 12 : now.getMonth() + 1;
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}

interface HoursRow { projectId: number; month: string; billable: number; nonBillable: number }

interface ProjectStats {
  project:        Project;
  hours:          number;
  billable:       number;
  delivDue:       number;
  delivAchieved:  number;
  finishedWithDue: number;
  onTime:         number;
  overdue:        number;
  hasTasks:       boolean;
}

type SortKey = "project" | "pm" | "budget" | "work" | "spi" | "deliv" | "hours" | "billPct" | "overdue";

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`);
const fmtH = (h: number) => h.toLocaleString("en-US", { maximumFractionDigits: 1 });

export function ProjectMetrics({ projects }: { projects: Project[] }) {
  const [period, setPeriod] = useState<PeriodKey>("last6");
  const [hoursRows, setHoursRows] = useState<HoursRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("project");
  const [sortAsc, setSortAsc] = useState(true);

  const months  = useMemo(() => periodMonths(period), [period]);
  const [fy, fm] = months[0].split("-").map(Number);
  const fromMs  = new Date(fy, fm - 1, 1).getTime();
  const todayMs = startOfToday();
  const from    = isoDay(new Date(fromMs));
  const to      = isoDay(new Date());
  const inPeriod = (ms: number | null) => ms !== null && ms >= fromMs && dayOf(ms) <= todayMs;

  const idsKey = projects.map(p => p.id).sort((a, b) => a - b).join(",");

  useEffect(() => {
    if (!idsKey) { setHoursRows([]); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/metrics/hours?projectIds=${idsKey}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then((d: { rows?: HoursRow[]; error?: string }) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        setHoursRows(d.rows ?? []);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load hours"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idsKey, from, to]);

  // ── Per-project figures ────────────────────────────────────────────────────
  const stats: ProjectStats[] = useMemo(() => projects.map(project => {
    const h = hoursRows.filter(r => r.projectId === project.id);
    const billable = h.reduce((s, r) => s + r.billable, 0);
    const hours    = billable + h.reduce((s, r) => s + r.nonBillable, 0);

    const tasks = project.tasks ?? [];
    // Deliverables due in the period (cancelled ones dropped from the total).
    const due = tasks.filter(t => isMilestone(t) && !isCancelled(t) && t.due_date && inPeriod(parseInt(t.due_date)));

    // On time: finished in the period, on or before its due DAY.
    const finished = tasks.filter(t => isAchieved(t) && t.due_date && inPeriod(finishedAt(t)));
    const onTime   = finished.filter(t => dayOf(finishedAt(t)!) <= dayOf(parseInt(t.due_date!))).length;

    const overdue = tasks.filter(t =>
      t.due_date && !isAchieved(t) && !isCancelled(t) && parseInt(t.due_date) < todayMs).length;

    return {
      project, hours, billable,
      delivDue: due.length,
      delivAchieved: due.filter(isAchieved).length,
      finishedWithDue: finished.length,
      onTime, overdue,
      hasTasks: tasks.length > 0,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projects, hoursRows, fromMs, todayMs]);

  // ── Portfolio totals ───────────────────────────────────────────────────────
  const tot = stats.reduce((a, s) => ({
    hours: a.hours + s.hours, billable: a.billable + s.billable,
    delivDue: a.delivDue + s.delivDue, delivAchieved: a.delivAchieved + s.delivAchieved,
    finishedWithDue: a.finishedWithDue + s.finishedWithDue, onTime: a.onTime + s.onTime,
    overdue: a.overdue + s.overdue,
  }), { hours: 0, billable: 0, delivDue: 0, delivAchieved: 0, finishedWithDue: 0, onTime: 0, overdue: 0 });

  // ── Chart data ─────────────────────────────────────────────────────────────
  const hoursChart = months.map(m => {
    const rs = hoursRows.filter(r => r.month === m);
    const billable    = rs.reduce((s, r) => s + r.billable, 0);
    const nonBillable = rs.reduce((s, r) => s + r.nonBillable, 0);
    return {
      month: monthLabel(m),
      billable:    Math.round(billable * 10) / 10,
      nonBillable: Math.round(nonBillable * 10) / 10,
      billablePct: pct(billable, billable + nonBillable),
    };
  });

  const delivChart = months.map(m => {
    const due = projects.flatMap(p => p.tasks ?? []).filter(t =>
      isMilestone(t) && !isCancelled(t) && t.due_date && monthKey(new Date(parseInt(t.due_date))) === m
      && dayOf(parseInt(t.due_date)) <= todayMs);
    return { month: monthLabel(m), due: due.length, achieved: due.filter(isAchieved).length };
  });

  // ── Table ──────────────────────────────────────────────────────────────────
  const sortVal = (s: ProjectStats): number | string => {
    switch (sortKey) {
      case "project": return s.project.label.toLowerCase();
      case "pm":      return s.project.pm.toLowerCase();
      case "budget":  return s.project.budget_hours > 0 ? s.project.burnRate : -1;
      case "work":    return s.project.pct;
      case "spi":     return s.project.budget_hours > 0 ? s.project.spi : 99;
      case "deliv":   return s.delivDue > 0 ? s.delivAchieved / s.delivDue : -1;
      case "hours":   return s.hours;
      case "billPct": return s.hours > 0 ? s.billable / s.hours : -1;
      case "overdue": return s.overdue;
    }
  };
  const rows = [...stats].sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return sortAsc ? c : -c;
  });
  const clickSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc(a => !a);
    else { setSortKey(k); setSortAsc(k === "project" || k === "pm" || k === "spi"); }
  };

  const spiColor = (v: number) => (v < 0.8 ? C.red : v < 0.95 ? C.yellow : C.green);

  const card: React.CSSProperties = {
    flex: "1 1 160px", background: C.alt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px",
  };
  const th: React.CSSProperties = {
    padding: "8px 10px", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase",
    textAlign: "left", borderBottom: `1px solid ${C.border}`, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
  };
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: 12, color: C.textMid, borderBottom: `1px solid ${C.border}` };
  const num: React.CSSProperties = { ...td, fontFamily: C.mono, textAlign: "right" };
  const Th = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th style={{ ...th, textAlign: right ? "right" : "left" }} onClick={() => clickSort(k)}>
      {label}{sortKey === k ? (sortAsc ? " ▲" : " ▼") : ""}
    </th>
  );

  const Kpi = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const chartBox: React.CSSProperties = {
    flex: "1 1 420px", minWidth: 0, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px",
  };
  const tooltipStyle = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 };

  return (
    <div style={{ padding: "16px 22px 22px" }}>
      {/* Period */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase" }}>Period</span>
        <select value={period} onChange={e => setPeriod(e.target.value as PeriodKey)}
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.font }}>
          {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <span style={{ fontSize: 12, color: C.textSub }}>
          {from} → {to}{loading ? " · loading hours…" : ""}
        </span>
        {error && <span style={{ fontSize: 12, color: C.red }}>Hours could not be loaded: {error}</span>}
      </div>

      {/* KPI cards */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Kpi label="Hours logged" value={fmtH(tot.hours)} sub={`${fmtH(tot.billable)} billable · ${fmtH(tot.hours - tot.billable)} non-billable`} />
        <Kpi label="Billable %" value={fmtPct(pct(tot.billable, tot.hours))} sub="of hours logged in the period" />
        <Kpi label="Deliverables achieved" value={`${tot.delivAchieved} / ${tot.delivDue}`}
          sub={tot.delivDue ? `${pct(tot.delivAchieved, tot.delivDue)}% of milestones due in the period` : "no milestones due in the period"} />
        <Kpi label="On-time %" value={fmtPct(pct(tot.onTime, tot.finishedWithDue))}
          sub={`${tot.onTime} of ${tot.finishedWithDue} tasks finished by their due date`} />
        <Kpi label="Overdue tasks" value={String(tot.overdue)} sub="open tasks past their due date, today" />
      </div>

      {/* Charts */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={chartBox}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Billable vs non-billable hours</div>
          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2, marginBottom: 8 }}>Per month · line = billable % (right axis)</div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={hoursChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.textSub }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="h" tick={{ fontSize: 11, fill: C.textSub }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tickFormatter={v => `${v}%`}
                tick={{ fontSize: 11, fill: C.textSub }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle}
                formatter={(v, name) => [name === "Billable %" ? `${v ?? "—"}%` : `${v} h`, name]} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
              <Bar yAxisId="h" dataKey="billable"    name="Billable"     stackId="h" fill={C.blue} />
              <Bar yAxisId="h" dataKey="nonBillable" name="Non-billable" stackId="h" fill="#94A3B8" radius={[3, 3, 0, 0]} />
              <Line yAxisId="p" dataKey="billablePct" name="Billable %" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={chartBox}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Deliverables due vs achieved</div>
          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2, marginBottom: 8 }}>ClickUp milestones, by due month (up to today)</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={delivChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.textSub }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.textSub }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
              <Bar dataKey="due"      name="Due"      fill={C.mid}    radius={[3, 3, 0, 0]} />
              <Bar dataKey="achieved" name="Achieved" fill={C.purple} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-project table */}
      <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
          <thead style={{ background: C.alt }}>
            <tr>
              <Th k="project" label="Project" />
              <Th k="pm"      label="PM" />
              <Th k="budget"  label="Budget used" right />
              <Th k="work"    label="Work done" right />
              <Th k="spi"     label="Schedule index" right />
              <Th k="deliv"   label="Deliverables" right />
              <Th k="hours"   label="Hours" right />
              <Th k="billPct" label="Billable %" right />
              <Th k="overdue" label="Overdue" right />
            </tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const p = s.project;
              const hasBudget = p.budget_hours > 0;
              return (
                <tr key={p.id}>
                  <td style={td}>
                    <div style={{ color: C.text, fontWeight: 600 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: C.textSub }}>{p.projectType}</div>
                  </td>
                  <td style={td}>{p.pm}</td>
                  <td style={num} title={hasBudget ? `${fmtH(p.actual)} of ${fmtH(p.budget_hours)} h` : "No budget set"}>
                    {hasBudget ? `${Math.round(p.burnRate * 100)}%` : "—"}
                  </td>
                  <td style={num} title={p.clickupError ?? undefined}>{s.hasTasks ? `${Math.round(p.pct * 100)}%` : "—"}</td>
                  <td style={{ ...num, color: hasBudget && s.hasTasks ? spiColor(p.spi) : C.textSub, fontWeight: 600 }}
                    title="Work done ÷ budget used. Below 1 = burning hours faster than delivering.">
                    {hasBudget && s.hasTasks ? p.spi.toFixed(2) : "—"}
                  </td>
                  <td style={num}>{s.delivDue ? `${s.delivAchieved} / ${s.delivDue}` : "—"}</td>
                  <td style={num}>{fmtH(s.hours)}</td>
                  <td style={num}>{fmtPct(pct(s.billable, s.hours))}</td>
                  <td style={{ ...num, color: s.overdue ? C.red : C.textMid, fontWeight: s.overdue ? 600 : 400 }}>{s.overdue}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, textAlign: "center", padding: 24, color: C.textSub }}>No projects match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: C.textSub, marginTop: 8 }}>
        Budget used and Work done are project-to-date; Deliverables, Hours and Billable % cover the period. Deliverables = ClickUp milestones due in the period that are done/complete/completed/closed (cancelled ones are left out). Hours are NetSuite actual time.
      </div>
    </div>
  );
}
