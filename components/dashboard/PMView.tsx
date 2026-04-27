"use client";
import { useState, useEffect } from "react";
import { C, PMS } from "@/lib/constants";
import type { Project } from "@/lib/types";
import { ProjectManagementView } from "./ProjectManagementView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PMProject {
  id: string;
  name: string;
  client_name: string;
  project_type: string;
  pm_name: string | null;
  ns_project_id: string | null;
  go_live_date: string | null;
  budget_hours: number | null;
  description: string | null;
  status: string;
  created_at: string;
  phase_count?: number;
  task_count?: number;
  done_count?: number;
}

// ─── Create Project Modal ─────────────────────────────────────────────────────

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: PMProject) => void;
}) {
  const [name, setName]             = useState("");
  const [clientName, setClient]     = useState("");
  const [projectType, setType]      = useState("Implementation");
  const [pmName, setPm]             = useState("");
  const [goLiveDate, setGoLive]     = useState("");
  const [budgetHours, setBudget]    = useState("");
  const [description, setDesc]      = useState("");
  const [setupPhases, setSetup]     = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const pmList = Object.values(PMS);

  async function create() {
    if (!name.trim() || !clientName.trim()) { setError("Project name and client name are required."); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/pm/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), clientName: clientName.trim(), projectType, pmName: pmName || null, goLiveDate: goLiveDate || null, budgetHours: budgetHours || null, description: description.trim() || null, setupPhases }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      onCreated(d.project);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally { setSaving(false); }
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 11px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontFamily: C.font, color: C.text, background: "#fff", outline: "none", boxSizing: "border-box" };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 540, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* Modal header */}
        <div style={{ padding: "22px 28px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.text }}>Create New Project</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>Set up a new delivery project</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textSub, lineHeight: 1 }}>×</button>
        </div>

        {/* Modal body */}
        <div style={{ padding: "20px 28px", maxHeight: "65vh", overflowY: "auto" }}>
          {error && (
            <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 14px", color: C.red, fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* Name + Client (side by side) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Project Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. NS Implementation" style={inputStyle} autoFocus />
            </div>
            <div>
              <label style={labelStyle}>Client Name *</label>
              <input value={clientName} onChange={e => setClient(e.target.value)} placeholder="e.g. Nautical Fulfillment" style={inputStyle} />
            </div>
          </div>

          {/* Type + PM */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Project Type</label>
              <select value={projectType} onChange={e => setType(e.target.value)} style={inputStyle}>
                <option value="Implementation">Implementation</option>
                <option value="Service">Service</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Project Manager</label>
              <select value={pmName} onChange={e => setPm(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {pmList.map(pm => <option key={pm} value={pm}>{pm}</option>)}
              </select>
            </div>
          </div>

          {/* Go-live + Budget hours */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Go-Live Date</label>
              <input type="date" value={goLiveDate} onChange={e => setGoLive(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Budget Hours</label>
              <input type="number" min="0" step="0.5" value={budgetHours} onChange={e => setBudget(e.target.value)} placeholder="e.g. 200" style={inputStyle} />
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} placeholder="Brief project scope or notes…" rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          {/* Phase setup option */}
          <div style={{ background: C.alt, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 10 }}>Initial Setup</div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8, cursor: "pointer" }}>
              <input type="radio" name="setup" checked={setupPhases} onChange={() => setSetup(true)} style={{ marginTop: 2, accentColor: C.blue }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Create 5 CEBA delivery phases</div>
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>Planning & Design · Config & Testing · Training & UAT · Readiness · Go Live</div>
              </div>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="radio" name="setup" checked={!setupPhases} onChange={() => setSetup(false)} style={{ accentColor: C.blue }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Start empty — add phases manually</div>
              </div>
            </label>
          </div>
        </div>

        {/* Modal footer */}
        <div style={{ padding: "14px 28px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>
            Cancel
          </button>
          <button
            onClick={create}
            disabled={saving || !name.trim() || !clientName.trim()}
            style={{ padding: "9px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving || !name.trim() || !clientName.trim() ? "not-allowed" : "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, opacity: saving || !name.trim() || !clientName.trim() ? 0.6 : 1, display: "flex", alignItems: "center", gap: 8 }}
          >
            {saving ? "Creating…" : "Create Project →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }: { label: string; value: number | string; sub?: string; color: string; icon: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px", boxShadow: C.sh, flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: C.mono }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function NativeProjectCard({ project, onClick }: { project: PMProject; onClick: () => void }) {
  const statusColor = project.status === "active" ? C.green : project.status === "on_hold" ? C.yellow : C.textSub;
  const statusBg    = project.status === "active" ? C.greenBg : project.status === "on_hold" ? C.yellowBg : C.alt;
  const statusBd    = project.status === "active" ? C.greenBd : project.status === "on_hold" ? C.yellowBd : C.border;
  const statusLabel = project.status === "active" ? "Active" : project.status === "on_hold" ? "On Hold" : project.status === "completed" ? "Completed" : "Archived";

  const pct = project.task_count && project.task_count > 0
    ? Math.round(((project.done_count ?? 0) / project.task_count) * 100)
    : null;

  const daysLeft = project.go_live_date
    ? Math.round((new Date(project.go_live_date).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div
      onClick={onClick}
      style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.sh, cursor: "pointer", transition: "box-shadow 0.15s, transform 0.15s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = C.shMd; (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = C.sh; (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      {/* Top bar */}
      <div style={{ height: 4, background: project.status === "active" ? C.blue : C.border }} />

      <div style={{ padding: "16px 18px" }}>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.client_name}</div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: statusBg, color: statusColor, border: `1px solid ${statusBd}`, marginLeft: 10, flexShrink: 0 }}>
            {statusLabel}
          </span>
        </div>

        {/* Metadata chips */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: project.project_type === "Implementation" ? C.purpleBg : C.tealBg, color: project.project_type === "Implementation" ? C.purple : C.teal, border: `1px solid ${project.project_type === "Implementation" ? C.purpleBd : C.tealBd}` }}>
            {project.project_type}
          </span>
          {project.pm_name && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: C.alt, color: C.textMid, border: `1px solid ${C.border}` }}>
              PM: {project.pm_name.split(" ")[0]}
            </span>
          )}
          {project.go_live_date && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: daysLeft !== null && daysLeft < 0 ? C.redBg : C.alt, color: daysLeft !== null && daysLeft < 0 ? C.red : C.textSub, border: `1px solid ${daysLeft !== null && daysLeft < 0 ? C.redBd : C.border}`, fontFamily: C.mono }}>
              {daysLeft !== null && daysLeft < 0
                ? `${Math.abs(daysLeft)}d overdue`
                : daysLeft === 0
                  ? "Go-live today"
                  : daysLeft !== null
                    ? `${daysLeft}d left`
                    : new Date(project.go_live_date).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "2-digit" })}
            </span>
          )}
        </div>

        {/* Task progress */}
        {project.task_count != null && project.task_count > 0 ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: C.textSub }}>{project.done_count ?? 0}/{project.task_count} tasks done</span>
              {pct !== null && <span style={{ fontSize: 11, fontFamily: C.mono, fontWeight: 700, color: pct >= 80 ? C.green : pct >= 40 ? C.yellow : C.textMid }}>{pct}%</span>}
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
              <div style={{ height: "100%", borderRadius: 2, background: pct !== null && pct >= 80 ? C.green : pct !== null && pct >= 40 ? C.yellow : C.blue, width: `${pct ?? 0}%`, transition: "width 0.4s" }} />
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.textSub }}>
            {project.phase_count ? `${project.phase_count} phase${project.phase_count !== 1 ? "s" : ""} · no tasks yet` : "No phases yet"}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.border}`, background: C.alt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.textSub }}>
          {project.budget_hours ? `${project.budget_hours}h budget` : "No budget set"}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>Open →</span>
      </div>
    </div>
  );
}

function NSProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const hColors = {
    green:  { bg: C.greenBg,  color: C.green,  bd: C.greenBd,  label: "On Track" },
    yellow: { bg: C.yellowBg, color: C.yellow, bd: C.yellowBd, label: "At Risk" },
    red:    { bg: C.redBg,    color: C.red,     bd: C.redBd,    label: "Critical" },
  }[project.health];

  const pct = Math.round(project.pct * 100);

  return (
    <div
      onClick={onClick}
      style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.sh, cursor: "pointer", transition: "box-shadow 0.15s, transform 0.15s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = C.shMd; (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = C.sh; (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{ height: 4, background: hColors.color }} />

      <div style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.label}</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>NS #{project.entityid}</div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: hColors.bg, color: hColors.color, border: `1px solid ${hColors.bd}`, marginLeft: 10, flexShrink: 0 }}>
            {hColors.label}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: project.projectType === "Implementation" ? C.purpleBg : C.tealBg, color: project.projectType === "Implementation" ? C.purple : C.teal, border: `1px solid ${project.projectType === "Implementation" ? C.purpleBd : C.tealBd}` }}>
            {project.projectType}
          </span>
          {project.pm && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: C.alt, color: C.textMid, border: `1px solid ${C.border}` }}>
              PM: {project.pm.split(" ")[0]}
            </span>
          )}
          {project.goliveDate && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: project.isOverdue ? C.redBg : C.alt, color: project.isOverdue ? C.red : C.textSub, border: `1px solid ${project.isOverdue ? C.redBd : C.border}`, fontFamily: C.mono }}>
              {project.daysLeft !== null
                ? project.isOverdue
                  ? `${Math.abs(project.daysLeft)}d overdue`
                  : `${project.daysLeft}d left`
                : new Date(project.goliveDate).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "2-digit" })}
            </span>
          )}
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: C.textSub }}>{project.tasks.length} tasks · SPI {project.spi.toFixed(2)}</span>
            <span style={{ fontSize: 11, fontFamily: C.mono, fontWeight: 700, color: pct >= 80 ? C.green : pct >= 40 ? C.yellow : C.textMid }}>{pct}%</span>
          </div>
          <div style={{ height: 4, background: C.border, borderRadius: 2, position: "relative" }}>
            <div style={{ height: "100%", borderRadius: 2, background: hColors.color, width: `${pct}%`, transition: "width 0.4s" }} />
            {/* Burn rate marker */}
            <div style={{ position: "absolute", top: -2, width: 2, height: 8, background: C.red, borderRadius: 1, left: `${Math.round(project.burnRate * 100)}%`, transition: "left 0.4s" }} />
          </div>
        </div>
      </div>

      <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.border}`, background: C.alt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
          {project.actual}h / {(project.actual + project.rem)}h
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>Open →</span>
      </div>
    </div>
  );
}

// ─── PM Home Screen ───────────────────────────────────────────────────────────

function PMHomeScreen({
  nsProjects,
  nativeProjects,
  loadingNative,
  onOpenProject,
  onOpenNativeProject,
  onProjectCreated,
}: {
  nsProjects: Project[];
  nativeProjects: PMProject[];
  loadingNative: boolean;
  onOpenProject: (id: number) => void;
  onOpenNativeProject: (id: string) => void;
  onProjectCreated: (p: PMProject) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "ns" | "native">("all");

  // KPIs from NS projects
  const critical  = nsProjects.filter(p => p.health === "red").length;
  const atRisk    = nsProjects.filter(p => p.health === "yellow").length;
  const overdue   = nsProjects.filter(p => p.isOverdue).length;
  const totalTasks = nsProjects.reduce((s, p) => s + p.tasks.length, 0)
    + nativeProjects.reduce((s, p) => s + (p.task_count ?? 0), 0);

  const totalProjects = (typeFilter === "all" || typeFilter === "ns" ? nsProjects.length : 0)
    + (typeFilter === "all" || typeFilter === "native" ? nativeProjects.length : 0);

  const filteredNS = nsProjects.filter(p =>
    (typeFilter === "all" || typeFilter === "ns") &&
    (!search || p.label.toLowerCase().includes(search.toLowerCase()) || p.client.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredNative = nativeProjects.filter(p =>
    (typeFilter === "all" || typeFilter === "native") &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.client_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div style={{ fontFamily: C.font }}>
      {/* ── Page header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>Project Management</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textSub }}>
            {totalProjects} active project{totalProjects !== 1 ? "s" : ""} · {totalTasks} tasks
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{ padding: "10px 20px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 2px 8px rgba(26,86,219,0.3)" }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New Project
        </button>
      </div>

      {/* ── KPI row ── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <KpiCard icon="📁" label="Active Projects" value={nsProjects.length + nativeProjects.filter(p => p.status === "active").length} color={C.blue} sub="NS + native" />
        <KpiCard icon="🔴" label="Critical"  value={critical}  color={critical  > 0 ? C.red    : C.textSub} sub="health score < 45" />
        <KpiCard icon="🟡" label="At Risk"   value={atRisk}    color={atRisk    > 0 ? C.yellow : C.textSub} sub="health score 45–69" />
        <KpiCard icon="⏰" label="Overdue"   value={overdue}   color={overdue   > 0 ? C.red    : C.textSub} sub="past go-live date" />
        <KpiCard icon="📋" label="Total Tasks" value={totalTasks} color={C.textMid} sub="across all projects" />
      </div>

      {/* ── Filter bar ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.textSub, fontSize: 14, pointerEvents: "none" }}>🔍</span>
          <input
            placeholder="Search projects…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 12px 8px 32px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: C.font, color: C.text, background: C.surface, outline: "none", boxSizing: "border-box" }}
          />
        </div>
        {(["all", "ns", "native"] as const).map(f => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${typeFilter === f ? C.blue : C.border}`, background: typeFilter === f ? C.blueBg : C.surface, color: typeFilter === f ? C.blue : C.textMid, fontFamily: C.font }}
          >
            {f === "all" ? "All" : f === "ns" ? "NetSuite" : "Native"}
          </button>
        ))}
      </div>

      {/* ── Project grid ── */}
      {filteredNS.length === 0 && filteredNative.length === 0 && !loadingNative && (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.textSub }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textMid, marginBottom: 8 }}>No projects found</div>
          <div style={{ fontSize: 13 }}>{search ? "Try a different search term" : "Create your first project to get started"}</div>
          {!search && (
            <button onClick={() => setShowCreate(true)} style={{ marginTop: 16, padding: "9px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none" }}>
              + New Project
            </button>
          )}
        </div>
      )}

      {/* NS projects section */}
      {filteredNS.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          {(typeFilter === "all") && (
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              NetSuite Projects ({filteredNS.length})
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {filteredNS.map(p => (
              <NSProjectCard key={p.id} project={p} onClick={() => onOpenProject(p.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Native projects section */}
      {loadingNative && (
        <div style={{ textAlign: "center", padding: "24px 0", color: C.textSub, fontSize: 13 }}>Loading native projects…</div>
      )}
      {filteredNative.length > 0 && (
        <div>
          {typeFilter === "all" && (
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              Native Projects ({filteredNative.length})
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {filteredNative.map(p => (
              <NativeProjectCard key={p.id} project={p} onClick={() => onOpenNativeProject(p.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={p => { onProjectCreated(p); onOpenNativeProject(p.id); }}
        />
      )}
    </div>
  );
}

// ─── Wrapper: PMView ──────────────────────────────────────────────────────────

type Screen = "home" | "tasks";

interface PMViewProps { projects: Project[] }

export function PMView({ projects }: PMViewProps) {
  const [screen, setScreen]               = useState<Screen>("home");
  const [focusProjectId, setFocusNS]      = useState<number | null>(null);
  const [focusNativeId, setFocusNative]   = useState<string | null>(null);
  const [nativeProjects, setNativeProjects] = useState<PMProject[]>([]);
  const [loadingNative, setLoadingNative]   = useState(true);

  const activeNSProjects = projects.filter(p => !p.isInternal);

  useEffect(() => {
    fetch("/api/pm/projects")
      .then(r => r.json())
      .then(d => setNativeProjects(d.projects ?? []))
      .finally(() => setLoadingNative(false));
  }, []);

  function goHome() { setScreen("home"); setFocusNS(null); setFocusNative(null); }

  // Determine which projects to show in the task view
  const taskProjects = (() => {
    if (focusNativeId) {
      // For a native pm_project, we need a synthetic Project-like record.
      // Since ProjectManagementView accepts Project[] and uses project.id as the ns_id key for phases,
      // we pass in the matching NS project if linked, otherwise an empty list (phase view will auto-detect native).
      const native = nativeProjects.find(p => p.id === focusNativeId);
      if (native?.ns_project_id) {
        const linked = activeNSProjects.find(p => String(p.id) === native.ns_project_id);
        return linked ? [linked] : [];
      }
      return [];
    }
    if (focusProjectId !== null) return activeNSProjects.filter(p => p.id === focusProjectId);
    return activeNSProjects;
  })();

  // Derive the display project ID to filter pm_phases (using native UUID if applicable)
  const nativePhasesOverride = focusNativeId ?? undefined;

  return (
    <div>
      {/* ── Breadcrumb nav when in task view ── */}
      {screen === "tasks" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <button
            onClick={goHome}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}
          >
            ← Home
          </button>
          <span style={{ color: C.textSub, fontSize: 12 }}>/</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
            {focusNativeId
              ? (nativeProjects.find(p => p.id === focusNativeId)?.name ?? "Project")
              : focusProjectId !== null
                ? (activeNSProjects.find(p => p.id === focusProjectId)?.label ?? "Project")
                : "All Projects"}
          </span>
        </div>
      )}

      {/* ── Home screen ── */}
      {screen === "home" && (
        <PMHomeScreen
          nsProjects={activeNSProjects}
          nativeProjects={nativeProjects}
          loadingNative={loadingNative}
          onOpenProject={id => { setFocusNS(id); setFocusNative(null); setScreen("tasks"); }}
          onOpenNativeProject={id => { setFocusNative(id); setFocusNS(null); setScreen("tasks"); }}
          onProjectCreated={p => setNativeProjects(prev => [{ ...p, phase_count: 5, task_count: 0, done_count: 0 }, ...prev])}
        />
      )}

      {/* ── Task management view ── */}
      {screen === "tasks" && (
        <NativeTasksOrFallback
          allNSProjects={activeNSProjects}
          focusNativeId={focusNativeId}
          nativeProject={focusNativeId ? nativeProjects.find(p => p.id === focusNativeId) : undefined}
          taskProjects={taskProjects}
          nativePhasesOverride={nativePhasesOverride}
        />
      )}
    </div>
  );
}

// When viewing a native pm_project that has no linked NS project, we can't directly pass it to
// ProjectManagementView (which expects Project[]). Instead, we render a thin wrapper that passes
// the native project ID as the "projectId" for phase loading.
function NativeTasksOrFallback({
  allNSProjects, focusNativeId, nativeProject, taskProjects, nativePhasesOverride,
}: {
  allNSProjects: Project[];
  focusNativeId: string | null;
  nativeProject?: PMProject;
  taskProjects: Project[];
  nativePhasesOverride?: string;
}) {
  // If there's a native project with no NS link, show a standalone view
  if (focusNativeId && (!nativeProject?.ns_project_id || taskProjects.length === 0)) {
    return (
      <NativeOnlyProjectView
        projectId={focusNativeId}
        projectName={nativeProject?.name ?? "Project"}
        clientName={nativeProject?.client_name ?? ""}
        pm={nativeProject?.pm_name ?? ""}
        goLiveDate={nativeProject?.go_live_date ?? null}
      />
    );
  }

  return <ProjectManagementView projects={taskProjects.length > 0 ? taskProjects : allNSProjects} />;
}

// Standalone view for native-only projects (no NS counterpart)
function NativeOnlyProjectView({
  projectId, projectName, clientName, pm, goLiveDate,
}: {
  projectId: string; projectName: string; clientName: string; pm: string; goLiveDate: string | null;
}) {
  // Build a synthetic Project record so ProjectManagementView can render native phases.
  // ProjectManagementView calls /api/pm/phases?projectId=<project.id>, so we coerce the
  // native UUID into the id field (treated as a string key, not a numeric NS ID).
  const fakeProject: Project = {
    id:            projectId as unknown as number, // UUID used as project_ns_id in phases
    entityid:      "",
    label:         `${clientName} — ${projectName}`,
    client:        clientName,
    projectType:   "Implementation",
    pm,
    goliveDate:    goLiveDate,
    daysLeft:      goLiveDate ? Math.round((new Date(goLiveDate).getTime() - Date.now()) / 86_400_000) : null,
    isOverdue:     goLiveDate ? new Date(goLiveDate) < new Date() : false,
    budget_hours:  0,
    actual:        0,
    rem:           0,
    pct:           0,
    burnRate:      0,
    spi:           1,
    budgetGap:     0,
    score:         100,
    health:        "green",
    nsUrl:         "",
    clickupUrl:    null,
    clickupListId: null,
    tasks:         [],
    blocked:       [],
    clientPending: [],
    milestones:    [],
    timebillWarning: false,
    notes:         [],
    clickupError:  null,
  };

  return <ProjectManagementView projects={[fakeProject]} />;
}
