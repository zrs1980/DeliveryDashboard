"use client";
import { useState, useMemo } from "react";
import { C } from "@/lib/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NSCase {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  stage: string;
  company: string;
  assigned: string;
  createdDate: string;
  lastModified: string;
  lastNote?: string;
}

interface Props {
  cases: NSCase[];
  loading?: boolean;
  error?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NS_CASE_URL = (id: string) =>
  `https://3550424.app.netsuite.com/app/crm/support/supportcase.nl?id=${id}&whence=`;

const CLOSED_STATUSES = ["closed", "resolved"];
function isClosedCase(c: NSCase): boolean {
  return CLOSED_STATUSES.some(s => c.status.toLowerCase().includes(s));
}

const CASE_STATUS_STYLES: Record<string, { bg: string; color: string; bd: string }> = {
  "open":             { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
  "in progress":      { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
  "assigned":         { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
  "re-opened":        { bg: C.redBg,    color: C.red,     bd: C.redBd    },
  "escalated":        { bg: C.redBg,    color: C.red,     bd: C.redBd    },
  "pending customer": { bg: C.orangeBg, color: C.orange,  bd: C.orangeBd },
  "awaiting info":    { bg: C.orangeBg, color: C.orange,  bd: C.orangeBd },
  "on hold":          { bg: C.yellowBg, color: C.yellow,  bd: C.yellowBd },
  "closed":           { bg: C.alt,      color: C.textSub, bd: C.border   },
  "resolved":         { bg: C.greenBg,  color: C.green,   bd: C.greenBd  },
};

function caseStatusStyle(status: string) {
  return CASE_STATUS_STYLES[status.toLowerCase()] ?? { bg: C.alt, color: C.textMid, bd: C.border };
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: C.textSub,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: `1px solid ${C.border}`,
  background: C.alt,
  whiteSpace: "nowrap",
  userSelect: "none",
  cursor: "pointer",
};

const tdStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12,
  color: C.text,
  verticalAlign: "middle",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const p = priority.toLowerCase();
  let bg: string, color: string, bd: string, label: string;
  if (p === "1" || p === "high" || p === "urgent" || p === "critical") {
    bg = C.redBg; color = C.red; bd = C.redBd; label = "High";
  } else if (p === "3" || p === "low") {
    bg = C.alt; color = C.textMid; bd = C.border; label = "Low";
  } else {
    bg = C.yellowBg; color = C.yellow; bd = C.yellowBd; label = "Medium";
  }
  return (
    <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 3, padding: "2px 6px", background: bg, color, border: `1px solid ${bd}`, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const sty = caseStatusStyle(status);
  return (
    <span style={{ fontSize: 10, fontWeight: 600, borderRadius: 3, padding: "2px 6px", background: sty.bg, color: sty.color, border: `1px solid ${sty.bd}`, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function KpiCard({ label, value, color, bg, bd }: {
  label: string; value: number | string; color: string; bg: string; bd: string;
}) {
  return (
    <div style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: "14px 18px", boxShadow: C.sh, flex: "1 1 0", minWidth: 130 }}>
      <div style={{ fontFamily: C.mono, fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMid, fontWeight: 500, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function MiniBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(4, (count / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: C.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, maxWidth: "78%" }} title={label}>
          {label}
        </span>
        <span style={{ color: C.textMid, fontFamily: C.mono, fontWeight: 700, marginLeft: 8, flexShrink: 0 }}>{count}</span>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: 6, width: `${pct}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function groupAndCount(arr: NSCase[], key: (c: NSCase) => string): Array<{ label: string; count: number }> {
  const map = new Map<string, number>();
  for (const c of arr) {
    const k = key(c) || "—";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── Sorting helpers ──────────────────────────────────────────────────────────

type SortKey = "caseNumber" | "title" | "company" | "priority" | "status" | "assigned" | "lastModified" | "age";
type SortDir = "asc" | "desc";

function priorityRank(priority: string): number {
  const p = priority.toLowerCase();
  if (p === "1" || p === "high" || p === "urgent" || p === "critical") return 1;
  if (p === "3" || p === "low") return 3;
  return 2;
}

function sortCases(cases: NSCase[], key: SortKey, dir: SortDir): NSCase[] {
  return [...cases].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "caseNumber":   cmp = parseInt(a.caseNumber || "0") - parseInt(b.caseNumber || "0"); break;
      case "title":        cmp = a.title.localeCompare(b.title); break;
      case "company":      cmp = a.company.localeCompare(b.company); break;
      case "priority":     cmp = priorityRank(a.priority) - priorityRank(b.priority); break;
      case "status":       cmp = a.status.localeCompare(b.status); break;
      case "assigned":     cmp = a.assigned.localeCompare(b.assigned); break;
      case "lastModified": cmp = new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime(); break;
      case "age": {
        cmp = (Date.now() - new Date(a.createdDate).getTime()) - (Date.now() - new Date(b.createdDate).getTime());
        break;
      }
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

function ageDays(createdDate: string): number {
  return Math.floor((Date.now() - new Date(createdDate).getTime()) / 86400000);
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CasesView({ cases, loading = false, error = null }: Props) {
  const [search,        setSearch]        = useState("");
  const [filterPrio,    setFilterPrio]    = useState("All");
  const [filterAssign,  setFilterAssign]  = useState("All");
  const [filterCompany, setFilterCompany] = useState("All");
  const [filterStatus,  setFilterStatus]  = useState("All");
  const [sortKey,       setSortKey]       = useState<SortKey>("lastModified");
  const [sortDir,       setSortDir]       = useState<SortDir>("desc");
  const [showAnalytics, setShowAnalytics] = useState(true);

  // ── Open / closed split ────────────────────────────────────────────────────
  const openCases   = useMemo(() => cases.filter(c => !isClosedCase(c)), [cases]);
  const closedCases = useMemo(() => cases.filter(c =>  isClosedCase(c)), [cases]);

  // ── KPI calculations ───────────────────────────────────────────────────────
  const totalOpen    = openCases.length;
  const highPriority = openCases.filter(c => {
    const p = c.priority.toLowerCase();
    return p === "1" || p === "high" || p === "urgent" || p === "critical";
  }).length;
  const unassigned = openCases.filter(c =>
    !c.assigned || c.assigned === "Unassigned" || c.assigned.trim() === ""
  ).length;
  const today = new Date().toDateString();
  const modifiedToday = openCases.filter(c =>
    !!c.lastModified && new Date(c.lastModified).toDateString() === today
  ).length;

  // ── Analytics ──────────────────────────────────────────────────────────────
  const weekAgo        = Date.now() - 7 * 86400000;
  const openedThisWeek = cases.filter(c => new Date(c.createdDate).getTime() > weekAgo).length;
  const closedThisWeek = closedCases.filter(c => new Date(c.lastModified).getTime() > weekAgo).length;
  const avgDaysOpen    = openCases.length > 0
    ? Math.round(openCases.reduce((sum, c) => sum + Math.max(0, ageDays(c.createdDate)), 0) / openCases.length)
    : 0;

  const byStatus   = useMemo(() => groupAndCount(openCases, c => c.status),                    [openCases]);
  const byCustomer = useMemo(() => groupAndCount(openCases, c => c.company || "—").slice(0, 8), [openCases]);
  const byAssignee = useMemo(() => groupAndCount(openCases, c => c.assigned || "Unassigned"),   [openCases]);

  const maxStatus   = byStatus[0]?.count   ?? 1;
  const maxCustomer = byCustomer[0]?.count ?? 1;
  const maxAssignee = byAssignee[0]?.count ?? 1;

  // ── Dropdowns ──────────────────────────────────────────────────────────────
  const assignees = useMemo(() =>
    Array.from(new Set(openCases.map(c => c.assigned || "Unassigned"))).sort()
  , [openCases]);
  const companies = useMemo(() =>
    Array.from(new Set(openCases.map(c => c.company || "—").filter(x => x !== "—"))).sort()
  , [openCases]);
  const statuses = useMemo(() =>
    Array.from(new Set(openCases.map(c => c.status).filter(Boolean))).sort()
  , [openCases]);

  // ── Filtered & sorted rows ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = openCases;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.caseNumber.toLowerCase().includes(q)
      );
    }
    if (filterPrio !== "All") {
      rows = rows.filter(c => {
        const p = c.priority.toLowerCase();
        if (filterPrio === "High")   return p === "1" || p === "high" || p === "urgent" || p === "critical";
        if (filterPrio === "Medium") return p === "2" || p === "medium" || p === "normal";
        if (filterPrio === "Low")    return p === "3" || p === "low";
        return true;
      });
    }
    if (filterAssign  !== "All") rows = rows.filter(c => (c.assigned || "Unassigned") === filterAssign);
    if (filterCompany !== "All") rows = rows.filter(c => c.company === filterCompany);
    if (filterStatus  !== "All") rows = rows.filter(c => c.status  === filterStatus);
    return sortCases(rows, sortKey, sortDir);
  }, [openCases, search, filterPrio, filterAssign, filterCompany, filterStatus, sortKey, sortDir]);

  // ── Sort helpers ───────────────────────────────────────────────────────────
  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "lastModified" || key === "age" ? "desc" : "asc"); }
  }
  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return <span style={{ color: C.mid, marginLeft: 4 }}>⇅</span>;
    return <span style={{ color: C.blue, marginLeft: 4 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 24px", color: C.textSub, fontFamily: C.font, fontSize: 14, gap: 12 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" style={{ animation: "spin 0.9s linear infinite" }}>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <circle cx="12" cy="12" r="10" stroke={C.border} strokeWidth="3" fill="none" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke={C.blue} strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
        Loading cases from NetSuite…
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (cases.length === 0 && error) {
    return (
      <div style={{ padding: "32px 24px", background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, fontFamily: C.font, color: C.red }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Cases could not be loaded from NetSuite.</div>
        <div style={{ fontSize: 13, color: C.textMid, marginBottom: 8 }}>
          Check that the SuiteQL user has access to the <code style={{ fontFamily: C.mono, fontSize: 12 }}>supportcase</code> table.
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 11, background: C.surface, border: `1px solid ${C.redBd}`, borderRadius: 5, padding: "8px 12px", color: C.red, wordBreak: "break-all" }}>
          {error}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: C.font, color: C.text }}>

      {/* ── KPI bar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <KpiCard label="Open Cases"      value={totalOpen}      color={totalOpen > 0 ? C.blue : C.textSub}          bg={totalOpen > 0 ? C.blueBg : C.alt}          bd={totalOpen > 0 ? C.blueBd : C.border} />
        <KpiCard label="High Priority"   value={highPriority}   color={highPriority > 0 ? C.red : C.textSub}        bg={highPriority > 0 ? C.redBg : C.alt}        bd={highPriority > 0 ? C.redBd : C.border} />
        <KpiCard label="Unassigned"      value={unassigned}     color={unassigned > 0 ? C.orange : C.textSub}       bg={unassigned > 0 ? C.orangeBg : C.alt}       bd={unassigned > 0 ? C.orangeBd : C.border} />
        <KpiCard label="Modified Today"  value={modifiedToday}  color={modifiedToday > 0 ? C.teal : C.textSub}      bg={modifiedToday > 0 ? C.tealBg : C.alt}      bd={modifiedToday > 0 ? C.tealBd : C.border} />
        <KpiCard label="Opened This Week" value={openedThisWeek} color={openedThisWeek > 0 ? C.purple : C.textSub}  bg={openedThisWeek > 0 ? C.purpleBg : C.alt}   bd={openedThisWeek > 0 ? C.purpleBd : C.border} />
        <KpiCard label="Closed This Week" value={closedThisWeek} color={closedThisWeek > 0 ? C.green : C.textSub}   bg={closedThisWeek > 0 ? C.greenBg : C.alt}    bd={closedThisWeek > 0 ? C.greenBd : C.border} />
        <KpiCard label="Avg Days Open"   value={`${avgDaysOpen}d`} color={avgDaysOpen > 14 ? C.red : avgDaysOpen > 7 ? C.yellow : C.green} bg={avgDaysOpen > 14 ? C.redBg : avgDaysOpen > 7 ? C.yellowBg : C.greenBg} bd={avgDaysOpen > 14 ? C.redBd : avgDaysOpen > 7 ? C.yellowBd : C.greenBd} />
      </div>

      {/* ── Analytics panel ─────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 16, overflow: "hidden", boxShadow: C.sh }}>
        <button
          onClick={() => setShowAnalytics(v => !v)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 16px", background: "none", border: "none", cursor: "pointer",
            fontFamily: C.font, fontSize: 12, fontWeight: 700, color: C.text,
            borderBottom: showAnalytics ? `1px solid ${C.border}` : "none",
          }}
        >
          <span>📊 Analytics</span>
          <span style={{ color: C.textSub, fontSize: 11 }}>{showAnalytics ? "▲ Hide" : "▼ Show"}</span>
        </button>

        {showAnalytics && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>

            {/* By Status */}
            <div style={{ padding: "14px 16px", borderRight: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                By Status
              </div>
              {byStatus.length === 0
                ? <div style={{ fontSize: 12, color: C.textSub }}>No data</div>
                : byStatus.map(({ label, count }) => (
                  <MiniBar key={label} label={label} count={count} max={maxStatus} color={caseStatusStyle(label).color} />
                ))
              }
            </div>

            {/* By Customer */}
            <div style={{ padding: "14px 16px", borderRight: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                By Customer
              </div>
              {byCustomer.length === 0
                ? <div style={{ fontSize: 12, color: C.textSub }}>No data</div>
                : byCustomer.map(({ label, count }) => (
                  <MiniBar key={label} label={label} count={count} max={maxCustomer} color={C.blue} />
                ))
              }
            </div>

            {/* By Assignee */}
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                By Assignee
              </div>
              {byAssignee.length === 0
                ? <div style={{ fontSize: 12, color: C.textSub }}>No data</div>
                : byAssignee.map(({ label, count }) => (
                  <MiniBar key={label} label={label} count={count} max={maxAssignee} color={C.purple} />
                ))
              }
            </div>

          </div>
        )}
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        marginBottom: 16, padding: "10px 14px",
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: C.sh,
      }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search title, company, case #…"
          style={{ flex: "1 1 200px", fontSize: 13, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontFamily: C.font, outline: "none", minWidth: 180 }}
        />

        <label style={{ fontSize: 12, color: C.textMid, fontWeight: 600, whiteSpace: "nowrap" }}>Priority:</label>
        <select value={filterPrio} onChange={e => setFilterPrio(e.target.value)}
          style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.font, cursor: "pointer" }}>
          <option>All</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>

        <label style={{ fontSize: 12, color: C.textMid, fontWeight: 600, whiteSpace: "nowrap" }}>Assigned:</label>
        <select value={filterAssign} onChange={e => setFilterAssign(e.target.value)}
          style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.font, cursor: "pointer", maxWidth: 180 }}>
          <option value="All">All</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <label style={{ fontSize: 12, color: C.textMid, fontWeight: 600, whiteSpace: "nowrap" }}>Company:</label>
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
          style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.font, cursor: "pointer", maxWidth: 180 }}>
          <option value="All">All</option>
          {companies.map(co => <option key={co} value={co}>{co}</option>)}
        </select>

        <label style={{ fontSize: 12, color: C.textMid, fontWeight: 600, whiteSpace: "nowrap" }}>Status:</label>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.font, cursor: "pointer", maxWidth: 180 }}>
          <option value="All">All</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <span style={{ marginLeft: "auto", fontSize: 12, color: C.textSub, whiteSpace: "nowrap" }}>
          {filtered.length} of {totalOpen} case{totalOpen !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      {openCases.length === 0 ? (
        <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14 }}>
          No open cases found.
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: C.sh, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
              <thead>
                <tr>
                  <th style={thStyle} onClick={() => handleSort("caseNumber")}>Case #{sortIndicator("caseNumber")}</th>
                  <th style={{ ...thStyle, minWidth: 220 }} onClick={() => handleSort("title")}>Title{sortIndicator("title")}</th>
                  <th style={thStyle} onClick={() => handleSort("company")}>Company{sortIndicator("company")}</th>
                  <th style={thStyle} onClick={() => handleSort("priority")}>Priority{sortIndicator("priority")}</th>
                  <th style={thStyle} onClick={() => handleSort("status")}>Status{sortIndicator("status")}</th>
                  <th style={thStyle} onClick={() => handleSort("assigned")}>Assigned{sortIndicator("assigned")}</th>
                  <th style={{ ...thStyle, whiteSpace: "nowrap" }} onClick={() => handleSort("lastModified")}>Last Modified{sortIndicator("lastModified")}</th>
                  <th style={thStyle} onClick={() => handleSort("age")}>Age{sortIndicator("age")}</th>
                  <th style={{ ...thStyle, minWidth: 220, cursor: "default" }}>Last Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: C.textSub, padding: "32px 12px" }}>
                      No cases match the current filters.
                    </td>
                  </tr>
                ) : filtered.map((c, i) => {
                  const rowBg       = i % 2 === 0 ? C.surface : C.alt;
                  const age         = ageDays(c.createdDate);
                  const ageColor    = age > 30 ? C.red : age > 14 ? C.yellow : C.textMid;
                  const isUnassigned = !c.assigned || c.assigned === "Unassigned" || c.assigned.trim() === "";

                  return (
                    <tr key={c.id} style={{ background: rowBg }}>

                      {/* Case # */}
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        <a href={NS_CASE_URL(c.id)} target="_blank" rel="noopener noreferrer"
                          style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: C.blue, textDecoration: "none" }}>
                          #{c.caseNumber}
                        </a>
                      </td>

                      {/* Title */}
                      <td style={{ ...tdStyle, maxWidth: 320 }}>
                        <a href={NS_CASE_URL(c.id)} target="_blank" rel="noopener noreferrer"
                          title={c.title}
                          style={{ fontSize: 12, fontWeight: 600, color: C.text, textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.title}
                        </a>
                      </td>

                      {/* Company */}
                      <td style={{ ...tdStyle, fontSize: 12, color: C.textMid, whiteSpace: "nowrap" }}>{c.company || "—"}</td>

                      {/* Priority */}
                      <td style={tdStyle}><PriorityBadge priority={c.priority} /></td>

                      {/* Status */}
                      <td style={tdStyle}><StatusBadge status={c.status} /></td>

                      {/* Assigned */}
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        {isUnassigned ? (
                          <span style={{ fontSize: 11, fontWeight: 600, color: C.orange, background: C.orangeBg, border: `1px solid ${C.orangeBd}`, borderRadius: 3, padding: "2px 6px" }}>
                            Unassigned
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: C.textMid }}>{c.assigned}</span>
                        )}
                      </td>

                      {/* Last Modified */}
                      <td style={{ ...tdStyle, fontSize: 12, color: C.textMid, whiteSpace: "nowrap" }}>{fmtDate(c.lastModified)}</td>

                      {/* Age */}
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: age > 14 ? 700 : 400, color: ageColor }}>
                          {isNaN(age) ? "—" : `${age}d`}
                        </span>
                      </td>

                      {/* Last Note */}
                      <td style={{ ...tdStyle, maxWidth: 280 }}>
                        {c.lastNote ? (
                          <span title={c.lastNote} style={{ fontSize: 11, color: C.textMid, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.lastNote}
                          </span>
                        ) : (
                          <span style={{ color: C.mid, fontSize: 11 }}>—</span>
                        )}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
