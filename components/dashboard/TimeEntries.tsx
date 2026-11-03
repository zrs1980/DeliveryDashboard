"use client";
import { useState, useEffect, useMemo } from "react";
import { C } from "@/lib/constants";
import { mondayOf, toISODate } from "@/lib/status-report";
import type { Project } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimeEntry {
  id:           number;
  date:         string;   // YYYY-MM-DD
  projectId:    number;
  employeeId:   number;
  employeeName: string;
  taskName:     string | null;
  memo:         string;
  hours:        number;
}

type Period = "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "thisQuarter" | "lastQuarter" | "custom";

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "thisWeek",    label: "This week" },
  { id: "lastWeek",    label: "Last week" },
  { id: "thisMonth",   label: "This month" },
  { id: "lastMonth",   label: "Last month" },
  { id: "thisQuarter", label: "This quarter" },
  { id: "lastQuarter", label: "Last quarter" },
  { id: "custom",      label: "Custom" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inclusive [from, to] as local YYYY-MM-DD. Built from local date parts
 * throughout — toISOString() would shift every boundary a day for anyone east
 * of UTC. Weeks start Monday, matching Time Review and Resource Allocation.
 */
function periodRange(period: Exclude<Period, "custom">, now: Date): [string, string] {
  const y = now.getFullYear(), m = now.getMonth();
  const q = Math.floor(m / 3);
  const day = (yy: number, mm: number, dd: number) => toISODate(new Date(yy, mm, dd));
  switch (period) {
    case "thisWeek": {
      const mon = mondayOf(now);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return [toISODate(mon), toISODate(sun)];
    }
    case "lastWeek": {
      const mon = mondayOf(now); mon.setDate(mon.getDate() - 7);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return [toISODate(mon), toISODate(sun)];
    }
    case "thisMonth":   return [day(y, m, 1),         day(y, m + 1, 0)];
    case "lastMonth":   return [day(y, m - 1, 1),     day(y, m, 0)];
    case "thisQuarter": return [day(y, q * 3, 1),     day(y, q * 3 + 3, 0)];
    case "lastQuarter": return [day(y, q * 3 - 3, 1), day(y, q * 3, 0)];
  }
}

/** Two decimals, trailing zeros trimmed: 0.25 → "0.25h", 1.5 → "1.5h", 2 → "2h". */
function fmtHours(n: number): string {
  return `${Math.round(n * 100) / 100}h`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TimeEntries({ projects }: { projects: Project[] }) {
  const [period, setPeriod]           = useState<Period>("thisWeek");
  const [customFrom, setCustomFrom]   = useState("");
  const [customTo, setCustomTo]       = useState("");
  const [projectFilter, setProjectFilter]       = useState<number | null>(null);
  const [pmFilter, setPmFilter]                 = useState("");
  const [consultantFilter, setConsultantFilter] = useState<number | null>(null);

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

  // A custom range with a date missing or backwards has no answer, so nothing
  // is fetched for it rather than guessing — the hint under the inputs says why.
  const range: [string, string] | null = period === "custom"
    ? (customFrom && customTo && customFrom <= customTo ? [customFrom, customTo] : null)
    : periodRange(period, new Date());

  // Every project the tab shows, not just the filtered one: Project, PM and
  // Consultant all filter in the browser, so changing them needs no refetch.
  const projectIdsKey = projects.map(p => p.id).sort((a, b) => a - b).join(",");
  const rangeKey = range ? `${range[0]}..${range[1]}` : "";

  useEffect(() => {
    if (!rangeKey || !projectIdsKey) { setEntries([]); return; }
    const [from, to] = rangeKey.split("..");
    let cancelled = false;   // a slower earlier request must not overwrite a newer one
    setLoading(true); setError(null);
    fetch(`/api/time-entries?projectIds=${projectIdsKey}&from=${from}&to=${to}`)
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
        if (!cancelled) setEntries(data.entries ?? []);
      })
      .catch(e => { if (!cancelled) { setEntries([]); setError(e instanceof Error ? e.message : "Could not load time entries."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rangeKey, projectIdsKey]);

  // ── Filter options ──
  const projectOptions = useMemo(
    () => [...projects].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [projects],
  );
  const pmOptions = useMemo(
    () => [...new Set(projects.map(p => p.pm).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [projects],
  );
  // From the loaded entries, so the list only offers people with time in range.
  const consultantOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of entries) if (!seen.has(e.employeeId)) seen.set(e.employeeId, e.employeeName);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const visible = useMemo(() => entries.filter(e => {
    const p = projectById.get(e.projectId);
    if (projectFilter !== null && e.projectId !== projectFilter) return false;
    if (pmFilter && p?.pm !== pmFilter) return false;
    if (consultantFilter !== null && e.employeeId !== consultantFilter) return false;
    return true;
  }), [entries, projectById, projectFilter, pmFilter, consultantFilter]);

  const totalHours = visible.reduce((s, e) => s + e.hours, 0);

  // ── Styles ──
  const selectStyle: React.CSSProperties = {
    fontSize: 12, padding: "4px 8px", borderRadius: 5,
    border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.font,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", marginRight: 6,
  };
  const th: React.CSSProperties = {
    padding: "6px 10px", fontSize: 11, fontWeight: 700, color: C.textMid, textAlign: "left",
    textTransform: "uppercase", letterSpacing: "0.04em", background: C.alt,
    borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "7px 10px", fontSize: 12, color: C.text, borderBottom: `1px solid ${C.border}`, verticalAlign: "top",
  };

  return (
    <div style={{ fontFamily: C.font }}>
      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "14px 22px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Project</label>
          <select value={projectFilter ?? ""} onChange={e => setProjectFilter(e.target.value ? parseInt(e.target.value) : null)} style={selectStyle}>
            <option value="">All Projects</option>
            {projectOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>PM</label>
          <select value={pmFilter} onChange={e => setPmFilter(e.target.value)} style={selectStyle}>
            <option value="">All</option>
            {pmOptions.map(pm => <option key={pm} value={pm}>{pm}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Consultant</label>
          <select value={consultantFilter ?? ""} onChange={e => setConsultantFilter(e.target.value ? parseInt(e.target.value) : null)} style={selectStyle}>
            <option value="">All</option>
            {consultantOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Period</label>
          <select value={period} onChange={e => setPeriod(e.target.value as Period)} style={selectStyle}>
            {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>

        {period === "custom" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={selectStyle} />
            <span style={{ fontSize: 12, color: C.textSub }}>to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={selectStyle} />
            {!range && (
              <span style={{ fontSize: 11, color: customFrom && customTo ? C.red : C.textSub }}>
                {customFrom && customTo ? "End date is before start date" : "Pick both dates"}
              </span>
            )}
          </div>
        )}

        <div style={{ marginLeft: "auto", fontSize: 12, color: C.textSub }}>
          {range && <>{fmtDate(range[0])} – {fmtDate(range[1])} · </>}
          {visible.length} entries · <span style={{ fontFamily: C.mono, color: C.text, fontWeight: 600 }}>{fmtHours(totalHours)}</span>
        </div>
      </div>

      {/* ── Table ── */}
      {error ? (
        <div style={{ margin: 22, padding: "10px 12px", borderRadius: 6, fontSize: 12, background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red }}>
          Could not load time entries: {error}
        </div>
      ) : loading ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>Loading time entries…</div>
      ) : visible.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>
          {range ? "No time entries for these filters." : "Choose a date range."}
        </div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ ...th, width: 100 }}>Date</th>
                <th style={{ ...th, width: 220 }}>Project</th>
                <th style={{ ...th, width: 180 }}>Task / Phase</th>
                <th style={{ ...th, width: 140 }}>Consultant</th>
                <th style={th}>Description</th>
                <th style={{ ...th, width: 80, textAlign: "right" }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => {
                const p = projectById.get(e.projectId);
                return (
                  <tr key={e.id} style={{ background: i % 2 === 1 ? C.alt : C.surface }}>
                    <td style={{ ...td, whiteSpace: "nowrap", color: C.textMid }}>{fmtDate(e.date)}</td>
                    <td style={td}>{p?.label ?? `Project #${e.projectId}`}</td>
                    <td style={{ ...td, color: e.taskName ? C.text : C.textSub }}>{e.taskName ?? "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{e.employeeName}</td>
                    <td style={{ ...td, whiteSpace: "pre-wrap", wordBreak: "break-word", color: e.memo ? C.text : C.textSub }}>{e.memo || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: C.mono, whiteSpace: "nowrap" }}>{fmtHours(e.hours)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
