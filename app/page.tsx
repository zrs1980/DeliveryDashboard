"use client";
import { useState, useCallback } from "react";
import { C } from "@/lib/constants";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { ProjectTable } from "@/components/dashboard/ProjectTable";
import { PhaseHeatmap } from "@/components/dashboard/PhaseHeatmap";
import { TaskCommandCenter } from "@/components/dashboard/TaskCommandCenter";
import { ResourceAllocation } from "@/components/dashboard/ResourceAllocation";
import { ConsultantView } from "@/components/dashboard/ConsultantView";
import { CasesView } from "@/components/dashboard/CasesView";
import { AiInsights } from "@/components/dashboard/AiInsights";
import type { Project, ProjectPhase } from "@/lib/types";

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

type Tab = "projects" | "tasks" | "resources" | "consultant" | "cases";

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "projects",   label: "Projects",    icon: "📊" },
  { id: "tasks",      label: "Tasks",       icon: "🗂️" },
  { id: "resources",  label: "Resources",   icon: "👥" },
  { id: "consultant", label: "My Work",     icon: "👤" },
  { id: "cases",      label: "Cases",       icon: "🎫" },
];

interface DataState {
  projects: Project[];
  phases: ProjectPhase[];
  cases: NSCase[];
  updatedAt: string | null;
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("projects");
  const [data, setData] = useState<DataState>({ projects: [], phases: [], cases: [], updatedAt: null });
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [casesError, setCasesError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCasesError(null);
    try {
      const [projRes, phaseRes, casesRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/reports/phase-rag"),
        fetch("/api/cases"),
      ]);
      const [projData, phaseData, casesData] = await Promise.all([
        projRes.json(),
        phaseRes.json(),
        casesRes.json(),
      ]);
      if (!projRes.ok)  throw new Error(projData.error  ?? "Failed to load projects");
      if (!phaseRes.ok) throw new Error(phaseData.error ?? "Failed to load phases");
      if (casesData.error) setCasesError(casesData.error);
      setData({
        projects:  projData.projects  ?? [],
        phases:    phaseData.phases   ?? [],
        cases:     casesData.cases    ?? [],
        updatedAt: projData.updatedAt ?? new Date().toISOString(),
      });
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const { projects, phases, cases, updatedAt } = data;

  const totalOverdue = projects.reduce((s, p) => s + p.tasks.filter(t => {
    const st = t.status.status.toLowerCase();
    const done = st === "done" || st === "complete" || st === "supplied";
    return !done && !!t.due_date && parseInt(t.due_date) < Date.now();
  }).length, 0);
  const totalBlocked = projects.reduce((s, p) => s + p.blocked.length, 0);

  return (
    <div style={{ background: "#F0F4F8", minHeight: "100vh", fontFamily: C.font }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header style={{
        background: "linear-gradient(135deg, #0A0F1E 0%, #0D1B35 50%, #0A1628 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 28px", display: "flex", alignItems: "center", gap: 16, height: 60 }}>

          {/* CEBA Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: "linear-gradient(135deg, #1A56DB, #3B82F6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 8px rgba(26,86,219,0.5)",
              flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v10l9 5 9-5V7L12 2z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="M12 2v20M3 7l9 5 9-5" stroke="#fff" strokeWidth="1.4" strokeOpacity="0.6"/>
              </svg>
            </div>
            <div>
              <div style={{ color: "#F1F5F9", fontWeight: 800, fontSize: 15, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                CEBA Solutions
              </div>
              <div style={{ color: "#64748B", fontSize: 10, fontWeight: 500, letterSpacing: "0.04em" }}>
                PROJECT MANAGEMENT
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 30, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

          {/* Alert badges */}
          <div style={{ display: "flex", gap: 8, flex: 1, alignItems: "center" }}>
            {hasLoaded && totalOverdue > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, background: "rgba(192,57,43,0.15)", color: "#F87171", border: "1px solid rgba(192,57,43,0.3)", borderRadius: 6, padding: "3px 10px", whiteSpace: "nowrap" }}>
                ⚠ {totalOverdue} overdue
              </span>
            )}
            {hasLoaded && totalBlocked > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, background: "rgba(180,83,9,0.15)", color: "#FB923C", border: "1px solid rgba(180,83,9,0.3)", borderRadius: 6, padding: "3px 10px", whiteSpace: "nowrap" }}>
                🚫 {totalBlocked} blocked
              </span>
            )}
            {hasLoaded && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginLeft: 4, whiteSpace: "nowrap" }}>
                {projects.length} active projects
              </span>
            )}
          </div>

          {updatedAt && (
            <span style={{ fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>
              Updated {new Date(updatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}

          <button
            onClick={refresh}
            disabled={loading}
            style={{
              background: loading ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #1A56DB, #2563EB)",
              color: "#fff", border: loading ? "1px solid rgba(255,255,255,0.1)" : "none",
              borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font,
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
              boxShadow: loading ? "none" : "0 2px 8px rgba(26,86,219,0.4)",
              transition: "opacity 0.15s",
            }}
          >
            {loading ? (
              <>
                <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                Loading…
              </>
            ) : "↻ Refresh Data"}
          </button>
        </div>

        {/* Tab nav bar */}
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 28px", display: "flex", gap: 2, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "9px 18px", fontSize: 12.5, fontWeight: 600, fontFamily: C.font,
                background: "none", border: "none",
                borderBottom: tab === t.id ? "2px solid #3B82F6" : "2px solid transparent",
                color: tab === t.id ? "#93C5FD" : "#475569",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                transition: "color 0.15s, border-color 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontSize: 13 }}>{t.icon}</span>
              {t.label}
              {t.id === "cases" && cases.length > 0 && (
                <span style={{ fontSize: 10, background: "rgba(59,130,246,0.2)", color: "#60A5FA", borderRadius: 10, padding: "1px 6px", fontWeight: 700 }}>
                  {cases.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "24px 28px" }}>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: "12px 18px", marginBottom: 20, color: C.red, fontSize: 13, fontWeight: 500 }}>
            ⚠ {error}
          </div>
        )}

        {!hasLoaded && !loading && !error && (
          <div style={{ background: "#fff", borderRadius: 16, padding: "64px 24px", textAlign: "center", border: `1px solid ${C.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16, margin: "0 auto 20px",
              background: "linear-gradient(135deg, #EBF5FF, #DBEAFE)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
            }}>📊</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: C.text, marginBottom: 8 }}>
              CEBA Solutions — Project Dashboard
            </div>
            <div style={{ color: C.textSub, fontSize: 14, marginBottom: 28, maxWidth: 420, margin: "0 auto 28px" }}>
              Real-time project health, task tracking, and resource allocation across all active NetSuite implementations.
            </div>
            <button onClick={refresh} style={{ background: "linear-gradient(135deg, #1A56DB, #2563EB)", color: "#fff", border: "none", borderRadius: 10, padding: "12px 32px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: C.font, boxShadow: "0 4px 14px rgba(26,86,219,0.35)" }}>
              ↻ Load Live Data
            </button>
          </div>
        )}

        {/* Projects */}
        {hasLoaded && tab === "projects" && (
          <>
            <KpiCards projects={projects} />
            <AiInsights projects={projects} />
            <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", marginBottom: 24, overflow: "hidden" }}>
              <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Active Projects</div>
                <div style={{ fontSize: 12, color: C.textSub }}>{projects.length} projects</div>
              </div>
              <ProjectTable
                projects={projects}
                phases={phases}
                onProjectsChange={updated => setData(d => ({ ...d, projects: updated }))}
              />
            </div>
            {phases.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
                <PhaseHeatmap phases={phases} projects={projects.map(p => ({ id: p.id, client: p.client, entityid: p.entityid }))} />
              </div>
            )}
          </>
        )}

        {/* Tasks */}
        {hasLoaded && tab === "tasks" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <TaskCommandCenter
              projects={projects}
              onProjectsChange={updated => setData(d => ({ ...d, projects: updated }))}
            />
          </div>
        )}

        {/* Resources */}
        {hasLoaded && tab === "resources" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Resource Allocation</div>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 18 }}>Task load and estimated hours remaining per consultant, derived from ClickUp task assignments.</div>
            <ResourceAllocation projects={projects} />
          </div>
        )}

        {/* My Work */}
        {hasLoaded && tab === "consultant" && (
          <ConsultantView projects={projects} cases={cases} />
        )}

        {/* Cases */}
        {hasLoaded && tab === "cases" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Support Cases</div>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 18 }}>Open cases from NetSuite — support desk manager view.</div>
            <CasesView cases={cases} error={casesError} />
          </div>
        )}

      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
      `}</style>
    </div>
  );
}
