"use client";
import { useState, useCallback, useEffect } from "react";
import { C } from "@/lib/constants";

interface ConsultantMetrics {
  id: number;
  name: string;
  quota: number;
  thisMonth: number;
  lastMonth: number;
  ytd: number;
  history: Array<{ key: string; label: string; count: number }>;
  rag: "green" | "yellow" | "red";
}

interface SROpp {
  id: number;
  title: string;
  client: string;
  nsUrl: string;
  date: string;
}

interface SRMetrics {
  consultants: ConsultantMetrics[];
  teamThisMonth: number;
  teamLastMonth: number;
  teamYTD: number;
  teamQuota: number;
  attainmentPct: number;
  monthHistory: Array<{ key: string; label: string; total: number; byConsultant: Record<string, number> }>;
  employeeIds: number[];
  oppsByConsultant: Record<string, Record<string, SROpp[]>>;
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: C.blue, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, fontFamily: C.font, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

const ragColor  = (r: string) => r === "green" ? C.green  : r === "yellow" ? C.yellow  : C.red;
const ragBg     = (r: string) => r === "green" ? C.greenBg : r === "yellow" ? C.yellowBg : C.redBg;
const ragBd     = (r: string) => r === "green" ? C.greenBd : r === "yellow" ? C.yellowBd : C.redBd;
const ragLabel  = (r: string) => r === "green" ? "On Track" : r === "yellow" ? "At Risk" : "Behind";

export function SRDashboardView() {
  const [data, setData]       = useState<SRMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [drill, setDrill]       = useState<{ title: string; opps: SROpp[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/service-requests/metrics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: C.textSub, fontSize: 14 }}>Loading SR metrics…</div>;
  if (error)   return <div style={{ padding: 24, background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, color: C.red, fontSize: 13 }}>⚠ {error}</div>;
  if (!data)   return null;

  const { consultants, teamThisMonth, teamLastMonth, teamYTD, teamQuota, attainmentPct, monthHistory, employeeIds, oppsByConsultant } = data;

  const openDrill = (consultantId: number, monthKey: string, label: string) => {
    const opps = oppsByConsultant?.[consultantId]?.[monthKey] ?? [];
    if (opps.length === 0) return;
    setDrill({ title: label, opps });
  };
  const onTrack   = consultants.filter(c => c.rag === "green").length;
  const atRisk    = consultants.filter(c => c.rag === "yellow").length;
  const behind    = consultants.filter(c => c.rag === "red").length;

  return (
    <div style={{ fontFamily: C.font }}>
      {/* Drilldown modal */}
      {drill && (
        <div onClick={() => setDrill(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.surface, borderRadius: 12, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", width: 560, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{drill.title}</div>
              <button onClick={() => setDrill(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: C.textSub, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "8px 0" }}>
              {drill.opps.map((opp, i) => (
                <div key={opp.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: i < drill.opps.length - 1 ? `1px solid ${C.border}` : "none", background: i % 2 === 0 ? "#fff" : C.alt }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{opp.title}</div>
                    <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>{opp.client}</div>
                  </div>
                  <a href={opp.nsUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 16, padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: "none", background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}`, whiteSpace: "nowrap", flexShrink: 0 }}>↗ NetSuite</a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>SR Performance Dashboard</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 2 }}>Consultant quota tracking · {teamQuota / consultants.length} SRs/month per consultant</div>
        </div>
        <button onClick={load} disabled={loading} style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font }}>
          ↻ Refresh
        </button>
      </div>

      {/* Team KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Team This Month", value: teamThisMonth, sub: `quota: ${teamQuota}`, color: attainmentPct >= 100 ? C.green : attainmentPct >= 60 ? C.yellow : C.red, bg: attainmentPct >= 100 ? C.greenBg : attainmentPct >= 60 ? C.yellowBg : C.redBg, bd: attainmentPct >= 100 ? C.greenBd : attainmentPct >= 60 ? C.yellowBd : C.redBd },
          { label: "Attainment",      value: `${attainmentPct}%`, sub: "of team quota",    color: attainmentPct >= 100 ? C.green : attainmentPct >= 60 ? C.yellow : C.red, bg: attainmentPct >= 100 ? C.greenBg : attainmentPct >= 60 ? C.yellowBg : C.redBg, bd: attainmentPct >= 100 ? C.greenBd : attainmentPct >= 60 ? C.yellowBd : C.redBd },
          { label: "Team YTD",        value: teamYTD,       sub: `vs ${teamLastMonth} last month`, color: C.blue,  bg: C.blueBg,   bd: C.blueBd  },
          { label: "🟢 On Track",     value: onTrack,       sub: `of ${consultants.length} consultants`, color: C.green,  bg: C.greenBg,  bd: C.greenBd },
          { label: "🔴 Behind",       value: behind,        sub: `${atRisk} at risk`,      color: behind > 0 ? C.red : C.green, bg: behind > 0 ? C.redBg : C.greenBg, bd: behind > 0 ? C.redBd : C.greenBd },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.bd}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color, fontFamily: C.mono, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Consultant quota cards */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Consultant Quota — This Month</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {consultants.map(c => (
            <div key={c.id} onClick={() => setExpanded(expanded === c.id ? null : c.id)} style={{ background: ragBg(c.rag), border: `1px solid ${ragBd(c.rag)}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer", transition: "box-shadow 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = C.shMd)}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Avatar name={c.name} size={32} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{c.name}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: "#fff", color: ragColor(c.rag), border: `1px solid ${ragBd(c.rag)}` }}>{ragLabel(c.rag)}</span>
                </div>
              </div>
              {/* Quota bar */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textSub, marginBottom: 4 }}>
                  <span>This month</span>
                  <span
                    onClick={e => { e.stopPropagation(); openDrill(c.id, data.months[data.months.length - 1], `${c.name} — ${data.monthHistory[data.monthHistory.length - 1]?.label}`); }}
                    style={{ fontFamily: C.mono, fontWeight: 700, color: ragColor(c.rag), cursor: c.thisMonth > 0 ? "pointer" : "default", textDecoration: c.thisMonth > 0 ? "underline" : "none" }}
                  >{c.thisMonth} / {c.quota}</span>
                </div>
                <div style={{ height: 6, background: "#ffffff80", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (c.thisMonth / c.quota) * 100)}%`, background: ragColor(c.rag), borderRadius: 3, transition: "width 0.4s" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: C.textSub }}>
                <span>Last mo: <strong style={{ color: C.text, fontFamily: C.mono }}>{c.lastMonth}</strong></span>
                <span>YTD: <strong style={{ color: C.text, fontFamily: C.mono }}>{c.ytd}</strong></span>
              </div>

              {/* Expanded history */}
              {expanded === c.id && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${ragBd(c.rag)}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Monthly History</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {c.history.map(h => (
                      <div key={h.key} style={{ flex: 1, textAlign: "center" }} onClick={e => { e.stopPropagation(); openDrill(c.id, h.key, `${c.name} — ${h.label}`); }}>
                        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: C.mono, color: h.count >= c.quota ? C.green : h.count >= 2 ? C.yellow : C.red, cursor: h.count > 0 ? "pointer" : "default", textDecoration: h.count > 0 ? "underline" : "none" }}>{h.count}</div>
                        <div style={{ fontSize: 9, color: C.textSub, marginTop: 2 }}>{h.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Monthly trend table */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Monthly Trend — Last 6 Months</div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.alt }}>
                <th style={{ padding: "9px 16px", textAlign: "left", fontWeight: 700, color: C.textSub, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${C.border}` }}>Month</th>
                {consultants.map(c => (
                  <th key={c.id} style={{ padding: "9px 14px", textAlign: "center", fontWeight: 700, color: C.textSub, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{c.name.split(" ")[0]}</th>
                ))}
                <th style={{ padding: "9px 14px", textAlign: "center", fontWeight: 700, color: C.blue, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${C.border}` }}>Total</th>
                <th style={{ padding: "9px 14px", textAlign: "center", fontWeight: 700, color: C.textSub, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${C.border}` }}>vs Quota</th>
              </tr>
            </thead>
            <tbody>
              {[...monthHistory].reverse().map((row, i) => {
                const quota = consultants.length * 3;
                const pct   = quota > 0 ? Math.round((row.total / quota) * 100) : 0;
                const isCurrentMonth = i === 0;
                return (
                  <tr key={row.key} style={{ background: isCurrentMonth ? C.blueBg : i % 2 === 0 ? "#fff" : C.alt, borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "9px 16px", fontWeight: isCurrentMonth ? 700 : 400, color: isCurrentMonth ? C.blue : C.text }}>
                      {row.label}{isCurrentMonth && <span style={{ marginLeft: 6, fontSize: 10, background: C.blue, color: "#fff", padding: "1px 6px", borderRadius: 8 }}>Current</span>}
                    </td>
                    {consultants.map(c => {
                      const count = row.byConsultant[c.id] ?? 0;
                      return (
                        <td key={c.id} style={{ padding: "9px 14px", textAlign: "center", fontFamily: C.mono, fontWeight: 700, color: count >= 3 ? C.green : count >= 2 ? C.yellow : count > 0 ? C.red : C.textSub, cursor: count > 0 ? "pointer" : "default" }}
                          onClick={() => openDrill(c.id, row.key, `${c.name.split(" ")[0]} — ${row.label}`)}>
                          {count ? <span style={{ textDecoration: "underline" }}>{count}</span> : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "9px 14px", textAlign: "center", fontFamily: C.mono, fontWeight: 800, color: C.blue }}>{row.total}</td>
                    <td style={{ padding: "9px 14px", textAlign: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: pct >= 100 ? C.greenBg : pct >= 60 ? C.yellowBg : C.redBg, color: pct >= 100 ? C.green : pct >= 60 ? C.yellow : C.red, border: `1px solid ${pct >= 100 ? C.greenBd : pct >= 60 ? C.yellowBd : C.redBd}` }}>
                        {pct}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
