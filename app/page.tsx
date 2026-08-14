"use client";
import { useState, useCallback, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { C, PTO_APPROVER_EMAILS } from "@/lib/constants";
import { startOfToday } from "@/lib/clickup";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { ProjectTable } from "@/components/dashboard/ProjectTable";
import { PhaseHeatmap } from "@/components/dashboard/PhaseHeatmap";
import { TaskCommandCenter } from "@/components/dashboard/TaskCommandCenter";
import { ResourceAllocation } from "@/components/dashboard/ResourceAllocation";
import { TimeAnalysis } from "@/components/dashboard/TimeAnalysis";
import { ConsultantView } from "@/components/dashboard/ConsultantView";
import { CasesView } from "@/components/dashboard/CasesView";
import { AiInsights } from "@/components/dashboard/AiInsights";
import { CalendarView } from "@/components/dashboard/CalendarView";
import { MeetingsView } from "@/components/dashboard/MeetingsView";
import { FirefliesMeetingsView } from "@/components/dashboard/FirefliesMeetingsView";
import { WikiView } from "@/components/dashboard/WikiView";
import { ServiceRequestsView } from "@/components/dashboard/ServiceRequestsView";
import { SRDashboardView } from "@/components/dashboard/SRDashboardView";
import { EmployeeView } from "@/components/dashboard/EmployeeView";
import { CustomersView } from "@/components/dashboard/CustomersView";
import { AdminUtilizationView } from "@/components/dashboard/AdminUtilizationView";
import { PMView } from "@/components/dashboard/PMView";
import { ManagerReview } from "@/components/dashboard/ManagerReview";
import { ManagerPTOView } from "@/components/dashboard/ManagerPTOView";
import type { Project, ProjectPhase, NSAllocation, ConsultantRosterEntry } from "@/lib/types";

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

type Tab = "projects" | "tasks" | "resources" | "delivery-time" | "time" | "mgr-review" | "consultant" | "cases" | "calendar" | "wiki" | "service-requests" | "employee" | "customers" | "utilization" | "projectMgmt" | "mgr-pto" | "meetings" | "fireflies";

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "projects",   label: "Projects",    icon: "📊" },
  { id: "tasks",      label: "Tasks",       icon: "🗂️" },
  { id: "resources",      label: "Resource Allocation", icon: "👥" },
  { id: "delivery-time", label: "Delivery Time",       icon: "🚚" },
  { id: "time",          label: "Time Analysis",       icon: "⏱️" },
  { id: "mgr-review",  label: "Manager Review", icon: "📋" },
  { id: "consultant",  label: "My Work",         icon: "👤" },
  { id: "cases",      label: "Cases",       icon: "🎫" },
  { id: "calendar",   label: "Calendar",    icon: "📅" },
  // "meetings" (Zoom) and "utilization" are intentionally absent from the nav.
  // Their Tab ids, routes and views are left in place so restoring either is a
  // one-line change here.
  { id: "fireflies",  label: "Fireflies Meetings", icon: "🪰" },
  { id: "wiki",             label: "Company Wiki",    icon: "📚" },
  { id: "service-requests", label: "Service Requests", icon: "💼" },
  { id: "employee",         label: "My Leave",         icon: "🌴" },
  { id: "customers",        label: "Customers",        icon: "🏢" },
  { id: "projectMgmt",      label: "PM",               icon: "📋" },
  { id: "mgr-pto",          label: "Manager PTO",      icon: "🗓️" },
];

interface DataState {
  projects: Project[];
  phases: ProjectPhase[];
  cases: NSCase[];
  allocations: NSAllocation[];
  consultantRoster: ConsultantRosterEntry[];
  updatedAt: string | null;
}

type SRSubTab   = "pipeline" | "dashboard";
type SRPipelineTab = "active" | "nurturing" | "raw";

function SRRawDebug() {
  const [rows, setRows]     = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/debug/sr-raw");
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []);

  useState(() => { load(); });

  if (loading) return <div style={{ padding: 24, color: C.textSub }}>Loading…</div>;
  if (error)   return <div style={{ padding: 24, color: C.red }}>⚠ {error}</div>;
  if (!rows.length) return <div style={{ padding: 24, color: C.textSub }}>No rows returned.</div>;

  const cols = ["id", "tranid", "title", "custbody_ceba_sales_pipeline", "custbody_sr_indentified_by"];
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ fontSize: 12, color: C.textSub, marginBottom: 8 }}>{rows.length} rows</div>
      <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: C.mono, width: "100%" }}>
        <thead>
          <tr>{cols.map(c => <th key={c} style={{ padding: "6px 10px", background: C.alt, border: `1px solid ${C.border}`, textAlign: "left", whiteSpace: "nowrap", color: C.textMid, fontWeight: 700 }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r: any, i: number) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : C.alt }}>
              {cols.map(c => <td key={c} style={{ padding: "5px 10px", border: `1px solid ${C.border}`, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: r[c] == null ? C.textSub : C.text }}>{r[c] == null ? "—" : String(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <pre style={{ marginTop: 16, background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, fontSize: 11, fontFamily: C.mono, overflow: "auto", maxHeight: 300 }}>{JSON.stringify(rows[0], null, 2)}</pre>
    </div>
  );
}

function SubTabBar<T extends string>({ tabs, active, onChange }: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  }) {
  return (
    <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, padding: "0 24px" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: "12px 20px", fontSize: 13,
          fontWeight: active === t.id ? 700 : 500,
          color: active === t.id ? C.blue : C.textSub,
          background: "transparent", border: "none",
          borderBottom: active === t.id ? `2px solid ${C.blue}` : "2px solid transparent",
          cursor: "pointer", fontFamily: C.font, marginBottom: -1,
        }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ServiceRequestsShell() {
  const [srTab,       setSrTab]       = useState<SRSubTab>("pipeline");
  const [pipelineTab, setPipelineTab] = useState<SRPipelineTab>("active");

  const SR_TABS: Array<{ id: SRSubTab; label: string }> = [
    { id: "pipeline",  label: "SR Pipeline"  },
    { id: "dashboard", label: "SR Dashboard" },
  ];
  const PIPELINE_TABS: Array<{ id: SRPipelineTab; label: string }> = [
    { id: "active",    label: "Active"    },
    { id: "nurturing", label: "Nurturing" },
    { id: "raw",       label: "🔍 Raw Data" },
  ];

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
      {/* Top sub-tab bar: SR Pipeline / SR Dashboard */}
      <SubTabBar tabs={SR_TABS} active={srTab} onChange={setSrTab} />

      {srTab === "pipeline" && (
        <>
          {/* Second-level tab bar: Active / Nurturing */}
          <div style={{ background: C.alt, borderBottom: `1px solid ${C.border}`, padding: "0 28px" }}>
            <SubTabBar tabs={PIPELINE_TABS} active={pipelineTab} onChange={setPipelineTab} />
          </div>
          <div style={{ padding: "24px 28px" }}>
            {pipelineTab === "raw" ? <SRRawDebug /> : <ServiceRequestsView filter={pipelineTab === "active" ? "Active" : "Nurturing"} />}
          </div>
        </>
      )}
      {srTab === "dashboard" && (
        <div style={{ padding: "24px 28px" }}>
          <SRDashboardView />
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>("projects");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [taskSubTab, setTaskSubTab] = useState<"overdue" | "blocked">("overdue");
  const [splitPct, setSplitPct] = useState(42); // % width for ConsultantView panel
  const [showCalendar, setShowCalendar] = useState(false);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<DataState>({ projects: [], phases: [], cases: [], allocations: [], consultantRoster: [], updatedAt: null });
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
        allocations:      resData.allocations      ?? [],
        consultantRoster: resData.consultantRoster ?? [],
        updatedAt:        projData.updatedAt       ?? new Date().toISOString(),
      });
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const { projects, phases, cases, allocations, consultantRoster, updatedAt } = data;

  const totalOverdue = projects.reduce((s, p) => s + p.tasks.filter(t => {
    // Counts "supplied" as finished as well, which isOverdueTask deliberately
    // does not — hence the local rule rather than the shared helper. The date
    // test still has to be startOfToday(), not Date.now(): see startOfToday.
    const st = t.status.status.toLowerCase();
    const done = st === "done" || st === "complete" || st === "supplied";
    return !done && !!t.due_date && parseInt(t.due_date) < startOfToday();
  }).length, 0);
  const totalBlocked = projects.reduce((s, p) => s + p.blocked.length, 0);

  return (
    <div style={{ background: "#F0F4F8", minHeight: "100vh", fontFamily: C.font }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header style={{
        background: "linear-gradient(135deg, #1B2F52 0%, #1E3D6E 50%, #1A3460 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 28px", display: "flex", alignItems: "center", gap: 16, height: 60 }}>

          {/* Loop Services Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ background: "#fff", borderRadius: 6, padding: "5px 10px", display: "flex", alignItems: "center", flexShrink: 0 }}>
              <img
                src="/loop-services-logo.png"
                alt="Loop Services"
                style={{ height: 26, width: "auto", objectFit: "contain", flexShrink: 0 }}
              />
            </div>
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
              {/* Hover shows the email the SESSION carries, which is what every
                  email-based gate (e.g. PTO_APPROVER_EMAILS) compares against.
                  Google's OIDC `email` claim is the account's PRIMARY address — signing
                  in via a Workspace alias yields a different value than the user typed,
                  so "my access is missing" is otherwise undiagnosable from the browser. */}
              <span
                title={session.user.email ?? undefined}
                style={{ fontSize: 11, color: "#94A3B8", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
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

      </header>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 60, left: 0, bottom: 0,
        width: sidebarOpen ? 220 : 52,
        background: "linear-gradient(180deg, #1E3D6E 0%, #1A3460 100%)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        zIndex: 90,
        transition: "width 0.22s ease",
        overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Toggle button */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          style={{
            display: "flex", alignItems: "center", justifyContent: sidebarOpen ? "flex-end" : "center",
            padding: sidebarOpen ? "12px 14px" : "12px 0",
            background: "none", border: "none", cursor: "pointer",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            color: "#ffffff", fontSize: 16, flexShrink: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#93C5FD"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
          aria-label={sidebarOpen ? "Collapse menu" : "Expand menu"}
        >
          {sidebarOpen ? "←" : "☰"}
        </button>

        {/* Nav items */}
        <div style={{ overflowY: "auto", overflowX: "hidden", flex: 1, padding: "6px 0" }}>
          {TABS.filter(t => {
            const email = session?.user?.email?.toLowerCase() ?? "";
            // Gate the tab on the SAME list the PTO APIs authorise against. A second
            // hardcoded copy here meant adding an approver to PTO_APPROVER_EMAILS granted
            // them the API but not the tab — access that looks broken rather than absent.
            if (t.id === "mgr-pto") return PTO_APPROVER_EMAILS.includes(email);
            return true;
          }).map(t => {
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={!sidebarOpen ? t.label : undefined}
                style={{
                  display: "flex", alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: sidebarOpen ? "9px 14px" : "9px 0",
                  justifyContent: sidebarOpen ? "flex-start" : "center",
                  background: isActive ? "rgba(59,130,246,0.15)" : "none",
                  borderLeft: isActive ? "3px solid #3B82F6" : "3px solid transparent",
                  border: "none",
                  borderRight: "none",
                  color: isActive ? "#93C5FD" : "#ffffff",
                  fontSize: 12.5, fontWeight: isActive ? 700 : 500,
                  fontFamily: C.font, cursor: "pointer",
                  whiteSpace: "nowrap", textAlign: "left",
                  transition: "background 0.12s, color 0.12s",
                  flexShrink: 0,
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
              >
                <span style={{ fontSize: 15, flexShrink: 0, width: sidebarOpen ? "auto" : 52, textAlign: "center" }}>{t.icon}</span>
                {sidebarOpen && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</span>}
                {sidebarOpen && t.id === "cases" && cases.length > 0 && (
                  <span style={{ fontSize: 10, background: "rgba(59,130,246,0.2)", color: "#60A5FA", borderRadius: 10, padding: "1px 6px", fontWeight: 700, marginLeft: "auto" }}>
                    {cases.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ paddingLeft: sidebarOpen ? 220 : 52, transition: "padding-left 0.22s ease" }}>
      <main style={{ padding: "24px 28px" }}>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: "12px 18px", marginBottom: 20, color: C.red, fontSize: 13, fontWeight: 500 }}>
            ⚠ {error}
          </div>
        )}

        {!hasLoaded && !loading && !error && tab !== "wiki" && tab !== "service-requests" && tab !== "employee" && tab !== "mgr-pto" && (
          <div style={{ background: "#fff", borderRadius: 16, padding: "64px 24px", textAlign: "center", border: `1px solid ${C.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16, margin: "0 auto 20px",
              background: "linear-gradient(135deg, #EBF5FF, #DBEAFE)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
            }}>📊</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: C.text, marginBottom: 8 }}>
              Loop Services — Project Dashboard
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
              // Accepts the updater form as well as a plain array: the inline
              // ClickUp status dropdown writes twice per edit (optimistic, then
              // whatever ClickUp reports back), and resolving both against the
              // render-time array would make the second discard the first.
              onProjectsChange={updated => setData(d => ({
                ...d,
                projects: typeof updated === "function" ? updated(d.projects) : updated,
              }))}
              initialTab={taskSubTab}
            />
          </div>
        )}

        {/* Resources */}
        {hasLoaded && tab === "resources" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <ResourceAllocation allocations={allocations} consultantRoster={consultantRoster} />
          </div>
        )}

        {/* Delivery Time */}
        {tab === "delivery-time" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <TimeAnalysis title="Delivery Time" filterDepartment="Consulting,PMO" />
          </div>
        )}

        {/* Time Analysis */}
        {tab === "time" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <TimeAnalysis />
          </div>
        )}

        {/* Manager Review */}
        {tab === "mgr-review" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "20px 22px" }}>
            <ManagerReview />
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
          <ServiceRequestsShell />
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

        {/* Manager PTO (Zabe only) */}
        {tab === "mgr-pto" && (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)", padding: "24px 28px" }}>
            <ManagerPTOView />
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

        {/* Meetings — self-loading from Zoom, independent of the NetSuite refresh */}
        {tab === "meetings" && <MeetingsView />}

        {/* Fireflies Meetings — self-loading, independent of the NetSuite refresh */}
        {tab === "fireflies" && <FirefliesMeetingsView />}

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
      </div>

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
