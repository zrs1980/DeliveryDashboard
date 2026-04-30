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

const APPROVAL_LABELS: Record<string, string> = {
  "1": "Pending",
  "2": "Approved",
  "3": "Rejected",
};

interface TimeEntry {
  id: number;
  date: string;
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

function initials(name: string): string {
  return name.split(" ").map(n => n[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export function TimeReview() {
  const [period, setPeriod]     = useState("thisMonth");
  const [data, setData]         = useState<EmployeeData[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function load(p: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/time-review?period=${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load time records");
      setData(json.employees ?? []);
      setUpdatedAt(json.updatedAt ?? null);
      setExpanded(new Set()); // collapse all on reload
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(period); }, [period]);

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const totalEntries = data.reduce((s, e) => s + e.entries.length, 0);
  const totalHours   = data.reduce((s, e) => s + e.totalHours, 0);

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Time Review</div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>
            Individual time records by resource — including memos
          </div>
        </div>

        {/* Period selector */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              style={{
                padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: C.font,
                background: period === p.id ? C.blue : C.surface,
                color:      period === p.id ? "#fff" : C.textMid,
                border:     `1px solid ${period === p.id ? C.blue : C.border}`,
                borderRadius: 6, cursor: "pointer", transition: "all 0.15s",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary bar ───────────────────────────────────────────────────────── */}
      {!loading && data.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 24 }}>
            <div>
              <span style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: C.text }}>
                {Math.round(totalHours * 100) / 100}h
              </span>
              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 6 }}>total logged</span>
            </div>
            <div>
              <span style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: C.textMid }}>
                {totalEntries}
              </span>
              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 6 }}>entries</span>
            </div>
            <div>
              <span style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: C.text }}>
                {data.length}
              </span>
              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 6 }}>resources</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {updatedAt && (
              <span style={{ fontSize: 11, color: C.textSub }}>
                {new Date(updatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={() => setExpanded(new Set(data.map(e => e.employeeId)))}
              style={{ fontSize: 12, color: C.blue, background: "none", border: "none", cursor: "pointer", fontFamily: C.font, fontWeight: 600 }}
            >
              Expand all
            </button>
            <span style={{ color: C.mid, fontSize: 12 }}>·</span>
            <button
              onClick={() => setExpanded(new Set())}
              style={{ fontSize: 12, color: C.blue, background: "none", border: "none", cursor: "pointer", fontFamily: C.font, fontWeight: 600 }}
            >
              Collapse all
            </button>
          </div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.red, fontSize: 13, fontWeight: 500 }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Loading skeleton ──────────────────────────────────────────────────── */}
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

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {!loading && !error && data.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 24px", color: C.textSub, fontSize: 14 }}>
          No time records found for this period.
        </div>
      )}

      {/* ── Employee cards ────────────────────────────────────────────────────── */}
      {!loading && data.map(emp => {
        const isExpanded  = expanded.has(emp.employeeId);
        const billablePct = emp.totalHours > 0 ? Math.round((emp.billableHours / emp.totalHours) * 100) : 0;

        return (
          <div
            key={emp.employeeId}
            style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 10, overflow: "hidden", boxShadow: C.sh }}
          >
            {/* ── Collapsed header ────────────────────────────────────────────── */}
            <div
              onClick={() => toggleExpand(emp.employeeId)}
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

              {/* Name + entry count */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{emp.employeeName}</div>
                <div style={{ fontSize: 12, color: C.textSub, marginTop: 1 }}>
                  {emp.entries.length} {emp.entries.length === 1 ? "entry" : "entries"}
                </div>
              </div>

              {/* Billable pct pill */}
              <div style={{
                fontSize: 11, fontWeight: 700, fontFamily: C.mono,
                background: billablePct >= 65 ? C.greenBg : billablePct >= 50 ? C.yellowBg : C.redBg,
                color:      billablePct >= 65 ? C.green   : billablePct >= 50 ? C.yellow   : C.red,
                border:     `1px solid ${billablePct >= 65 ? C.greenBd : billablePct >= 50 ? C.yellowBd : C.redBd}`,
                borderRadius: 6, padding: "3px 8px",
              }}>
                {billablePct}% billable
              </div>

              {/* Total hours */}
              <div style={{ textAlign: "right", minWidth: 70 }}>
                <div style={{ fontFamily: C.mono, fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1 }}>
                  {emp.totalHours}h
                </div>
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
                  {emp.billableHours}h billable
                </div>
              </div>

              {/* Chevron */}
              <div style={{
                fontSize: 14, color: C.textSub, flexShrink: 0, width: 20, textAlign: "center",
                transition: "transform 0.2s",
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}>
                ▾
              </div>
            </div>

            {/* ── Expanded entries ────────────────────────────────────────────── */}
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}` }}>

                {/* Column headers */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "100px 1fr 72px 140px",
                  gap: 0,
                  padding: "7px 18px",
                  background: C.alt,
                  borderBottom: `1px solid ${C.border}`,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: C.textSub,
                }}>
                  <div>DATE</div>
                  <div>PROJECT / MEMO</div>
                  <div style={{ textAlign: "right" }}>HOURS</div>
                  <div style={{ paddingLeft: 16 }}>FLAGS</div>
                </div>

                {emp.entries.length === 0 && (
                  <div style={{ padding: "14px 18px", fontSize: 13, color: C.textSub, fontStyle: "italic" }}>
                    No entries in this period.
                  </div>
                )}

                {emp.entries.map((entry, i) => {
                  const approvalLabel = APPROVAL_LABELS[entry.approvalStatus] ?? (entry.approvalStatus || "—");
                  const isApproved = entry.approvalStatus === "2";
                  const isPending  = entry.approvalStatus === "1";

                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "100px 1fr 72px 140px",
                        gap: 0,
                        padding: "10px 18px",
                        borderBottom: i < emp.entries.length - 1 ? `1px solid ${C.border}` : "none",
                        background: i % 2 === 0 ? C.surface : C.alt,
                        alignItems: "start",
                      }}
                    >
                      {/* Date */}
                      <div style={{ fontFamily: C.mono, fontSize: 12, color: C.textMid, paddingTop: 2 }}>
                        {entry.date}
                      </div>

                      {/* Project + memo */}
                      <div style={{ paddingRight: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: entry.memo ? 4 : 0 }}>
                          {entry.projectName}
                        </div>
                        {entry.memo && (
                          <div style={{ fontSize: 12, color: C.textSub, fontStyle: "italic", lineHeight: 1.45 }}>
                            "{entry.memo}"
                          </div>
                        )}
                      </div>

                      {/* Hours */}
                      <div style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.text, textAlign: "right", paddingTop: 2 }}>
                        {entry.hours}h
                      </div>

                      {/* Flags */}
                      <div style={{ display: "flex", gap: 4, paddingLeft: 16, flexWrap: "wrap", paddingTop: 2 }}>
                        {entry.isBillable && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBd}`, borderRadius: 4, padding: "2px 6px" }}>B</span>
                        )}
                        {entry.isUtilized && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 4, padding: "2px 6px" }}>U</span>
                        )}
                        {entry.isProductive && (
                          <span style={{ fontSize: 10, fontWeight: 700, background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}`, borderRadius: 4, padding: "2px 6px" }}>P</span>
                        )}
                        <span style={{
                          fontSize: 10, fontWeight: 600,
                          background: isApproved ? C.greenBg : isPending ? C.yellowBg : C.alt,
                          color:      isApproved ? C.green   : isPending ? C.yellow   : C.textSub,
                          border:     `1px solid ${isApproved ? C.greenBd : isPending ? C.yellowBd : C.border}`,
                          borderRadius: 4, padding: "2px 6px",
                        }}>
                          {approvalLabel}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
