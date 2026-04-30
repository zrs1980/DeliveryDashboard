"use client";
import { useState, useCallback, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { C } from "@/lib/constants";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { ProjectTable } from "@/components/dashboard/ProjectTable";
import { PhaseHeatmap } from "@/components/dashboard/PhaseHeatmap";
import { TaskCommandCenter } from "@/components/dashboard/TaskCommandCenter";
import { ResourceAllocation } from "@/components/dashboard/ResourceAllocation";
import { TimeAnalysis } from "@/components/dashboard/TimeAnalysis";
import { TimeReview } from "@/components/dashboard/TimeReview";
import { ConsultantView } from "@/components/dashboard/ConsultantView";
import { CasesView } from "@/components/dashboard/CasesView";
import { AiInsights } from "@/components/dashboard/AiInsights";
import { CalendarView } from "@/components/dashboard/CalendarView";
import { WikiView } from "@/components/dashboard/WikiView";
import { ServiceRequestsView } from "@/components/dashboard/ServiceRequestsView";
import { EmployeeView } from "@/components/dashboard/EmployeeView";
import { CustomersView } from "@/components/dashboard/CustomersView";
import { AdminUtilizationView } from "@/components/dashboard/AdminUtilizationView";
import { PMView } from "@/components/dashboard/PMView";
import type { Project, ProjectPhase, NSAllocation } from "@/lib/types";

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

type Tab = "projects" | "tasks" | "resources" | "time" | "time-review" | "consultant" | "cases" | "calendar" | "wiki" | "service-requests" | "employee" | "customers" | "utilization" | "projectMgmt";

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "projects",   label: "Projects",    icon: "📊" },
  { id: "tasks",      label: "Tasks",       icon: "🗂️" },
  { id: "resources",  label: "Resource Allocation", icon: "👥" },
  { id: "time",        label: "Time Analysis", icon: "⏱️" },
  { id: "time-review", label: "Time Review",  icon: "🔍" },
  { id: "consultant",  label: "My Work",      icon: "👤" },
  { id: "cases",      label: "Cases",       icon: "🎫" },
  { id: "calendar",   label: "Calendar",    icon: "📅" },
  { id: "wiki",             label: "Company Wiki",    icon: "📚" },
  { id: "service-requests", label: "Service Requests", icon: "💼" },
  { id: "employee",         label: "My Leave",         icon: "🌴" },
  { id: "customers",        label: "Customers",        icon: "🏢" },
  { id: "projectMgmt",      label: "PM",               icon: "📋" },
  { id: "utilization",      label: "Utilization",      icon: "📈" },
];

interface DataState {
  projects: Project[];
  phases: ProjectPhase[];
  cases: NSCase[];
  allocations: NSAllocation[];
  updatedAt: string | null;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>("projects");
  const [taskSubTab, setTaskSubTab] = useState<"overdue" | "blocked">("overdue");
  const [splitPct, setSplitPct] = useState(42); // % width for ConsultantView panel
  const [showCalendar, setShowCalendar] = useState(false);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<DataState>({ projects: [], phases: [], cases: [], allocations: [], updatedAt: null });
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [casesError, setCasesError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCasesError(null);
    try {
      const [projRes, phaseRes, casesRes, resRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/reports/phase-rag"),
        fetch("/api/cases"),
        fetch("/api/resources"),
        fetch("/api/employee/sync", { method: "POST" }), // sync hire dates from NS → Supabase
      ]);
      const [projData, phaseData, casesData, resData] = await Promise.all([
        projRes.json(),
        phaseRes.json(),
        casesRes.json(),
        resRes.json(),
      ]);
      if (!projRes.ok)  throw new Error(projData.error  ?? "Failed to load projects");
      if (!phaseRes.ok) throw new Error(phaseData.error ?? "Failed to load phases");
      if (casesData.error) setCasesError(casesData.error);
      setData({
        projects:    projData.projects     ?? [],
        phases:      phaseData.phases      ?? [],
        cases:       casesData.cases       ?? [],
        allocations: resData.allocations   ?? [],
        updatedAt:   projData.updatedAt    ?? new Date().toISOString(),
      });
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const { projects, phases, cases, allocations, updatedAt } = data;

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
            <img
              src="/ceba-logo.webp"
              alt="CEBA Solutions"
              style={{ height: 36, width: "auto", objectFit: "contain", flexShrink: 0 }}
            />
            <div style={{ color: "#64748B", fontSize: 10, fontWeight: 500, letterSpacing: "0.04em" }}>
              PROJECT MANAGEMENT
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 30, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

          {/* Alert badges */}
          <div style={{ display: "flex", gap: 8, flex: 1, alignItems: "center" }}>
            {hasLoaded && totalOverdue > 0 && (
              <button onClick={() => { setTaskSubTab("overdue"); setTab("tasks"); }} style={{ fontSize: 11, fontWeight: 700, background: "rgba(192,57,43,0.15)", color: "#F87171", border: "1px solid rgba(192,57,43,0.3)", borderRadius: 6, padding: "3px 10px", whiteSpace: "nowrap", cursor: "pointer", fontFamily: C.font }}>
                ⚠ {totalOverdue} overdue
              </button>
            )}
            {hasLoaded && totalBlocked > 0 && (
              <button onClick={() => { setTaskSubTab("blocked"); setTab("tasks"); }} style={{ fontSize: 11, fontWeight: 700, background: "rgba(180,83,9,0.15)", color: "#FB923C", border: "1px solid rgba(180,83,9,0.3)", borderRadius: 6, padding: "3px 10px", whiteSpace: "nowrap", cursor: "pointer", fontFamily: C.font }}>
                🚫 {totalBlocked} blocked
              </button>
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

          {/* Signed-in user */}
          {session?.user && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {session.user.image
                ? <img src={session.user.image} alt="" style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)" }} />
                : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#1A56DB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>
                    {(session.user.name ?? session.user.email ?? "?")[0].toUpperCase()}
                  </div>
              }
              <span style={{ fontSize: 11, color: "#94A3B8", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.user.name ?? session.user.email}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "3px 9px", fontSize: 11, color: "#64748B", cursor: "pointer", fontFamily: C.font }}
              >
                Sign out
              </button>
            </div>
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
          <a
            href="https://3550424.app.netsuite.com/app/accounting/transactions/time/weeklytimebill.nl"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: "rgba(255,255,255,0.08)", color: "#F1F5F9",
              border: "1px solid rgba(255,255,255,0.15)",
              textDecoration: "none", whiteSpace: "nowrap",
              display: "flex", alignItems: "center", gap: 6,
              transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          >
            ⏱ Enter Time
          </a>
        </div>

        {/* Tab nav bar */}
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 28px", display: "flex", gap: 2, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {TABS.filter(t => t.id !== "utilization" || session?.user?.email === "zabe@cebasolutions.com").map(t => (
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

        {!hasLoaded && !loading && !error && tab !== "wiki" && tab !== "service-requests" && tab !== "employee" && (
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
            <KpiCards projects={projects.filter(p => !p.isInternal)} />
            <AiInsights projects={projects.filter(p => !p.isInternal)} />
            <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", marginBottom: 24, overflow: "hidden" }}>
              <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Active Projects</div>
                <div style={{ fontSize: 12, color: C.textSub }}>{projects.filter(p => !p.isInternal).length} projects</div>
              </div>
              <ProjectTable
                projects={projects.filter(p => !p.isInternal)}
                phases={phases}
                onProjectsChange={updated => setData(d => ({ ...d, projects: updated }))}
              />
            </div>
          </>
        )}

        {/* Tasks */}
        {hasLoaded && tab === "tasks" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <TaskCommandCenter
              projects={projects}
              onProjectsChange={updated => setData(d => ({ ...d, projects: updated }))}
              initialTab={taskSubTab}
            />
          </div>
        )}

        {/* Resources */}
        {hasLoaded && tab === "resources" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <ResourceAllocation allocations={allocations} />
          </div>
        )}

        {/* Time Analysis */}
        {tab === "time" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <TimeAnalysis />
          </div>
        )}

        {/* Time Review */}
        {tab === "time-review" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <TimeReview />
          </div>
        )}

        {/* My Work — task list with optional calendar split */}
        {hasLoaded && tab === "consultant" && (
          <div
            ref={splitContainerRef}
            style={{ display: "flex", flexDirection: "column", gap: 0, height: "calc(100vh - 148px)", minHeight: 500 }}
          >
            {/* Toggle bar */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, flexShrink: 0 }}>
              <button
                onClick={() => setShowCalendar(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: showCalendar ? C.blue : C.surface,
                  color: showCalendar ? "#fff" : C.textMid,
                  border: `1px solid ${showCalendar ? C.blue : C.border}`,
                  borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: C.font, transition: "all 0.15s",
                }}
              >
                📅 {showCalendar ? "Hide Calendar" : "Show Calendar"}
              </button>
            </div>

            {/* Content row */}
            <div
              style={{ display: "flex", flex: 1, overflow: "hidden", userSelect: splitDragging.current ? "none" : undefined }}
              onMouseMove={e => {
                if (!splitDragging.current || !splitContainerRef.current) return;
                const rect = splitContainerRef.current.getBoundingClientRect();
                const pct = Math.min(70, Math.max(25, ((e.clientX - rect.left) / rect.width) * 100));
                setSplitPct(pct);
              }}
              onMouseUp={() => { splitDragging.current = false; }}
              onMouseLeave={() => { splitDragging.current = false; }}
            >
              {/* Left: My Work */}
              <div style={{ width: showCalendar ? `${splitPct}%` : "100%", overflowY: "auto", background: C.bg, paddingRight: showCalendar ? 2 : 0, transition: "width 0.2s" }}>
                <ConsultantView projects={projects} cases={cases} />
              </div>

              {showCalendar && (
                <>
                  {/* Resize divider */}
                  <div
                    onMouseDown={() => { splitDragging.current = true; }}
                    style={{
                      width: 6, flexShrink: 0, cursor: "col-resize",
                      background: C.border, transition: "background 0.15s",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = C.blue; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = C.border; }}
                    title="Drag to resize"
                  >
                    <div style={{ width: 2, height: 32, borderRadius: 2, background: "currentColor", opacity: 0.4 }} />
                  </div>

                  {/* Right: Calendar */}
                  <div style={{ flex: 1, overflow: "hidden", background: "#fff", borderRadius: "0 12px 12px 0", border: `1px solid ${C.border}`, borderLeft: "none" }}>
                    <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textSub }}>
                      📅 <strong style={{ color: C.text }}>Calendar</strong> — drag tasks from the left panel onto a time slot to schedule them
                    </div>
                    <CalendarView projects={projects} cases={cases} hideSidebar />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Cases */}
        {hasLoaded && tab === "cases" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Support Cases</div>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 18 }}>Open cases from NetSuite — support desk manager view.</div>
            <CasesView cases={cases} error={casesError} />
          </div>
        )}

        {/* Service Requests */}
        {tab === "service-requests" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "24px 28px" }}>
            <ServiceRequestsView />
          </div>
        )}

        {/* Employee Leave */}
        {tab === "employee" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "24px 28px" }}>
            <EmployeeView />
          </div>
        )}

        {/* Customers */}
        {tab === "customers" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "24px 28px" }}>
            <CustomersView />
          </div>
        )}

        {/* Project Management */}
        {hasLoaded && tab === "projectMgmt" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <PMView projects={projects} />
          </div>
        )}

        {/* Utilization (admin only) */}
        {hasLoaded && tab === "utilization" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <AdminUtilizationView />
          </div>
        )}

        {/* Wiki */}
        {tab === "wiki" && (
          <WikiView userEmail={session?.user?.email} />
        )}

        {/* Calendar */}
        {tab === "calendar" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", overflow: "hidden" }}>
            <div style={{ padding: "14px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Calendar</div>
                <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>Drag tasks and cases onto the calendar to schedule them as Google Calendar events.</div>
              </div>
              {!hasLoaded && (
                <button
                  onClick={refresh}
                  style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 7, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}
                >
                  Load Tasks First
                </button>
              )}
            </div>
            <CalendarView projects={projects} cases={cases} />
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
