"use client";
import { useState, useEffect, useMemo } from "react";
import { C } from "@/lib/constants";
import { mondayOf, toISODate } from "@/lib/status-report";
import { buildXlsx, downloadXlsx, type XlsxCell, type XlsxColumn } from "@/lib/xlsx";
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
  isBillable:   boolean;
  isUtilized:   boolean;
  isProductive: boolean;
  approvalStatus: string;   // NetSuite's label, e.g. "Approved" / "Pending Approval"
}

/** Entries over this many hours have their duration in bold. */
const LONG_ENTRY_HOURS = 5;

/** What Approve Time will act on — anything not already approved, and never a rejected entry. */
const isApprovable = (e: TimeEntry) => {
  const s = e.approvalStatus.toLowerCase();
  return s !== "approved" && s !== "rejected";
};

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

/** ✓ / – for a flag. Neutral colours: a yes/no classification is not RAG. */
function Check({ on }: { on: boolean }) {
  return on
    ? <span style={{ color: C.blue, fontWeight: 700 }}>✓</span>
    : <span style={{ color: C.mid }}>–</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TimeEntries({ projects }: { projects: Project[] }) {
  const [period, setPeriod]           = useState<Period>("thisWeek");
  const [customFrom, setCustomFrom]   = useState("");
  const [customTo, setCustomTo]       = useState("");
  const [projectFilter, setProjectFilter]       = useState<number | null>(null);
  const [pmFilter, setPmFilter]                 = useState("");
  const [consultantFilter, setConsultantFilter] = useState<number | null>(null);

  const [showClass, setShowClass] = useState(false);

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const [approving, setApproving]     = useState(false);
  const [approveResult, setApproveResult] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);

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
  const approvable = visible.filter(isApprovable);

  // ── Export ──
  // Exactly what is on screen: the filtered rows, and the B/U/P columns only
  // when they are showing.
  function exportXlsx() {
    const columns: XlsxColumn[] = [
      { header: "Date", width: 12 },
      { header: "Project", width: 40 },
      { header: "Task / Phase", width: 28 },
      { header: "Consultant", width: 22 },
      { header: "Description", width: 60 },
      { header: "Duration (h)", width: 12, numFmt: "0.00" },
      ...(showClass ? [
        { header: "Billable", width: 10 },
        { header: "Utilized", width: 10 },
        { header: "Productive", width: 11 },
      ] : []),
      { header: "Status", width: 18 },
    ];
    const yn = (b: boolean) => (b ? "Yes" : "No");
    const rows: XlsxCell[][] = visible.map(e => [
      e.date,
      projectById.get(e.projectId)?.label ?? `Project #${e.projectId}`,
      e.taskName ?? "",
      e.employeeName,
      e.memo,
      e.hours,
      ...(showClass ? [yn(e.isBillable), yn(e.isUtilized), yn(e.isProductive)] : []),
      e.approvalStatus,
    ]);
    const suffix = range ? `${range[0]}_to_${range[1]}` : "export";
    downloadXlsx(`time-entries_${suffix}.xlsx`, buildXlsx("Time Entries", columns, rows));
  }

  // ── Approve ──
  async function approveTime() {
    if (approving || approvable.length === 0) return;
    const hrs = approvable.reduce((s, e) => s + e.hours, 0);
    const skippedRejected = visible.filter(e => e.approvalStatus.toLowerCase() === "rejected").length;
    const ok = window.confirm(
      `Approve ${approvable.length} time ${approvable.length === 1 ? "entry" : "entries"} (${fmtHours(hrs)}) in NetSuite?\n\n` +
      `This is every entry currently shown that is not already approved.` +
      (skippedRejected ? `\n${skippedRejected} rejected ${skippedRejected === 1 ? "entry is" : "entries are"} left alone.` : ""),
    );
    if (!ok) return;

    setApproving(true); setApproveResult(null);
    try {
      const res  = await fetch("/api/time-entries/approve", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ids: approvable.map(e => e.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);

      const approvedIds = new Set<number>(data.approved ?? []);
      setEntries(prev => prev.map(e => approvedIds.has(e.id) ? { ...e, approvalStatus: "Approved" } : e));

      const failed  = (data.failed  ?? []) as Array<{ id: number; error: string }>;
      const skipped = (data.skipped ?? []) as Array<{ id: number; reason: string }>;
      const parts = [`Approved ${approvedIds.size} ${approvedIds.size === 1 ? "entry" : "entries"}.`];
      if (skipped.length) parts.push(`${skipped.length} skipped (${[...new Set(skipped.map(s => s.reason))].join("; ")}).`);
      if (failed.length)  parts.push(`${failed.length} failed — NetSuite said: ${failed[0].error}`);
      setApproveResult({ kind: failed.length ? (approvedIds.size ? "warn" : "error") : "ok", text: parts.join(" ") });
    } catch (e) {
      setApproveResult({ kind: "error", text: e instanceof Error ? e.message : "Approval failed." });
    } finally {
      setApproving(false);
    }
  }

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
  const btnStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, fontFamily: C.font, padding: "5px 11px", borderRadius: 6,
    background: C.surface, color: C.textMid, border: `1px solid ${C.border}`, whiteSpace: "nowrap",
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

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={showClass} onChange={e => setShowClass(e.target.checked)} style={{ cursor: "pointer" }} />
          Show billable, utilized and productive?
        </label>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: C.textSub }}>
            {range && <>{fmtDate(range[0])} – {fmtDate(range[1])} · </>}
            {visible.length} entries · <span style={{ fontFamily: C.mono, color: C.text, fontWeight: 600 }}>{fmtHours(totalHours)}</span>
          </span>
          <button
            onClick={exportXlsx}
            disabled={visible.length === 0}
            title="Download the entries shown as an Excel file"
            style={{ ...btnStyle, opacity: visible.length === 0 ? 0.5 : 1, cursor: visible.length === 0 ? "default" : "pointer" }}
          >
            ⬇ Export to Excel
          </button>
          <button
            onClick={approveTime}
            disabled={approving || approvable.length === 0}
            title={approvable.length === 0 ? "Nothing shown is waiting for approval" : `Approve ${approvable.length} entries in NetSuite`}
            style={{
              ...btnStyle,
              background: C.blue, color: "#fff", border: `1px solid ${C.blue}`,
              opacity: approving || approvable.length === 0 ? 0.5 : 1,
              cursor: approving || approvable.length === 0 ? "default" : "pointer",
            }}
          >
            {approving ? "Approving…" : `✓ Approve Time${approvable.length ? ` (${approvable.length})` : ""}`}
          </button>
        </div>
      </div>

      {approveResult && (
        <div style={{
          margin: "12px 22px 0", padding: "8px 11px", borderRadius: 6, fontSize: 12,
          display: "flex", justifyContent: "space-between", gap: 12,
          background: approveResult.kind === "ok" ? C.greenBg : approveResult.kind === "warn" ? C.yellowBg : C.redBg,
          border: `1px solid ${approveResult.kind === "ok" ? C.greenBd : approveResult.kind === "warn" ? C.yellowBd : C.redBd}`,
          color: approveResult.kind === "ok" ? C.green : approveResult.kind === "warn" ? C.yellow : C.red,
        }}>
          <span style={{ wordBreak: "break-word" }}>{approveResult.text}</span>
          <button onClick={() => setApproveResult(null)} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 14, lineHeight: 1 }}>×</button>
        </div>
      )}

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
                {showClass && <>
                  <th style={{ ...th, width: 70, textAlign: "center" }}>Billable</th>
                  <th style={{ ...th, width: 70, textAlign: "center" }}>Utilized</th>
                  <th style={{ ...th, width: 84, textAlign: "center" }}>Productive</th>
                </>}
                <th style={{ ...th, width: 120 }}>Status</th>
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
                    <td style={{
                      ...td, textAlign: "right", fontFamily: C.mono, whiteSpace: "nowrap",
                      fontWeight: e.hours > LONG_ENTRY_HOURS ? 700 : 400,
                    }}>
                      {fmtHours(e.hours)}
                    </td>
                    {showClass && <>
                      <td style={{ ...td, textAlign: "center" }}><Check on={e.isBillable} /></td>
                      <td style={{ ...td, textAlign: "center" }}><Check on={e.isUtilized} /></td>
                      <td style={{ ...td, textAlign: "center" }}><Check on={e.isProductive} /></td>
                    </>}
                    <td style={{ ...td, whiteSpace: "nowrap", color: e.approvalStatus.toLowerCase() === "approved" ? C.textMid : C.text }}>
                      {e.approvalStatus || "—"}
                    </td>
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
