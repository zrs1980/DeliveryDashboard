"use client";
import { useState, useEffect } from "react";
import { C } from "@/lib/constants";

const fmtH = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1)) + "h";
const fmtPct = (n: number) => Math.round(n * 100) + "%";

function pctColor(pct: number): string {
  if (pct >= 0.8) return C.green;
  if (pct >= 0.6) return C.yellow;
  return C.red;
}

const PERIOD_LABELS: Record<string, string> = {
  thisWeek:    "This Week",
  lastWeek:    "Last Week",
  thisMonth:   "This Month",
  lastMonth:   "Last Month",
  thisQuarter: "This Quarter",
  lastQuarter: "Last Quarter",
};
const PERIOD_KEYS = Object.keys(PERIOD_LABELS);

interface ProjectData {
  projectId: number | null;
  projectName: string;
  companyName: string;
  billable: number;
  utilizedNonBillable: number;
  nonUtilized: number;
  total: number;
  allocatedHours: number;
  variance: number;
}

interface PeriodData {
  billable: number;
  utilizedNonBillable: number;
  nonUtilized: number;
  total: number;
  billablePct: number;
  utilizationPct: number;
  projects: ProjectData[];
}

interface EmployeeData {
  employeeId: number;
  employeeName: string;
  periods: Record<string, PeriodData>;
}

interface ApiResponse {
  employees: EmployeeData[];
  updatedAt: string;
  error?: string;
}

const dash = (n: number) => n === 0 ? "—" : fmtH(n);

function varianceStyle(variance: number, allocated: number): { color: string; text: string } {
  if (allocated === 0) return { color: C.textSub, text: "—" };
  const ratio = Math.abs(variance) / allocated;
  const color = ratio <= 0.15 ? C.green : ratio <= 0.30 ? C.yellow : C.red;
  const sign  = variance > 0 ? "+" : "";
  return { color, text: sign + fmtH(variance) };
}

export function AdminUtilizationView() {
  const [period, setPeriod]       = useState<string>("thisMonth");
  const [data, setData]           = useState<ApiResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/utilization")
      .then(r => r.json())
      .then((d: ApiResponse) => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div style={{ fontFamily: C.font }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Consultant Utilization</div>
          {data?.updatedAt && (
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
              Updated {new Date(data.updatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {PERIOD_KEYS.map(pk => (
            <button
              key={pk}
              onClick={() => setPeriod(pk)}
              style={{
                padding: "5px 13px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                fontFamily: C.font, border: "none",
                background: period === pk ? C.blue : C.alt,
                color:      period === pk ? "#fff" : C.textMid,
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {PERIOD_LABELS[pk]}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: C.textSub, fontSize: 13 }}>
          Loading utilization data…
        </div>
      )}

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "12px 16px", color: C.red, fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {data && !loading && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          {/* Header row */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "200px 90px 100px 90px 90px 70px 70px 32px",
            background: C.alt,
            borderBottom: `1px solid ${C.border}`,
            padding: "8px 14px",
            fontSize: 11,
            fontWeight: 700,
            color: C.textSub,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            gap: 8,
          }}>
            <div>Consultant</div>
            <div style={{ textAlign: "right", fontFamily: C.mono }}>Billable</div>
            <div style={{ textAlign: "right", fontFamily: C.mono }}>Util (non-bill)</div>
            <div style={{ textAlign: "right", fontFamily: C.mono }}>Non-Util</div>
            <div style={{ textAlign: "right", fontFamily: C.mono }}>Total</div>
            <div style={{ textAlign: "right", fontFamily: C.mono }}>Bill%</div>
            <div style={{ textAlign: "right", fontFamily: C.mono }}>Util%</div>
            <div />
          </div>

          {data.employees.map((emp, idx) => {
            const p = emp.periods[period];
            const isExpanded = expanded.has(emp.employeeId);
            const isAlt = idx % 2 === 1;

            return (
              <div key={emp.employeeId}>
                {/* Summary row */}
                <div
                  onClick={() => toggle(emp.employeeId)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "200px 90px 100px 90px 90px 70px 70px 32px",
                    padding: "10px 14px",
                    background: isExpanded ? C.blueBg : isAlt ? C.alt : C.surface,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: "pointer",
                    alignItems: "center",
                    gap: 8,
                    transition: "background 0.1s",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{emp.employeeName}</div>

                  <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 13,
                    color: p.billable > 0 ? C.green : C.textSub, fontWeight: p.billable > 0 ? 600 : 400 }}>
                    {dash(p.billable)}
                  </div>

                  <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 13,
                    color: p.utilizedNonBillable > 0 ? C.blue : C.textSub, fontWeight: p.utilizedNonBillable > 0 ? 600 : 400 }}>
                    {dash(p.utilizedNonBillable)}
                  </div>

                  <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 13,
                    color: p.nonUtilized > 0 ? C.yellow : C.textSub, fontWeight: p.nonUtilized > 0 ? 600 : 400 }}>
                    {dash(p.nonUtilized)}
                  </div>

                  <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 13,
                    color: C.text, fontWeight: 600 }}>
                    {p.total > 0 ? fmtH(p.total) : "—"}
                  </div>

                  <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 13,
                    color: p.total > 0 ? pctColor(p.billablePct) : C.textSub, fontWeight: 600 }}>
                    {p.total > 0 ? fmtPct(p.billablePct) : "—"}
                  </div>

                  <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 13,
                    color: p.total > 0 ? pctColor(p.utilizationPct) : C.textSub, fontWeight: 600 }}>
                    {p.total > 0 ? fmtPct(p.utilizationPct) : "—"}
                  </div>

                  <div style={{ textAlign: "center", color: C.textSub, fontSize: 12, fontWeight: 700 }}>
                    {isExpanded ? "▲" : "▼"}
                  </div>
                </div>

                {/* Drill-down */}
                {isExpanded && (
                  <div style={{ background: "#F8FAFF", borderBottom: `1px solid ${C.border}` }}>
                    {/* Drill-down header */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "220px 90px 90px 90px 90px 100px 100px",
                      padding: "7px 28px",
                      borderBottom: `1px solid ${C.border}`,
                      fontSize: 10,
                      fontWeight: 700,
                      color: C.textSub,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      gap: 8,
                    }}>
                      <div>Project</div>
                      <div style={{ textAlign: "right", fontFamily: C.mono }}>Allocated</div>
                      <div style={{ textAlign: "right", fontFamily: C.mono }}>Actual</div>
                      <div style={{ textAlign: "right", fontFamily: C.mono }}>Variance</div>
                      <div style={{ textAlign: "right", fontFamily: C.mono }}>Billable</div>
                      <div style={{ textAlign: "right", fontFamily: C.mono }}>Util (non-bill)</div>
                      <div style={{ textAlign: "right", fontFamily: C.mono }}>Non-Util</div>
                    </div>

                    {p.projects.length === 0 && (
                      <div style={{ padding: "14px 28px", fontSize: 12, color: C.textSub }}>
                        No hours logged in this period.
                      </div>
                    )}

                    {p.projects.map((proj, pi) => {
                      const vs = varianceStyle(proj.variance, proj.allocatedHours);
                      return (
                        <div
                          key={proj.projectId ?? "__internal__" + pi}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "220px 90px 90px 90px 90px 100px 100px",
                            padding: "8px 28px",
                            borderBottom: pi < p.projects.length - 1 ? `1px solid ${C.border}` : "none",
                            background: pi % 2 === 0 ? "#F8FAFF" : C.surface,
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <div style={{ fontSize: 12, color: C.text, fontWeight: 500,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {proj.projectName}
                          </div>

                          <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 12, color: C.textMid }}>
                            {proj.allocatedHours > 0 ? fmtH(proj.allocatedHours) : "—"}
                          </div>

                          <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 12,
                            color: C.text, fontWeight: 600 }}>
                            {proj.total > 0 ? fmtH(proj.total) : "—"}
                          </div>

                          <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 12,
                            color: vs.color, fontWeight: 600 }}>
                            {vs.text}
                          </div>

                          <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 12,
                            color: proj.billable > 0 ? C.green : C.textSub }}>
                            {proj.billable > 0 ? fmtH(proj.billable) : "—"}
                          </div>

                          <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 12,
                            color: proj.utilizedNonBillable > 0 ? C.blue : C.textSub }}>
                            {proj.utilizedNonBillable > 0 ? fmtH(proj.utilizedNonBillable) : "—"}
                          </div>

                          <div style={{ textAlign: "right", fontFamily: C.mono, fontSize: 12,
                            color: proj.nonUtilized > 0 ? C.yellow : C.textSub }}>
                            {proj.nonUtilized > 0 ? fmtH(proj.nonUtilized) : "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {data.employees.length === 0 && !loading && (
            <div style={{ padding: "32px", textAlign: "center", fontSize: 13, color: C.textSub }}>
              No utilization data found for the selected period.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
