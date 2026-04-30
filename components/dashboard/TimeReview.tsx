"use client";
import { useState, useEffect } from "react";
import { C } from "@/lib/constants";

const PERIODS = [
  { id: "thisWeek",    label: "This Week" },
  { id: "lastWeek",   label: "Last Week" },
  { id: "thisMonth",  label: "This Month" },
  { id: "lastMonth",  label: "Last Month" },
  { id: "thisQuarter", label: "This Quarter" },
  { id: "custom",     label: "Custom" },
];

interface TimeEntry {
  id: number;
  date: string;         // MM/DD/YYYY (NetSuite format)
  projectId: number | null;
  projectName: string;
  hours: number;
  memo: string;
  isBillable: boolean;
  isUtilized: boolean;
  isProductive: boolean;
  approvalStatus: string;
}

interface EmployeeData {
  employeeId: number;
  employeeName: string;
  totalHours: number;
  billableHours: number;
  entries: TimeEntry[];
}

interface PivotProject {
  projectKey: string;
  projectName: string;
  projectId: number | null;
  memos: { memo: string; byDate: Record<string, number>; total: number }[];
  dateTotals: Record<string, number>;
  grandTotal: number;
}

// ── Date helpers ─────────────────────────────────────────────────────────────
// All internal date keys are ISO YYYY-MM-DD to avoid NS format ambiguity
// (NS trandate may be "4/1/2026" without leading zeros).

/** Convert any M/D/YYYY or MM/DD/YYYY NS date to YYYY-MM-DD ISO key */
function nsToISO(s: string): string {
  const p = s.split("/");
  if (p.length !== 3) return s;
  const mm   = p[0].padStart(2, "0");
  const dd   = p[1].padStart(2, "0");
  const yyyy = p[2];
  return `${yyyy}-${mm}-${dd}`;
}

/** Generate every calendar day from→to inclusive as YYYY-MM-DD ISO strings */
function generateDateRange(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(),   to.getMonth(),   to.getDate());
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Format a YYYY-MM-DD key into compact two-line column header */
function fmtColDate(iso: string): { top: string; bot: string; isWeekend: boolean } {
  const d = new Date(iso + "T12:00:00"); // noon avoids DST edge cases
  const dow = d.getDay();
  return {
    top:       d.toLocaleDateString("en-US", { month: "short" }),
    bot:       String(d.getDate()),
    isWeekend: dow === 0 || dow === 6,
  };
}

function fmtH(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}

function initials(name: string): string {
  return name.split(" ").map(n => n[0] ?? "").join("").slice(0, 2).toUpperCase();
}

// ── Pivot builder — uses a fixed set of all dates in the range ───────────────

function buildPivot(entries: TimeEntry[], allDates: string[]): PivotProject[] {
  const byProject: Record<string, { projectName: string; projectId: number | null; entries: TimeEntry[] }> = {};

  for (const e of entries) {
    const key = String(e.projectId ?? "__internal__");
    if (!byProject[key]) byProject[key] = { projectName: e.projectName, projectId: e.projectId, entries: [] };
    byProject[key].entries.push(e);
  }

  return Object.entries(byProject).map(([key, proj]) => {
    const byMemo: Record<string, Record<string, number>> = {};
    for (const e of proj.entries) {
      const mk      = e.memo.trim() || "(no memo)";
      const isoDate = nsToISO(e.date);   // normalise to YYYY-MM-DD
      if (!byMemo[mk]) byMemo[mk] = {};
      byMemo[mk][isoDate] = (byMemo[mk][isoDate] ?? 0) + e.hours;
    }

    // Build date totals over the FULL range (not just days with entries)
    const dateTotals: Record<string, number> = {};
    for (const d of allDates) dateTotals[d] = 0;
    for (const byDate of Object.values(byMemo)) {
      for (const [d, h] of Object.entries(byDate)) {
        if (dateTotals[d] !== undefined) dateTotals[d] += h;
      }
    }

    const memos = Object.entries(byMemo).map(([memo, byDate]) => ({
      memo,
      byDate,
      total: Object.values(byDate).reduce((s, h) => s + h, 0),
    }));

    const grandTotal = memos.reduce((s, m) => s + m.total, 0);

    return { projectKey: key, projectName: proj.projectName, projectId: proj.projectId, memos, dateTotals, grandTotal };
  });
}

// ── Styles ───────────────────────────────────────────────────────────────────

const tdBase: React.CSSProperties = {
  padding: "7px 6px",
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12,
  verticalAlign: "middle",
  whiteSpace: "nowrap",
};
const tdNum: React.CSSProperties = { ...tdBase, fontFamily: C.mono, textAlign: "right", minWidth: 46 };
const MEMO_COL_W = 250;

// ── ProjectPivot ─────────────────────────────────────────────────────────────

function ProjectPivot({ proj, allDates }: { proj: PivotProject; allDates: string[] }) {
  const { memos, dateTotals, grandTotal, projectName } = proj;

  return (
    <div style={{ marginBottom: 0 }}>
      {/* Project sub-header */}
      <div style={{
        padding: "7px 14px",
        background: "#F1F5FB",
        borderTop: `1px solid ${C.border}`,
        borderBottom: `1px solid ${C.border}`,
        fontSize: 12, fontWeight: 700, color: C.textMid,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.blue, display: "inline-block", flexShrink: 0 }} />
        {projectName}
      </div>

      {/* Scrollable table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: MEMO_COL_W }} />
            {allDates.map(d => <col key={d} style={{ width: 46 }} />)}
            <col style={{ width: 58 }} />
          </colgroup>

          <thead>
            <tr style={{ background: C.alt }}>
              {/* Memo col header — sticky */}
              <th style={{
                ...tdBase, fontWeight: 700, fontSize: 10, letterSpacing: "0.06em",
                color: C.textSub, textAlign: "left", textTransform: "uppercase",
                position: "sticky", left: 0, background: C.alt, zIndex: 2,
                borderRight: `1px solid ${C.border}`,
              }}>
                Memo
              </th>
              {/* Date col headers */}
              {allDates.map(d => {
                const { top, bot, isWeekend } = fmtColDate(d);
                return (
                  <th key={d} style={{
                    ...tdBase,
                    fontWeight: 500, textAlign: "center",
                    lineHeight: 1.2, padding: "5px 3px",
                    background: isWeekend ? "#F3F6FA" : C.alt,
                    opacity: isWeekend ? 0.6 : 1,
                  }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.04em", color: C.textSub }}>{top}</div>
                    <div style={{ fontSize: 11, fontFamily: C.mono, color: C.text }}>{bot}</div>
                  </th>
                );
              })}
              {/* Total col header */}
              <th style={{
                ...tdBase, fontWeight: 700, fontSize: 10, letterSpacing: "0.06em",
                color: C.textSub, textAlign: "right", textTransform: "uppercase",
                borderLeft: `1px solid ${C.border}`,
              }}>
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {memos.map((row, i) => (
              <tr key={row.memo} style={{ background: i % 2 === 0 ? C.surface : C.alt }}>
                {/* Memo cell — sticky */}
                <td style={{
                  ...tdBase, padding: "7px 10px",
                  color:      row.memo === "(no memo)" ? C.textSub : C.text,
                  fontStyle:  row.memo === "(no memo)" ? "italic" : "normal",
                  fontWeight: 500,
                  position: "sticky", left: 0,
                  background: i % 2 === 0 ? C.surface : C.alt,
                  zIndex: 1,
                  maxWidth: MEMO_COL_W, overflow: "hidden", textOverflow: "ellipsis",
                  borderRight: `1px solid ${C.border}`,
                }}>
                  {row.memo}
                </td>
                {/* Date cells */}
                {allDates.map(d => {
                  const h = row.byDate[d];
                  const { isWeekend } = fmtColDate(d);
                  return (
                    <td key={d} style={{
                      ...tdNum,
                      color:      h ? C.text    : C.mid,
                      fontWeight: h ? 600       : 400,
                      background: isWeekend && !h ? "#F3F6FA" : undefined,
                      opacity:    isWeekend && !h ? 0.5 : 1,
                    }}>
                      {h ? fmtH(h) : ""}
                    </td>
                  );
                })}
                {/* Row total */}
                <td style={{ ...tdNum, fontWeight: 700, color: C.text, borderLeft: `1px solid ${C.border}` }}>
                  {fmtH(row.total)}
                </td>
              </tr>
            ))}

            {/* Column totals footer — only when >1 memo */}
            {memos.length > 1 && (
              <tr style={{ background: "#E8EDF5", borderTop: `2px solid ${C.border}` }}>
                <td style={{
                  ...tdBase, padding: "7px 10px",
                  fontWeight: 700, fontSize: 11, color: C.textMid,
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  position: "sticky", left: 0, background: "#E8EDF5", zIndex: 1,
                  borderRight: `1px solid ${C.border}`,
                }}>
                  Total
                </td>
                {allDates.map(d => (
                  <td key={d} style={{ ...tdNum, fontWeight: 700, color: dateTotals[d] ? C.text : C.mid }}>
                    {dateTotals[d] ? fmtH(dateTotals[d]) : ""}
                  </td>
                ))}
                <td style={{ ...tdNum, fontWeight: 800, fontSize: 13, color: C.text, borderLeft: `1px solid ${C.border}` }}>
                  {fmtH(grandTotal)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TimeReview() {
  const [period, setPeriod]         = useState("thisMonth");
  const [customFrom, setCustomFrom] = useState("");   // YYYY-MM-DD
  const [customTo,   setCustomTo]   = useState("");   // YYYY-MM-DD
  const [data,       setData]       = useState<EmployeeData[]>([]);
  const [allDates,   setAllDates]   = useState<string[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set());
  const [updatedAt,  setUpdatedAt]  = useState<string | null>(null);

  async function load(p: string, from?: string, to?: string) {
    setLoading(true);
    setError(null);
    try {
      const url = (p === "custom" && from && to)
        ? `/api/time-review?period=custom&from=${from}&to=${to}`
        : `/api/time-review?period=${p}`;

      const res  = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load time records");

      setData(json.employees ?? []);
      setUpdatedAt(json.updatedAt ?? null);
      setExpanded(new Set());

      // Generate the full date range for consistent columns
      if (json.rangeFrom && json.rangeTo) {
        setAllDates(generateDateRange(new Date(json.rangeFrom), new Date(json.rangeTo)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // Auto-load when a preset period is selected
  useEffect(() => {
    if (period !== "custom") load(period);
  }, [period]);

  function applyCustomRange() {
    if (customFrom && customTo && customFrom <= customTo) load("custom", customFrom, customTo);
  }

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const totalHours   = data.reduce((s, e) => s + e.totalHours, 0);
  const totalEntries = data.reduce((s, e) => s + e.entries.length, 0);

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Time Review</div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>
            Memo × date pivot — grouped by resource and project
          </div>
        </div>

        {/* Period selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {PERIODS.map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: C.font,
                  background: period === p.id ? C.blue : C.surface,
                  color:      period === p.id ? "#fff"  : C.textMid,
                  border:     `1px solid ${period === p.id ? C.blue : C.border}`,
                  borderRadius: 6, cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date range inputs */}
          {period === "custom" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                style={{
                  padding: "5px 10px", fontSize: 12, fontFamily: C.font,
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.text, background: C.surface, cursor: "pointer",
                }}
              />
              <span style={{ fontSize: 12, color: C.textSub }}>to</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={e => setCustomTo(e.target.value)}
                style={{
                  padding: "5px 10px", fontSize: 12, fontFamily: C.font,
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.text, background: C.surface, cursor: "pointer",
                }}
              />
              <button
                onClick={applyCustomRange}
                disabled={!customFrom || !customTo || customFrom > customTo}
                style={{
                  padding: "5px 14px", fontSize: 12, fontWeight: 700, fontFamily: C.font,
                  background: (!customFrom || !customTo || customFrom > customTo) ? C.alt : C.blue,
                  color:      (!customFrom || !customTo || customFrom > customTo) ? C.textSub : "#fff",
                  border: "none", borderRadius: 6, cursor: "pointer", transition: "all 0.15s",
                }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Summary bar ─────────────────────────────────────────────────────── */}
      {!loading && data.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 24 }}>
            <div>
              <span style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: C.text }}>{fmtH(totalHours)}h</span>
              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 6 }}>total logged</span>
            </div>
            <div>
              <span style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: C.textMid }}>{totalEntries}</span>
              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 6 }}>entries</span>
            </div>
            <div>
              <span style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: C.text }}>{allDates.length}</span>
              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 6 }}>days in range</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {updatedAt && <span style={{ fontSize: 11, color: C.textSub }}>{new Date(updatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}</span>}
            <button onClick={() => setExpanded(new Set(data.map(e => e.employeeId)))} style={{ fontSize: 12, color: C.blue, background: "none", border: "none", cursor: "pointer", fontFamily: C.font, fontWeight: 600 }}>
              Expand all
            </button>
            <span style={{ color: C.mid }}>·</span>
            <button onClick={() => setExpanded(new Set())} style={{ fontSize: 12, color: C.blue, background: "none", border: "none", cursor: "pointer", fontFamily: C.font, fontWeight: 600 }}>
              Collapse all
            </button>
          </div>
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.red, fontSize: 13, fontWeight: 500 }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", boxShadow: C.sh }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.alt }} />
                <div style={{ flex: 1 }}>
                  <div style={{ width: 140, height: 13, background: C.alt, borderRadius: 4, marginBottom: 6 }} />
                  <div style={{ width: 80, height: 11, background: C.alt, borderRadius: 4 }} />
                </div>
                <div style={{ width: 60, height: 20, background: C.alt, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!loading && !error && data.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 24px", color: C.textSub, fontSize: 14 }}>
          {period === "custom" && (!customFrom || !customTo)
            ? "Select a date range above and click Apply."
            : "No time records found for this period."}
        </div>
      )}

      {/* ── Employee cards ──────────────────────────────────────────────────── */}
      {!loading && data.map(emp => {
        const isExpanded  = expanded.has(emp.employeeId);
        const billablePct = emp.totalHours > 0 ? Math.round((emp.billableHours / emp.totalHours) * 100) : 0;
        const projects    = isExpanded ? buildPivot(emp.entries, allDates) : [];

        return (
          <div key={emp.employeeId} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 10, overflow: "hidden", boxShadow: C.sh }}>

            {/* Employee header */}
            <div
              onClick={() => toggle(emp.employeeId)}
              style={{ display: "flex", alignItems: "center", padding: "14px 18px", cursor: "pointer", gap: 14, userSelect: "none" }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = C.alt; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                background: C.blueBg, border: `1px solid ${C.blueBd}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: C.blue,
              }}>
                {initials(emp.employeeName)}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{emp.employeeName}</div>
                <div style={{ fontSize: 12, color: C.textSub, marginTop: 1 }}>
                  {emp.entries.length} {emp.entries.length === 1 ? "entry" : "entries"}
                </div>
              </div>

              <div style={{
                fontSize: 11, fontWeight: 700, fontFamily: C.mono,
                background: billablePct >= 65 ? C.greenBg : billablePct >= 50 ? C.yellowBg : C.redBg,
                color:      billablePct >= 65 ? C.green   : billablePct >= 50 ? C.yellow   : C.red,
                border:     `1px solid ${billablePct >= 65 ? C.greenBd : billablePct >= 50 ? C.yellowBd : C.redBd}`,
                borderRadius: 6, padding: "3px 8px",
              }}>
                {billablePct}% billable
              </div>

              <div style={{ textAlign: "right", minWidth: 70 }}>
                <div style={{ fontFamily: C.mono, fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1 }}>
                  {fmtH(emp.totalHours)}h
                </div>
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
                  {fmtH(emp.billableHours)}h billable
                </div>
              </div>

              <div style={{
                fontSize: 14, color: C.textSub, flexShrink: 0, width: 20, textAlign: "center",
                transition: "transform 0.2s",
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}>
                ▾
              </div>
            </div>

            {/* Expanded: project pivots */}
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}` }}>
                {projects.length === 0
                  ? <div style={{ padding: "14px 18px", fontSize: 13, color: C.textSub, fontStyle: "italic" }}>No entries.</div>
                  : projects.map(proj => <ProjectPivot key={proj.projectKey} proj={proj} allDates={allDates} />)
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
