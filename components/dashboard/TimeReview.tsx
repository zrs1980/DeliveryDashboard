"use client";
import { useState, useEffect } from "react";
import { C } from "@/lib/constants";

const PERIODS = [
  { id: "thisWeek",    label: "This Week" },
  { id: "lastWeek",   label: "Last Week" },
  { id: "thisMonth",  label: "This Month" },
  { id: "lastMonth",  label: "Last Month" },
  { id: "thisQuarter", label: "This Quarter" },
];

interface TimeEntry {
  id: number;
  date: string;         // MM/DD/YYYY
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
  dates: string[];
  memos: { memo: string; byDate: Record<string, number>; total: number }[];
  dateTotals: Record<string, number>;
  grandTotal: number;
}

function parseNSDate(s: string): Date | null {
  const p = s.split("/");
  if (p.length !== 3) return null;
  return new Date(parseInt(p[2]), parseInt(p[0]) - 1, parseInt(p[1]));
}

function fmtColDate(s: string): { top: string; bot: string } {
  const d = parseNSDate(s);
  if (!d) return { top: s, bot: "" };
  return {
    top: d.toLocaleDateString("en-US", { month: "short" }),
    bot: String(d.getDate()),
  };
}

function fmtH(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}

function initials(name: string): string {
  return name.split(" ").map(n => n[0] ?? "").join("").slice(0, 2).toUpperCase();
}

function buildPivot(entries: TimeEntry[]): PivotProject[] {
  const byProject: Record<string, { projectName: string; projectId: number | null; entries: TimeEntry[] }> = {};

  for (const e of entries) {
    const key = String(e.projectId ?? "__internal__");
    if (!byProject[key]) byProject[key] = { projectName: e.projectName, projectId: e.projectId, entries: [] };
    byProject[key].entries.push(e);
  }

  return Object.entries(byProject).map(([key, proj]) => {
    const dateSet = new Set<string>(proj.entries.map(e => e.date));
    const dates = [...dateSet].sort((a, b) => (parseNSDate(a)?.getTime() ?? 0) - (parseNSDate(b)?.getTime() ?? 0));

    const byMemo: Record<string, Record<string, number>> = {};
    for (const e of proj.entries) {
      const mk = e.memo.trim() || "(no memo)";
      if (!byMemo[mk]) byMemo[mk] = {};
      byMemo[mk][e.date] = (byMemo[mk][e.date] ?? 0) + e.hours;
    }

    const dateTotals: Record<string, number> = {};
    for (const d of dates) dateTotals[d] = 0;
    for (const byDate of Object.values(byMemo)) {
      for (const [d, h] of Object.entries(byDate)) {
        dateTotals[d] = (dateTotals[d] ?? 0) + h;
      }
    }

    const memos = Object.entries(byMemo).map(([memo, byDate]) => ({
      memo,
      byDate,
      total: Object.values(byDate).reduce((s, h) => s + h, 0),
    }));

    const grandTotal = memos.reduce((s, m) => s + m.total, 0);

    return { projectKey: key, projectName: proj.projectName, projectId: proj.projectId, dates, memos, dateTotals, grandTotal };
  });
}

// ── Styles ──────────────────────────────────────────────────────────────────

const tdBase: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12,
  verticalAlign: "middle",
  whiteSpace: "nowrap",
};

const tdNum: React.CSSProperties = {
  ...tdBase,
  fontFamily: C.mono,
  textAlign: "right",
  minWidth: 52,
};

const MEMO_COL_W = 260;

// ── Pivot table for one project ──────────────────────────────────────────────

function ProjectPivot({ proj }: { proj: PivotProject }) {
  const { dates, memos, dateTotals, grandTotal, projectName } = proj;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Project sub-header */}
      <div style={{
        padding: "8px 14px",
        background: C.alt,
        borderBottom: `1px solid ${C.border}`,
        borderTop: `1px solid ${C.border}`,
        fontSize: 12,
        fontWeight: 700,
        color: C.textMid,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: C.blue, display: "inline-block", flexShrink: 0,
        }} />
        {projectName}
      </div>

      {/* Scrollable pivot table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: MEMO_COL_W }} />
            {dates.map(d => <col key={d} style={{ width: 58 }} />)}
            <col style={{ width: 64 }} />
          </colgroup>

          {/* Column headers */}
          <thead>
            <tr style={{ background: C.alt }}>
              <th style={{
                ...tdBase,
                fontWeight: 700, fontSize: 10, letterSpacing: "0.06em",
                color: C.textSub, textAlign: "left", textTransform: "uppercase",
                position: "sticky", left: 0, background: C.alt, zIndex: 1,
              }}>
                Memo
              </th>
              {dates.map(d => {
                const { top, bot } = fmtColDate(d);
                return (
                  <th key={d} style={{
                    ...tdBase,
                    fontWeight: 600, color: C.textSub, textAlign: "center",
                    lineHeight: 1.25, padding: "6px 4px",
                  }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>{top}</div>
                    <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>{bot}</div>
                  </th>
                );
              })}
              <th style={{
                ...tdBase,
                fontWeight: 700, fontSize: 10, letterSpacing: "0.06em",
                color: C.textSub, textAlign: "right", textTransform: "uppercase",
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
                  ...tdBase,
                  color: row.memo === "(no memo)" ? C.textSub : C.text,
                  fontStyle: row.memo === "(no memo)" ? "italic" : "normal",
                  fontWeight: 500,
                  position: "sticky", left: 0,
                  background: i % 2 === 0 ? C.surface : C.alt,
                  zIndex: 1,
                  maxWidth: MEMO_COL_W,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {row.memo}
                </td>

                {/* Date cells */}
                {dates.map(d => {
                  const h = row.byDate[d];
                  return (
                    <td key={d} style={{
                      ...tdNum,
                      color: h ? C.text : C.mid,
                      fontWeight: h ? 600 : 400,
                    }}>
                      {h ? fmtH(h) : ""}
                    </td>
                  );
                })}

                {/* Row total */}
                <td style={{ ...tdNum, fontWeight: 700, color: C.text }}>
                  {fmtH(row.total)}
                </td>
              </tr>
            ))}

            {/* Totals footer row */}
            {memos.length > 1 && (
              <tr style={{ background: "#EEF2F8", borderTop: `2px solid ${C.border}` }}>
                <td style={{
                  ...tdBase,
                  fontWeight: 700, fontSize: 11, color: C.textMid,
                  textTransform: "uppercase", letterSpacing: "0.04em",
                  position: "sticky", left: 0, background: "#EEF2F8", zIndex: 1,
                }}>
                  Total
                </td>
                {dates.map(d => (
                  <td key={d} style={{ ...tdNum, fontWeight: 700, color: dateTotals[d] ? C.text : C.mid }}>
                    {dateTotals[d] ? fmtH(dateTotals[d]) : ""}
                  </td>
                ))}
                <td style={{ ...tdNum, fontWeight: 800, color: C.text, fontSize: 13 }}>
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

// ── Main component ───────────────────────────────────────────────────────────

export function TimeReview() {
  const [period, setPeriod]       = useState("thisMonth");
  const [data, setData]           = useState<EmployeeData[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<Set<number>>(new Set());
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function load(p: string) {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/time-review?period=${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load time records");
      setData(json.employees ?? []);
      setUpdatedAt(json.updatedAt ?? null);
      setExpanded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(period); }, [period]);

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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Time Review</div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>
            Memos × dates pivot by resource and project
          </div>
        </div>
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
              <span style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: C.text }}>{data.length}</span>
              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 6 }}>resources</span>
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
          No time records found for this period.
        </div>
      )}

      {/* ── Employee cards ──────────────────────────────────────────────────── */}
      {!loading && data.map(emp => {
        const isExpanded  = expanded.has(emp.employeeId);
        const billablePct = emp.totalHours > 0 ? Math.round((emp.billableHours / emp.totalHours) * 100) : 0;
        const projects    = isExpanded ? buildPivot(emp.entries) : [];

        return (
          <div key={emp.employeeId} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 10, overflow: "hidden", boxShadow: C.sh }}>

            {/* ── Employee header (click to expand) ──────────────────────────── */}
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

              <div style={{ fontSize: 14, color: C.textSub, flexShrink: 0, width: 20, textAlign: "center", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                ▾
              </div>
            </div>

            {/* ── Expanded: project pivot tables ─────────────────────────────── */}
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}` }}>
                {projects.length === 0
                  ? <div style={{ padding: "14px 18px", fontSize: 13, color: C.textSub, fontStyle: "italic" }}>No entries.</div>
                  : projects.map(proj => <ProjectPivot key={proj.projectKey} proj={proj} />)
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
