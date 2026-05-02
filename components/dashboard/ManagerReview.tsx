"use client";
import { useState, useEffect } from "react";
import { C } from "@/lib/constants";

// ── Period options ────────────────────────────────────────────────────────────

const PERIODS = [
  { id: "thisWeek",    label: "This Week" },
  { id: "lastWeek",   label: "Last Week" },
  { id: "thisMonth",  label: "This Month" },
  { id: "lastMonth",  label: "Last Month" },
  { id: "thisQuarter", label: "This Quarter" },
  { id: "custom",     label: "Custom" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface AllocSegment {
  id:        string;
  startDate: string;
  endDate:   string;
  pct:       number;   // % of 40h week
  hrsPerDay: number;   // fallback if pct = 0
}

interface ProjectData {
  projectId:     number | null;
  projectName:   string;
  actualHours:   number;
  billableHours: number;
  allocations:   AllocSegment[];
}

interface EmployeeData {
  employeeId:    number;
  employeeName:  string;
  totalHours:    number;
  billableHours: number;
  projects:      ProjectData[];
}

// ── Allocation calculation helpers ────────────────────────────────────────────

function parseDate(s: string): Date | null {
  if (!s) return null;
  // Handles "M/D/YYYY", "MM/DD/YYYY", and "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T12:00:00");
  const p = s.split("/");
  if (p.length === 3) return new Date(parseInt(p[2]), parseInt(p[0]) - 1, parseInt(p[1]));
  return null;
}

function getMondayOf(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const dow = r.getDay();
  r.setDate(r.getDate() - ((dow + 6) % 7));
  return r;
}

/** Weekly hours for one allocation segment */
function weeklyHours(seg: AllocSegment): number {
  return seg.pct > 0 ? (seg.pct / 100) * 40 : seg.hrsPerDay * 5;
}

/** Allocated hours for one segment within one Mon-starting week */
function segHoursForWeek(seg: AllocSegment, weekStart: Date): number {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const s = parseDate(seg.startDate);
  const e = parseDate(seg.endDate);
  if (!s || !e || s > weekEnd || e < weekStart) return 0;
  if (s <= weekStart && e >= weekEnd) return weeklyHours(seg);

  const overlapStart = s > weekStart ? s : weekStart;
  const overlapEnd   = e < weekEnd   ? e : weekEnd;
  let workDays = 0;
  const cur = new Date(overlapStart);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(overlapEnd);
  last.setHours(0, 0, 0, 0);
  while (cur <= last) {
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5) workDays++;
    cur.setDate(cur.getDate() + 1);
  }
  return (weeklyHours(seg) / 5) * workDays;
}

/** Total allocated hours for a project across a date range */
function allocatedForPeriod(allocs: AllocSegment[], from: Date, to: Date): number {
  if (allocs.length === 0) return 0;
  let total = 0;
  const cur = getMondayOf(from);
  while (cur <= to) {
    for (const seg of allocs) total += segHoursForWeek(seg, cur);
    cur.setDate(cur.getDate() + 7);
  }
  return Math.round(total * 100) / 100;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function score(billablePct: number, alignPct: number): "green" | "yellow" | "red" {
  if (billablePct >= 0.65 && alignPct >= 0.80) return "green";
  if (billablePct >= 0.50 && alignPct >= 0.60) return "yellow";
  return "red";
}

const RAG = {
  green:  { bg: C.greenBg,  border: C.greenBd,  text: C.green,  label: "On Track" },
  yellow: { bg: C.yellowBg, border: C.yellowBd, text: C.yellow, label: "Watch" },
  red:    { bg: C.redBg,    border: C.redBd,    text: C.red,    label: "Review" },
};

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmtH(n: number) { const r = Math.round(n * 10) / 10; return r % 1 === 0 ? String(r) : r.toFixed(1); }
function pct(n: number)  { return Math.round(n * 100) + "%"; }
function initials(name: string) { return name.split(" ").map(n => n[0] ?? "").join("").slice(0, 2).toUpperCase(); }

// ── Mini bar ──────────────────────────────────────────────────────────────────

function MiniBar({ value, color, bg = C.alt, width = 80 }: { value: number; color: string; bg?: string; width?: number }) {
  return (
    <div style={{ width, height: 6, background: bg, borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
    </div>
  );
}

// ── KPI pill ──────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 800, color: color ?? C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textSub, marginTop: 1 }}>{sub}</div>}
      <div style={{ fontSize: 10, fontWeight: 600, color: C.textSub, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
    </div>
  );
}

// ── Project row inside expanded card ─────────────────────────────────────────

function ProjectRow({
  proj, allocHours, isAllocated, isLast,
}: {
  proj:        ProjectData;
  allocHours:  number;
  isAllocated: boolean;
  isLast:      boolean;
}) {
  const nonBillable = Math.round((proj.actualHours - proj.billableHours) * 10) / 10;
  const gap         = isAllocated ? Math.round((proj.actualHours - allocHours) * 10) / 10 : null;
  const billPct     = proj.actualHours > 0 ? proj.billableHours / proj.actualHours : 0;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 72px 72px 72px 72px 80px 110px",
      alignItems: "center",
      padding: "9px 18px",
      borderBottom: isLast ? "none" : `1px solid ${C.border}`,
      background: isAllocated ? C.surface : "#FFFBF5",
      gap: 0,
    }}>
      {/* Project name + drift badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {!isAllocated && (
          <span style={{ fontSize: 10, fontWeight: 700, background: C.orangeBg, color: C.orange, border: `1px solid ${C.orangeBd}`, borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
            DRIFT
          </span>
        )}
        {isAllocated && proj.actualHours === 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, background: C.yellowBg, color: C.yellow, border: `1px solid ${C.yellowBd}`, borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
            NO TIME
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {proj.projectName}
        </span>
      </div>

      {/* Allocated */}
      <div style={{ fontFamily: C.mono, fontSize: 12, textAlign: "right", color: isAllocated ? C.textMid : C.mid }}>
        {isAllocated ? `${fmtH(allocHours)}h` : "—"}
      </div>

      {/* Actual */}
      <div style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600, textAlign: "right", color: proj.actualHours > 0 ? C.text : C.mid }}>
        {proj.actualHours > 0 ? `${fmtH(proj.actualHours)}h` : "—"}
      </div>

      {/* Billable */}
      <div style={{ fontFamily: C.mono, fontSize: 12, textAlign: "right", color: proj.billableHours > 0 ? C.green : C.mid }}>
        {proj.billableHours > 0 ? `${fmtH(proj.billableHours)}h` : "—"}
      </div>

      {/* Non-billable */}
      <div style={{ fontFamily: C.mono, fontSize: 12, textAlign: "right", color: nonBillable > 0 ? C.orange : C.mid }}>
        {nonBillable > 0 ? `${fmtH(nonBillable)}h` : "—"}
      </div>

      {/* Gap (actual − allocated) */}
      <div style={{ fontFamily: C.mono, fontSize: 12, textAlign: "right", color: gap === null ? C.mid : gap > 0 ? C.red : gap < 0 ? C.yellow : C.green }}>
        {gap === null ? "—" : gap === 0 ? "±0" : gap > 0 ? `+${fmtH(gap)}h` : `${fmtH(gap)}h`}
      </div>

      {/* Billable % bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
        {proj.actualHours > 0 && (
          <>
            <span style={{ fontFamily: C.mono, fontSize: 11, color: billPct >= 0.65 ? C.green : billPct >= 0.5 ? C.yellow : C.red }}>
              {pct(billPct)}
            </span>
            <MiniBar value={billPct} color={billPct >= 0.65 ? C.green : billPct >= 0.5 ? C.yellow : C.red} width={44} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ManagerReview() {
  const [period,      setPeriod]      = useState("thisMonth");
  const [customFrom,  setCustomFrom]  = useState("");
  const [customTo,    setCustomTo]    = useState("");
  const [data,        setData]        = useState<EmployeeData[]>([]);
  const [rangeFrom,   setRangeFrom]   = useState<Date | null>(null);
  const [rangeTo,     setRangeTo]     = useState<Date | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [expanded,    setExpanded]    = useState<Set<number>>(new Set());
  const [updatedAt,   setUpdatedAt]   = useState<string | null>(null);

  async function load(p: string, from?: string, to?: string) {
    setLoading(true); setError(null);
    try {
      const url = p === "custom" && from && to
        ? `/api/manager-review?period=custom&from=${from}&to=${to}`
        : `/api/manager-review?period=${p}`;
      const res  = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json.employees ?? []);
      setRangeFrom(json.rangeFrom ? new Date(json.rangeFrom + "T00:00:00") : null);
      setRangeTo(json.rangeTo   ? new Date(json.rangeTo   + "T23:59:59") : null);
      setUpdatedAt(json.updatedAt ?? null);
      setExpanded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (period !== "custom") load(period); }, [period]);

  function applyCustom() {
    if (customFrom && customTo && customFrom <= customTo) load("custom", customFrom, customTo);
  }

  function toggle(id: number) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Derived per-employee metrics ─────────────────────────────────────────

  interface EnrichedProject extends ProjectData { allocHours: number; isAllocated: boolean; }
  interface EnrichedEmployee extends Omit<EmployeeData, "projects"> {
    allocatedTotal:  number;
    driftHours:      number;
    alignPct:        number;
    billablePct:     number;
    rag:             "green" | "yellow" | "red";
    projects:        EnrichedProject[];
  }

  const enriched: EnrichedEmployee[] = (rangeFrom && rangeTo ? data : []).map(emp => {
    const projects = emp.projects.map(p => ({
      ...p,
      allocHours:  allocatedForPeriod(p.allocations, rangeFrom!, rangeTo!),
      isAllocated: p.allocations.length > 0,
    }));

    const allocatedTotal = projects.filter(p => p.isAllocated).reduce((s, p) => s + p.allocHours, 0);
    const driftHours     = projects.filter(p => !p.isAllocated).reduce((s, p) => s + p.actualHours, 0);
    const alignPct       = emp.totalHours > 0 ? Math.max(0, (emp.totalHours - driftHours) / emp.totalHours) : 1;
    const billablePct    = emp.totalHours > 0 ? emp.billableHours / emp.totalHours : 0;

    return { ...emp, projects, allocatedTotal, driftHours, alignPct, billablePct, rag: score(billablePct, alignPct) };
  });

  // ── Portfolio-level KPIs ─────────────────────────────────────────────────

  const totalAllocated  = enriched.reduce((s, e) => s + e.allocatedTotal, 0);
  const totalActual     = enriched.reduce((s, e) => s + e.totalHours, 0);
  const totalBillable   = enriched.reduce((s, e) => s + e.billableHours, 0);
  const totalDrift      = enriched.reduce((s, e) => s + e.driftHours, 0);
  const portfolioBillPct = totalActual > 0 ? totalBillable / totalActual : 0;
  const reviewNeeded    = enriched.filter(e => e.rag !== "green").length;

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Manager Review</div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>
            Allocation vs actuals — billable work, drift, and alignment per consultant
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)} style={{
                padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: C.font,
                background: period === p.id ? C.blue : C.surface,
                color:      period === p.id ? "#fff"  : C.textMid,
                border:     `1px solid ${period === p.id ? C.blue : C.border}`,
                borderRadius: 6, cursor: "pointer", transition: "all 0.15s",
              }}>{p.label}</button>
            ))}
          </div>

          {period === "custom" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                style={{ padding: "5px 10px", fontSize: 12, fontFamily: C.font, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: C.surface }} />
              <span style={{ fontSize: 12, color: C.textSub }}>to</span>
              <input type="date" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value)}
                style={{ padding: "5px 10px", fontSize: 12, fontFamily: C.font, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, background: C.surface }} />
              <button onClick={applyCustom} disabled={!customFrom || !customTo || customFrom > customTo}
                style={{
                  padding: "5px 14px", fontSize: 12, fontWeight: 700, fontFamily: C.font,
                  background: (!customFrom || !customTo || customFrom > customTo) ? C.alt : C.blue,
                  color: (!customFrom || !customTo || customFrom > customTo) ? C.textSub : "#fff",
                  border: "none", borderRadius: 6, cursor: "pointer",
                }}>Apply</button>
            </div>
          )}
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.red, fontSize: 13, fontWeight: 500 }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Portfolio KPIs ────────────────────────────────────────────────── */}
      {!loading && enriched.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
          gap: 1, marginBottom: 20,
          background: C.border, borderRadius: 12, overflow: "hidden", boxShadow: C.sh,
        }}>
          {[
            { label: "Allocated",  value: `${fmtH(totalAllocated)}h`,       sub: "planned capacity" },
            { label: "Actual",     value: `${fmtH(totalActual)}h`,           sub: `vs ${fmtH(totalAllocated)}h alloc`, color: totalActual < totalAllocated * 0.85 ? C.yellow : C.text },
            { label: "Billable",   value: `${fmtH(totalBillable)}h`,         sub: pct(portfolioBillPct), color: portfolioBillPct >= 0.65 ? C.green : portfolioBillPct >= 0.5 ? C.yellow : C.red },
            { label: "Drift",      value: `${fmtH(totalDrift)}h`,            sub: totalActual > 0 ? pct(totalDrift / totalActual) + " of actual" : "—", color: totalDrift > 0 ? C.orange : C.text },
            { label: "Need Review", value: String(reviewNeeded),              sub: `of ${enriched.length} consultants`, color: reviewNeeded > 0 ? C.red : C.green },
          ].map(k => (
            <div key={k.label} style={{ background: C.surface, padding: "16px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Kpi {...k} />
            </div>
          ))}
        </div>
      )}

      {/* ── Loading skeleton ──────────────────────────────────────────────── */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px", boxShadow: C.sh }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.alt }} />
                <div style={{ flex: 1 }}>
                  <div style={{ width: 160, height: 13, background: C.alt, borderRadius: 4, marginBottom: 6 }} />
                  <div style={{ width: 240, height: 11, background: C.alt, borderRadius: 4 }} />
                </div>
                <div style={{ width: 80, height: 22, background: C.alt, borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && !error && enriched.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 24px", color: C.textSub, fontSize: 14 }}>
          {period === "custom" && (!customFrom || !customTo)
            ? "Select a date range and click Apply."
            : "No data found for this period."}
        </div>
      )}

      {/* ── Table column headers (shown when any card is expanded) ────────── */}
      {!loading && expanded.size > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 72px 72px 72px 72px 80px 110px",
          padding: "5px 18px",
          marginBottom: 4,
          fontSize: 10, fontWeight: 700, color: C.textSub,
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          <div>Project</div>
          <div style={{ textAlign: "right" }}>Alloc</div>
          <div style={{ textAlign: "right" }}>Actual</div>
          <div style={{ textAlign: "right" }}>Billable</div>
          <div style={{ textAlign: "right" }}>Non-Bill</div>
          <div style={{ textAlign: "right" }}>Gap</div>
          <div style={{ textAlign: "right" }}>Bill %</div>
        </div>
      )}

      {/* ── Consultant cards ──────────────────────────────────────────────── */}
      {!loading && enriched.map(emp => {
        const isExpanded = expanded.has(emp.employeeId);
        const rag        = RAG[emp.rag];

        // Split into allocated vs drift projects, sort by actual hours desc
        const allocProjects = emp.projects.filter(p => p.isAllocated).sort((a, b) => b.actualHours - a.actualHours);
        const driftProjects = emp.projects.filter(p => !p.isAllocated && p.actualHours > 0).sort((a, b) => b.actualHours - a.actualHours);

        const utilizationPct = emp.allocatedTotal > 0 ? emp.totalHours / emp.allocatedTotal : null;

        return (
          <div key={emp.employeeId} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 10, overflow: "hidden", boxShadow: C.sh }}>

            {/* ── Card header ─────────────────────────────────────────────── */}
            <div
              onClick={() => toggle(emp.employeeId)}
              style={{ display: "flex", alignItems: "center", padding: "14px 18px", cursor: "pointer", gap: 14, userSelect: "none" }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = C.alt; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
            >
              {/* Avatar */}
              <div style={{
                width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                background: C.blueBg, border: `1px solid ${C.blueBd}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: C.blue,
              }}>
                {initials(emp.employeeName)}
              </div>

              {/* Name */}
              <div style={{ minWidth: 140, flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{emp.employeeName}</div>
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>
                  {emp.projects.filter(p => p.isAllocated).length} allocated · {driftProjects.length > 0 ? `${driftProjects.length} drift` : "no drift"}
                </div>
              </div>

              {/* Metrics strip */}
              <div style={{ flex: 1, display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>

                {/* Allocated vs Actual */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Allocated → Actual</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: C.mono, fontSize: 13, color: C.textMid }}>{fmtH(emp.allocatedTotal)}h</span>
                    <span style={{ color: C.mid, fontSize: 12 }}>→</span>
                    <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: C.text }}>{fmtH(emp.totalHours)}h</span>
                    {utilizationPct !== null && (
                      <span style={{
                        fontFamily: C.mono, fontSize: 11,
                        color: utilizationPct >= 0.85 ? C.green : utilizationPct >= 0.70 ? C.yellow : C.red,
                      }}>
                        ({pct(utilizationPct)})
                      </span>
                    )}
                  </div>
                </div>

                {/* Billable */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Billable</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: emp.billablePct >= 0.65 ? C.green : emp.billablePct >= 0.5 ? C.yellow : C.red }}>
                      {pct(emp.billablePct)}
                    </span>
                    <MiniBar value={emp.billablePct} color={emp.billablePct >= 0.65 ? C.green : emp.billablePct >= 0.5 ? C.yellow : C.red} />
                    <span style={{ fontFamily: C.mono, fontSize: 11, color: C.textSub }}>{fmtH(emp.billableHours)}h</span>
                  </div>
                </div>

                {/* Alignment */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Alignment</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: emp.alignPct >= 0.80 ? C.green : emp.alignPct >= 0.60 ? C.yellow : C.red }}>
                      {pct(emp.alignPct)}
                    </span>
                    <MiniBar value={emp.alignPct} color={emp.alignPct >= 0.80 ? C.green : emp.alignPct >= 0.60 ? C.yellow : C.red} />
                    {emp.driftHours > 0 && <span style={{ fontFamily: C.mono, fontSize: 11, color: C.orange }}>{fmtH(emp.driftHours)}h drift</span>}
                  </div>
                </div>

              </div>

              {/* RAG badge */}
              <div style={{ fontSize: 11, fontWeight: 700, background: rag.bg, color: rag.text, border: `1px solid ${rag.border}`, borderRadius: 6, padding: "4px 10px", flexShrink: 0 }}>
                {rag.label}
              </div>

              {/* Chevron */}
              <div style={{ fontSize: 14, color: C.textSub, width: 20, textAlign: "center", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0 }}>
                ▾
              </div>
            </div>

            {/* ── Expanded detail ─────────────────────────────────────────── */}
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}` }}>

                {/* Allocated projects section */}
                {allocProjects.length > 0 && (
                  <>
                    <div style={{ padding: "7px 18px", background: C.alt, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Allocated Projects
                    </div>
                    {allocProjects.map((p, i) => (
                      <ProjectRow key={p.projectId ?? "__internal__"} proj={p} allocHours={p.allocHours} isAllocated isLast={i === allocProjects.length - 1 && driftProjects.length === 0} />
                    ))}
                  </>
                )}

                {/* Drift section */}
                {driftProjects.length > 0 && (
                  <>
                    <div style={{ padding: "7px 18px", background: "#FFF8F0", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 6 }}>
                      ⚠ Other Time — not in allocation
                    </div>
                    {driftProjects.map((p, i) => (
                      <ProjectRow key={p.projectId ?? "__internal_drift__"} proj={p} allocHours={0} isAllocated={false} isLast={i === driftProjects.length - 1} />
                    ))}
                  </>
                )}

                {allocProjects.length === 0 && driftProjects.length === 0 && (
                  <div style={{ padding: "14px 18px", fontSize: 13, color: C.textSub, fontStyle: "italic" }}>No time logged in this period.</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      {!loading && enriched.length > 0 && (
        <div style={{ marginTop: 16, padding: "10px 16px", background: C.alt, borderRadius: 8, border: `1px solid ${C.border}`, display: "flex", gap: 24, flexWrap: "wrap", fontSize: 11, color: C.textSub }}>
          <span><strong style={{ color: C.text }}>Allocated</strong> — pro-rated from NS resource allocation records for this period</span>
          <span><strong style={{ color: C.text }}>Gap</strong> — actual minus allocated (+ = over, − = under)</span>
          <span><strong style={{ color: C.orange }}>Drift</strong> — time logged to projects not in their allocation</span>
          <span><strong style={{ color: C.text }}>Alignment</strong> — % of actual time on allocated projects · target ≥ 80%</span>
          <span><strong style={{ color: C.text }}>Billable target</strong> — 65%</span>
        </div>
      )}
    </div>
  );
}
