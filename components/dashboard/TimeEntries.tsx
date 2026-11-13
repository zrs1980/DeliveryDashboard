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

/** What this section needs of a project — Active Projects, MSAs and Internal projects all supply it. */
type EntryProject = Pick<Project, "id" | "label" | "pm"> & { internal?: boolean };

/** Type filter: Internal = NetSuite "Internal" jobtype; External = everything else. */
type TypeFilter = "all" | "internal" | "external";

const matchesType = (p: EntryProject | undefined, t: TypeFilter) =>
  t === "all" || (t === "internal") === (p?.internal === true);

/**
 * Status filter. Pending = anything Approve Time can act on (not approved, not
 * rejected) — in practice NetSuite's "Pending Approval", the only other status
 * in use (checked Nov 2026). A rejected entry shows under All only.
 */
type StatusFilter = "all" | "pending" | "approved";

const matchesStatus = (e: TimeEntry, s: StatusFilter) =>
  s === "all" ||
  (s === "approved" ? e.approvalStatus.toLowerCase() === "approved" : isApprovable(e));

type SortKey = "date" | "project" | "task" | "consultant" | "memo" | "hours"
             | "billable" | "utilized" | "productive" | "status";
type SortDir = "asc" | "desc";

/** First click on a column: dates and numbers newest/largest first, text A→Z. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  date: "desc", hours: "desc", billable: "desc", utilized: "desc", productive: "desc",
  project: "asc", task: "asc", consultant: "asc", memo: "asc", status: "asc",
};

export function TimeEntries({ projects: activeProjects }: { projects: Project[] }) {
  // Managed Services Agreements aren't in Active Projects (that list is
  // Implementation/Service jobs only), so they're loaded here from /api/msa —
  // the same In-Progress MSA list the Customers tab uses. They have no PM.
  const [msaProjects, setMsaProjects] = useState<EntryProject[]>([]);
  useEffect(() => {
    fetch("/api/msa")
      .then(r => r.json())
      .then((d: { projects?: Array<{ id: number; projectName: string; customerName: string }> }) => {
        setMsaProjects((d.projects ?? []).map(m => ({
          id:    m.id,
          label: m.customerName && m.customerName !== m.projectName
            ? `${m.customerName} — ${m.projectName}`
            : m.projectName,
          pm:    "",
        })));
      })
      // Non-fatal: the section still works for Active Projects without them.
      .catch(e => console.warn("[Time Entries] could not load MSA projects:", e));
  }, []);

  // Internal projects (admin, PTO, meetings, …) aren't in Active Projects either.
  // Labelled "Internal — …" so they group together in the Project filter.
  const [internalProjects, setInternalProjects] = useState<EntryProject[]>([]);
  useEffect(() => {
    fetch("/api/internal-projects")
      .then(r => r.json())
      .then((d: { projects?: Array<{ id: number; projectName: string; pm: string }> }) => {
        setInternalProjects((d.projects ?? []).map(p => ({
          id:    p.id,
          label: `Internal — ${p.projectName}`,
          pm:    p.pm,
          internal: true,
        })));
      })
      .catch(e => console.warn("[Time Entries] could not load internal projects:", e));
  }, []);

  const projects: EntryProject[] = useMemo(() => {
    const seen = new Set(activeProjects.map(p => p.id));
    const extra = [...msaProjects, ...internalProjects].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    return [...activeProjects, ...extra];
  }, [activeProjects, msaProjects, internalProjects]);

  const [period, setPeriod]           = useState<Period>("thisWeek");
  const [customFrom, setCustomFrom]   = useState("");
  const [customTo, setCustomTo]       = useState("");
  const [typeFilter, setTypeFilter]             = useState<TypeFilter>("all");
  const [projectFilter, setProjectFilter]       = useState<number | null>(null);
  const [pmFilter, setPmFilter]                 = useState("");
  const [consultantFilter, setConsultantFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter]         = useState<StatusFilter>("all");

  const [showClass, setShowClass] = useState(false);

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const [approving, setApproving]     = useState(false);
  const [selected, setSelected]       = useState<Set<number>>(new Set());
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
  // Project and PM lists follow the Type filter, so they only offer what can match.
  const typedProjects = useMemo(() => projects.filter(p => matchesType(p, typeFilter)), [projects, typeFilter]);
  const projectOptions = useMemo(
    () => [...typedProjects].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [typedProjects],
  );
  const pmOptions = useMemo(
    () => [...new Set(typedProjects.map(p => p.pm).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [typedProjects],
  );

  // Changing type clears a Project/PM pick that the new type no longer offers,
  // rather than leaving a hidden filter that shows nothing.
  function changeType(t: TypeFilter) {
    setTypeFilter(t);
    if (projectFilter !== null && !matchesType(projectById.get(projectFilter), t)) setProjectFilter(null);
    if (pmFilter && !projects.some(p => p.pm === pmFilter && matchesType(p, t))) setPmFilter("");
  }
  // From the loaded entries, so the list only offers people with time in range.
  const consultantOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const e of entries) if (!seen.has(e.employeeId)) seen.set(e.employeeId, e.employeeName);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const visible = useMemo(() => entries.filter(e => {
    const p = projectById.get(e.projectId);
    if (!matchesType(p, typeFilter)) return false;
    if (projectFilter !== null && e.projectId !== projectFilter) return false;
    if (pmFilter && p?.pm !== pmFilter) return false;
    if (consultantFilter !== null && e.employeeId !== consultantFilter) return false;
    if (!matchesStatus(e, statusFilter)) return false;
    return true;
  }), [entries, projectById, typeFilter, projectFilter, pmFilter, consultantFilter, statusFilter]);

  // ── Sorting ── Starts newest first, the order the API returns. Ties fall back
  // to date then id (newest first), so equal rows keep a stable order.
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  }

  const sorted = useMemo(() => {
    const text = (s: string) => s.toLowerCase();
    const val = (e: TimeEntry): string | number => {
      switch (sortKey) {
        case "date":       return e.date;
        case "project":    return text(projectById.get(e.projectId)?.label ?? "");
        case "task":       return text(e.taskName ?? "");
        case "consultant": return text(e.employeeName);
        case "memo":       return text(e.memo);
        case "hours":      return e.hours;
        case "billable":   return e.isBillable ? 1 : 0;
        case "utilized":   return e.isUtilized ? 1 : 0;
        case "productive": return e.isProductive ? 1 : 0;
        case "status":     return text(e.approvalStatus);
      }
    };
    const sign = sortDir === "asc" ? 1 : -1;
    return [...visible].sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
      if (cmp !== 0) return cmp * sign;
      return b.date.localeCompare(a.date) || b.id - a.id;
    });
  }, [visible, sortKey, sortDir, projectById]);

  const totalHours = visible.reduce((s, e) => s + e.hours, 0);
  const approvable = visible.filter(isApprovable);

  // Row checkboxes. Only entries still awaiting approval can be ticked. The
  // selection is intersected with what's shown, so a ticked entry hidden by a
  // filter change is never approved unseen.
  const selectedShown = approvable.filter(e => selected.has(e.id));
  // Ticked entries win; with none ticked the button approves everything shown.
  const toApprove     = selectedShown.length ? selectedShown : approvable;
  const allTicked     = approvable.length > 0 && selectedShown.length === approvable.length;

  function toggleEntry(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allTicked ? new Set() : new Set(approvable.map(e => e.id)));
  }

  // ── Export ──
  // Exactly what is on screen: the filtered rows in their current sort order,
  // and the B/U/P columns only when they are showing.
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
    const rows: XlsxCell[][] = sorted.map(e => [
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
    if (approving || toApprove.length === 0) return;
    const hrs = toApprove.reduce((s, e) => s + e.hours, 0);
    const skippedRejected = visible.filter(e => e.approvalStatus.toLowerCase() === "rejected").length;
    const ok = window.confirm(
      `Approve ${toApprove.length} time ${toApprove.length === 1 ? "entry" : "entries"} (${fmtHours(hrs)}) in NetSuite?\n\n` +
      (selectedShown.length
        ? `These are the entries you ticked.`
        : `This is every entry currently shown that is not already approved.` +
          (skippedRejected ? `\n${skippedRejected} rejected ${skippedRejected === 1 ? "entry is" : "entries are"} left alone.` : "")),
    );
    if (!ok) return;

    setApproving(true); setApproveResult(null);
    try {
      const res  = await fetch("/api/time-entries/approve", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ids: toApprove.map(e => e.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);

      const approvedIds = new Set<number>(data.approved ?? []);
      setEntries(prev => prev.map(e => approvedIds.has(e.id) ? { ...e, approvalStatus: "Approved" } : e));
      // Untick what went through; anything that failed stays ticked for a retry.
      setSelected(prev => new Set([...prev].filter(id => !approvedIds.has(id))));

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

  /** A clickable column header: ▲/▼ on the active column, a faint ↕ on the rest. */
  const sortTh = (key: SortKey, label: string, style?: React.CSSProperties) => {
    const active = sortKey === key;
    return (
      <th
        onClick={() => handleSort(key)}
        title={`Sort by ${label.toLowerCase()}`}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        style={{ ...th, ...style, cursor: "pointer", userSelect: "none", color: active ? C.text : th.color }}
      >
        {label}
        <span style={{ marginLeft: 4, fontSize: 9, color: active ? C.blue : C.mid }}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </th>
    );
  };

  return (
    <div style={{ fontFamily: C.font }}>
      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "14px 22px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Type</label>
          <select value={typeFilter} onChange={e => changeType(e.target.value as TypeFilter)} style={selectStyle}>
            <option value="all">All</option>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </div>

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
          <label style={labelStyle}>Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} style={selectStyle}>
            <option value="all">All</option>
            <option value="pending">Pending Approval</option>
            <option value="approved">Approved</option>
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
            disabled={approving || toApprove.length === 0}
            title={
              toApprove.length === 0 ? "Nothing shown is waiting for approval"
              : selectedShown.length ? `Approve the ${toApprove.length} ticked entries in NetSuite`
              : `Approve all ${toApprove.length} entries shown in NetSuite (tick entries to approve only those)`
            }
            style={{
              ...btnStyle,
              background: C.blue, color: "#fff", border: `1px solid ${C.blue}`,
              opacity: approving || toApprove.length === 0 ? 0.5 : 1,
              cursor: approving || toApprove.length === 0 ? "default" : "pointer",
            }}
          >
            {approving ? "Approving…"
              : selectedShown.length ? `✓ Approve Selected (${selectedShown.length})`
              : `✓ Approve Time${approvable.length ? ` (${approvable.length})` : ""}`}
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
                <th style={{ ...th, width: 28, textAlign: "center", padding: "6px 4px 6px 10px" }}>
                  <input
                    type="checkbox"
                    checked={allTicked}
                    ref={el => { if (el) el.indeterminate = selectedShown.length > 0 && !allTicked; }}
                    disabled={approvable.length === 0 || approving}
                    onChange={toggleAll}
                    title={allTicked ? "Untick all" : "Tick every entry awaiting approval"}
                    aria-label="Select all entries awaiting approval"
                    style={{ cursor: approvable.length === 0 ? "default" : "pointer", accentColor: C.blue }}
                  />
                </th>
                {sortTh("date",       "Date",         { width: 100 })}
                {sortTh("project",    "Project",      { width: 220 })}
                {sortTh("task",       "Task / Phase", { width: 180 })}
                {sortTh("consultant", "Consultant",   { width: 140 })}
                {sortTh("memo",       "Description")}
                {sortTh("hours",      "Duration",     { width: 80, textAlign: "right" })}
                {showClass && <>
                  {sortTh("billable",   "Billable",   { width: 70, textAlign: "center" })}
                  {sortTh("utilized",   "Utilized",   { width: 70, textAlign: "center" })}
                  {sortTh("productive", "Productive", { width: 84, textAlign: "center" })}
                </>}
                {sortTh("status",     "Status",       { width: 120 })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, i) => {
                const p = projectById.get(e.projectId);
                return (
                  <tr key={e.id} style={{ background: selected.has(e.id) && isApprovable(e) ? C.blueBg : i % 2 === 1 ? C.alt : C.surface }}>
                    <td style={{ ...td, textAlign: "center", padding: "7px 4px 7px 10px" }}>
                      {/* Already approved or rejected entries can't be approved, so no box. */}
                      {isApprovable(e) && (
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          disabled={approving}
                          onChange={() => toggleEntry(e.id)}
                          aria-label={`Select ${e.employeeName}'s entry on ${fmtDate(e.date)}`}
                          style={{ cursor: "pointer", accentColor: C.blue }}
                        />
                      )}
                    </td>
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
