"use client";
import { useState, useCallback } from "react";
import { C } from "@/lib/constants";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { ProjectTable } from "@/components/dashboard/ProjectTable";
import { PhaseHeatmap } from "@/components/dashboard/PhaseHeatmap";
import { TaskCommandCenter } from "@/components/dashboard/TaskCommandCenter";
import { ResourceAllocation } from "@/components/dashboard/ResourceAllocation";
import { AiInsights } from "@/components/dashboard/AiInsights";
import type { Project, ProjectPhase } from "@/lib/types";

type Tab = "portfolio" | "tasks" | "resources";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "portfolio",  label: "📊 Portfolio Overview" },
  { id: "tasks",      label: "🗂️ Task Command Center" },
  { id: "resources",  label: "👥 Resource Allocation" },
];

interface DataState {
  projects: Project[];
  phases: ProjectPhase[];
  timebill: Array<{ employee: number; project_id: number; total_hours: number }>;
  updatedAt: string | null;
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [data, setData] = useState<DataState>({
    projects: [],
    phases: [],
    timebill: [],
    updatedAt: null,
  });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projRes, phaseRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/reports/phase-rag"),
      ]);

      const [projData, phaseData] = await Promise.all([
        projRes.json(),
        phaseRes.json(),
      ]);

      if (!projRes.ok)  throw new Error(projData.error  ?? "Failed to load projects");
      if (!phaseRes.ok) throw new Error(phaseData.error ?? "Failed to load phases");

      setData({
        projects:  projData.projects ?? [],
        phases:    phaseData.phases  ?? [],
        timebill:  [],
        updatedAt: projData.updatedAt ?? new Date().toISOString(),
      });
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const { projects, phases, timebill, updatedAt } = data;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: C.font }}>
      {/* Header */}
      <header style={{
        background: "#0D1117",
        borderBottom: "1px solid #1E2A3A",
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", gap: 16, height: 56 }}>
          {/* Logo */}
          <div style={{
            background: C.blue,
            borderRadius: 6,
            padding: "4px 10px",
            fontWeight: 800,
            fontSize: 13,
            color: "#fff",
            letterSpacing: "0.02em",
            flexShrink: 0,
          }}>
            CEBA
          </div>

          {/* Title */}
          <span style={{ color: "#F1F5F9", fontWeight: 600, fontSize: 15, flex: 1 }}>
            Project Management Dashboard
          </span>

          {/* Version */}
          <span style={{
            fontSize: 10, color: "#64748B", background: "#1E2A3A",
            borderRadius: 4, padding: "2px 7px", fontWeight: 600,
          }}>
            v1.0
          </span>

          {/* Refresh button */}
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              background: loading ? "#1E2A3A" : C.blue,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: C.font,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {loading ? (
              <>
                <span style={{
                  display: "inline-block", width: 10, height: 10,
                  border: "2px solid #fff", borderTopColor: "transparent",
                  borderRadius: "50%", animation: "spin 0.8s linear infinite",
                }} />
                Loading…
              </>
            ) : "↻ Refresh Data"}
          </button>

          {updatedAt && (
            <span style={{ fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>
              Updated {new Date(updatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}

          {/* Tab nav */}
          <nav style={{ display: "flex", gap: 4 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: C.font,
                  background: tab === t.id ? C.blue : "transparent",
                  color: tab === t.id ? "#fff" : "#64748B",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 24px" }}>
        {/* Error */}
        {error && (
          <div style={{
            background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8,
            padding: "12px 16px", marginBottom: 16, color: C.red, fontSize: 13, fontWeight: 500,
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Empty state */}
        {!hasLoaded && !loading && !error && (
          <div style={{
            background: C.surface, borderRadius: 10, padding: "48px 24px",
            textAlign: "center", border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: C.text, marginBottom: 8 }}>
              CEBA Solutions — Project Dashboard
            </div>
            <div style={{ color: C.textSub, fontSize: 14, marginBottom: 20 }}>
              Click <strong>Refresh Data</strong> to load live project data from NetSuite and ClickUp.
            </div>
            <button
              onClick={refresh}
              style={{
                background: C.blue, color: "#fff", border: "none", borderRadius: 7,
                padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: C.font,
              }}
            >
              ↻ Load Data
            </button>
          </div>
        )}

        {/* Portfolio Overview */}
        {hasLoaded && tab === "portfolio" && (
          <>
            <KpiCards projects={projects} />
            <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: C.sh, marginBottom: 20 }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 15, color: C.text }}>
                Active Projects
              </div>
              <ProjectTable projects={projects} />
            </div>
            {phases.length > 0 && (
              <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: C.sh, padding: "16px 20px" }}>
                <PhaseHeatmap
                  phases={phases}
                  projects={projects.map(p => ({ id: p.id, client: p.client, entityid: p.entityid }))}
                />
              </div>
            )}
          </>
        )}

        {/* Task Command Center */}
        {hasLoaded && tab === "tasks" && (
          <>
            <AiInsights projects={projects} selectedId={null} />
            <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: C.sh, padding: "16px 20px" }}>
              <TaskCommandCenter projects={projects} />
            </div>
          </>
        )}

        {/* Resource Allocation */}
        {hasLoaded && tab === "resources" && (
          <>
            <AiInsights projects={projects} selectedId={null} />
            <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: C.sh, padding: "16px 20px" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 16 }}>
                Resource Allocation — Hours by Consultant
              </div>
              <ResourceAllocation projects={projects} timebill={timebill} />
            </div>
          </>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
