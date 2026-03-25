"use client";
import { useState } from "react";
import { C } from "@/lib/constants";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LinkBtn } from "@/components/ui/LinkBtn";
import { HealthBadge } from "@/components/health/HealthBadge";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { TaskModal } from "@/components/dashboard/TaskModal";
import { fmtH, fmtPct, fmtD } from "@/lib/health";
import { isDone, isBlocked } from "@/lib/clickup";
import { STATUS_STYLES } from "@/lib/constants";
import type { Project, ProjectNote, ProjectPhase, CUTask } from "@/lib/types";

interface Props {
  projects: Project[];
  phases: ProjectPhase[];
  onProjectsChange: (updated: Project[]) => void;
}

type SortKey =
  | "health"
  | "client"
  | "pm"
  | "type"
  | "pct"
  | "actual"
  | "rem"
  | "phase"
  | "budgetFit"
  | "golive"
  | "notes";

type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const hColor = (h: string) =>
  h === "green" ? C.green : h === "yellow" ? C.yellow : C.red;

const healthRank = (h: string) =>
  h === "red" ? 0 : h === "yellow" ? 1 : 2;

function getActivePhase(phases: ProjectPhase[], projectId: number): ProjectPhase | null {
  const projectPhases = phases.filter(ph => ph.projectId === projectId);
  if (projectPhases.length === 0) return null;

  const inProgress = projectPhases.filter(ph => ph.actualHours > 0 && ph.remainingHours > 0);
  if (inProgress.length > 0) {
    return inProgress.reduce((a, b) => b.phaseId > a.phaseId ? b : a);
  }

  const notStarted = projectPhases.filter(ph => ph.remainingHours > 0);
  if (notStarted.length > 0) {
    return notStarted.reduce((a, b) => a.phaseId < b.phaseId ? a : b);
  }

  return null;
}

function getBudgetFit(
  phases: ProjectPhase[],
  projectId: number,
  rem: number
): { label: string; color: string; rank: number } {
  const projectPhases = phases.filter(ph => ph.projectId === projectId);
  if (projectPhases.length === 0) return { label: "—", color: C.textSub, rank: 1 };

  const sumPhaseRemaining = projectPhases.reduce(
    (sum, ph) => sum + (ph.budgetedHours - ph.actualHours),
    0
  );

  if (sumPhaseRemaining > rem + 5) {
    return { label: "⚠ Short", color: C.red, rank: 0 };
  } else if (Math.abs(sumPhaseRemaining - rem) <= 5) {
    return { label: "~OK", color: C.yellow, rank: 1 };
  } else {
    return { label: "✓ OK", color: C.green, rank: 2 };
  }
}

function sortProjects(
  projects: Project[],
  phases: ProjectPhase[],
  key: SortKey,
  dir: SortDir
): Project[] {
  const multiplier = dir === "asc" ? 1 : -1;

  return [...projects].sort((a, b) => {
    let cmp = 0;

    switch (key) {
      case "health":
        cmp = healthRank(a.health) - healthRank(b.health);
        break;
      case "client":
        cmp = a.client.localeCompare(b.client);
        break;
      case "pm":
        cmp = a.pm.localeCompare(b.pm);
        break;
      case "type":
        cmp = a.projectType.localeCompare(b.projectType);
        break;
      case "pct":
        cmp = a.pct - b.pct;
        break;
      case "actual":
        cmp = a.actual - b.actual;
        break;
      case "rem":
        cmp = a.rem - b.rem;
        break;
      case "phase": {
        const phA = getActivePhase(phases, a.id)?.phaseName ?? "";
        const phB = getActivePhase(phases, b.id)?.phaseName ?? "";
        cmp = phA.localeCompare(phB);
        break;
      }
      case "budgetFit": {
        const bfA = getBudgetFit(phases, a.id, a.rem).rank;
        const bfB = getBudgetFit(phases, b.id, b.rem).rank;
        cmp = bfA - bfB;
        break;
      }
      case "golive":
        if (a.daysLeft === null && b.daysLeft === null) cmp = 0;
        else if (a.daysLeft === null) cmp = 1;
        else if (b.daysLeft === null) cmp = -1;
        else cmp = a.daysLeft - b.daysLeft;
        break;
      case "notes":
        cmp = a.notes.length - b.notes.length;
        break;
    }

    return cmp * multiplier;
  });
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CELL: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "middle",
};

function thStyle(
  active: boolean,
  hovered: boolean
): React.CSSProperties {
  return {
    padding: "8px 12px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: active ? C.text : C.textSub,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    background: hovered ? "#EEF1F5" : "transparent",
    transition: "background 0.1s",
  };
}

// ─── Metrics panel ────────────────────────────────────────────────────────────

function RiskBadge({ label, color, bg, bd }: { label: string; color: string; bg: string; bd: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "2px 8px",
      background: bg, color, border: `1px solid ${bd}`,
    }}>
      {label}
    </span>
  );
}

function MetricsPanel({ p, phases, onTaskClick }: { p: Project; phases: ProjectPhase[]; onTaskClick: (tasks: CUTask[], title: string) => void }) {
  const totalH = p.actual + p.rem;
  const spi = p.burnRate > 0.01 ? (p.pct / p.burnRate).toFixed(2) : "—";
  const cpi = spi; // hour-based — same as SPI

  const totalTasks = p.tasks.length;
  const doneTasks  = p.tasks.filter(isDone).length;
  const openTasks  = totalTasks - doneTasks;
  const now        = Date.now();
  const overdueTasks = p.tasks.filter(t =>
    !isDone(t) && t.due_date && parseInt(t.due_date) < now
  ).length;

  const shownMilestones = p.milestones.slice(0, 3);
  const shownNotes      = [...p.notes]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 2);

  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.textSub,
    textTransform: "uppercase", letterSpacing: "0.06em",
    marginBottom: 6,
  };

  const metric: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: 2,
    minWidth: 80,
  };

  const metricVal: React.CSSProperties = {
    fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.text,
  };

  const metricLabel: React.CSSProperties = {
    fontSize: 10, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em",
  };

  const divider: React.CSSProperties = {
    width: 1, background: C.border, alignSelf: "stretch", margin: "0 4px",
  };

  return (
    <div style={{
      padding: "16px 20px",
      background: "#F2F5FB",
      borderTop: `1px dashed ${C.border}`,
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "20px 28px",
    }}>

      {/* Earned Value */}
      <div>
        <div style={sectionLabel}>Earned Value</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={metric}>
            <span style={metricVal}>{fmtH(totalH)}</span>
            <span style={metricLabel}>BAC (Budget)</span>
          </div>
          <div style={metric}>
            <span style={metricVal}>{fmtH(p.actual)}</span>
            <span style={metricLabel}>Actual Cost</span>
          </div>
          <div style={metric}>
            <span style={{ ...metricVal, color: p.rem < 20 ? C.red : p.rem < 50 ? C.yellow : C.green }}>
              {fmtH(p.rem)}
            </span>
            <span style={metricLabel}>ETC (Remaining)</span>
          </div>
          <div style={metric}>
            <span style={{
              ...metricVal,
              color: typeof spi === "string" || parseFloat(spi) >= 0.9
                ? C.green
                : parseFloat(spi) >= 0.7 ? C.yellow : C.red,
            }}>
              {spi}
            </span>
            <span style={metricLabel}>SPI</span>
          </div>
          <div style={metric}>
            <span style={{
              ...metricVal,
              color: typeof cpi === "string" || parseFloat(cpi) >= 0.9
                ? C.green
                : parseFloat(cpi) >= 0.7 ? C.yellow : C.red,
            }}>
              {cpi}
            </span>
            <span style={metricLabel}>CPI</span>
          </div>
        </div>
      </div>

      {/* Task Health */}
      <div>
        <div style={sectionLabel}>Task Health</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={metric}>
            <span style={metricVal}>{totalTasks}</span>
            <span style={metricLabel}>Total</span>
          </div>
          <div style={metric}>
            <span style={{ ...metricVal, color: C.green }}>{doneTasks}</span>
            <span style={metricLabel}>Done</span>
          </div>
          <div style={metric}>
            <span style={{ ...metricVal, color: C.blue }}>{openTasks}</span>
            <span style={metricLabel}>Open</span>
          </div>

          {/* Clickable: Overdue */}
          {(() => {
            const overdue = p.tasks.filter(t => !isDone(t) && !!t.due_date && parseInt(t.due_date) < now);
            return (
              <div style={metric}>
                <button
                  onClick={() => overdue.length > 0 && onTaskClick(overdue, `Overdue Tasks — ${p.client}`)}
                  style={{
                    ...metricVal, color: overdue.length > 0 ? C.red : C.textSub,
                    background: "none", border: "none", padding: 0, cursor: overdue.length > 0 ? "pointer" : "default",
                    fontFamily: C.mono, textDecoration: overdue.length > 0 ? "underline" : "none",
                    textDecorationStyle: "dotted", textUnderlineOffset: 3,
                  }}
                >
                  {overdue.length}
                </button>
                <span style={metricLabel}>Overdue</span>
              </div>
            );
          })()}

          {/* Clickable: Blocked */}
          <div style={metric}>
            <button
              onClick={() => p.blocked.length > 0 && onTaskClick(p.blocked, `Blocked Tasks — ${p.client}`)}
              style={{
                ...metricVal, color: p.blocked.length > 0 ? C.red : C.textSub,
                background: "none", border: "none", padding: 0, cursor: p.blocked.length > 0 ? "pointer" : "default",
                fontFamily: C.mono, textDecoration: p.blocked.length > 0 ? "underline" : "none",
                textDecorationStyle: "dotted", textUnderlineOffset: 3,
              }}
            >
              {p.blocked.length}
            </button>
            <span style={metricLabel}>Blocked</span>
          </div>

          {/* Clickable: Client Pending */}
          <div style={metric}>
            <button
              onClick={() => p.clientPending.length > 0 && onTaskClick(p.clientPending, `Client Pending — ${p.client}`)}
              style={{
                ...metricVal, color: p.clientPending.length > 0 ? C.yellow : C.textSub,
                background: "none", border: "none", padding: 0, cursor: p.clientPending.length > 0 ? "pointer" : "default",
                fontFamily: C.mono, textDecoration: p.clientPending.length > 0 ? "underline" : "none",
                textDecorationStyle: "dotted", textUnderlineOffset: 3,
              }}
            >
              {p.clientPending.length}
            </button>
            <span style={metricLabel}>Client Pending</span>
          </div>
        </div>
      </div>

      {/* Risk Flags */}
      <div>
        <div style={sectionLabel}>Risk Flags</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {p.rem < 20 && (
            <RiskBadge label="Low Budget" color={C.red} bg={C.redBg} bd={C.redBd} />
          )}
          {p.isOverdue && (
            <RiskBadge label="Overdue" color={C.red} bg={C.redBg} bd={C.redBd} />
          )}
          {p.blocked.length > 0 && (
            <RiskBadge label="Blocked Tasks" color={C.orange} bg={C.orangeBg} bd={C.orangeBd} />
          )}
          {p.clientPending.length > 0 && (
            <RiskBadge label="Client Pending" color={C.yellow} bg={C.yellowBg} bd={C.yellowBd} />
          )}
          {!p.goliveDate && (
            <RiskBadge label="No Go-Live Date" color={C.textMid} bg={C.alt} bd={C.border} />
          )}
          {p.rem >= 20 && !p.isOverdue && p.blocked.length === 0 && p.clientPending.length === 0 && p.goliveDate && (
            <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>No active flags</span>
          )}
        </div>
      </div>

      {/* Milestones */}
      {shownMilestones.length > 0 && (
        <div>
          <div style={sectionLabel}>Milestones</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {shownMilestones.map(m => {
              const st = m.status.status.toLowerCase();
              const style = STATUS_STYLES[st] ?? { bg: C.alt, color: C.textMid, bd: C.border, label: m.status.status };
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "1px 6px",
                    background: style.bg, color: style.color, border: `1px solid ${style.bd}`,
                    whiteSpace: "nowrap",
                  }}>
                    {style.label}
                  </span>
                  <span style={{ fontSize: 12, color: C.text }}>{m.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PM Notes */}
      {shownNotes.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={sectionLabel}>PM Notes (recent)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {shownNotes.map(note => (
              <div
                key={note.id}
                style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 6, padding: "8px 12px",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: C.blue,
                    background: C.blueBg, border: `1px solid ${C.blueBd}`,
                    borderRadius: 4, padding: "1px 6px",
                  }}>
                    {note.author || "PM"}
                  </span>
                  <span style={{ fontSize: 11, color: C.textSub }}>
                    {new Date(note.ts).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: C.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {note.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sortable TH ──────────────────────────────────────────────────────────────

function SortTh({
  col,
  sortKey,
  sortDir,
  onSort,
  children,
  style: extraStyle,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  const active = col === sortKey;

  return (
    <th
      onClick={() => onSort(col)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...thStyle(active, hovered), ...extraStyle }}
    >
      {children}
      {active && (
        <span style={{ marginLeft: 4, fontSize: 10 }}>
          {sortDir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </th>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProjectTable({ projects, phases, onProjectsChange }: Props) {
  const [sortKey, setSortKey]       = useState<SortKey>("health");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [expandedMetrics, setExpandedMetrics] = useState<Set<number>>(new Set());
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [taskModal, setTaskModal]   = useState<{ tasks: CUTask[]; title: string } | null>(null);
  const [editingGoLive, setEditingGoLive] = useState<number | null>(null);
  const [goLiveDraft, setGoLiveDraft]     = useState<string>("");
  const [goLiveSaving, setGoLiveSaving]   = useState<number | null>(null);

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(col);
      // Default direction: health asc = red first, most others asc is natural
      setSortDir("asc");
    }
  }

  function toggleNotes(id: number) {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleMetrics(id: number) {
    setExpandedMetrics(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleNotesChange(projectId: number, updated: ProjectNote[]) {
    onProjectsChange(
      projects.map(p => p.id === projectId ? { ...p, notes: updated } : p)
    );
  }

  function startEditGoLive(p: Project) {
    // Convert goliveDate (ISO string or "YYYY-MM-DD") to input[type=date] value
    const val = p.goliveDate ? p.goliveDate.slice(0, 10) : "";
    setGoLiveDraft(val);
    setEditingGoLive(p.id);
  }

  async function saveGoLive(projectId: number) {
    setGoLiveSaving(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/golive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: goLiveDraft || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert("Failed to save go-live date: " + (data.error ?? res.statusText));
        return;
      }
      // Update local state
      const today    = new Date(); today.setHours(0, 0, 0, 0);
      const newDate  = goLiveDraft || null;
      const goLive   = newDate ? new Date(newDate + "T00:00:00") : null;
      const daysLeft = goLive ? Math.round((goLive.getTime() - today.getTime()) / 86400000) : null;
      const isOverdue = daysLeft !== null && daysLeft < 0;

      onProjectsChange(
        projects.map(p =>
          p.id === projectId
            ? { ...p, goliveDate: newDate, daysLeft, isOverdue }
            : p
        )
      );
      setEditingGoLive(null);
    } finally {
      setGoLiveSaving(null);
    }
  }

  if (projects.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.textSub }}>
        No active projects found.
      </div>
    );
  }

  const sorted = sortProjects(projects, phases, sortKey, sortDir);

  const thProps = { sortKey, sortDir, onSort: handleSort };

  return (
    <div style={{ position: "relative" }}>
      {taskModal && (
        <TaskModal
          title={taskModal.title}
          tasks={taskModal.tasks}
          onClose={() => setTaskModal(null)}
        />
      )}
    <div style={{ overflowX: "auto" }}>
      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: C.font,
      }}>
        <thead>
          <tr style={{ background: C.alt }}>
            {/* Expand button col — no sort */}
            <th style={{
              padding: "8px 6px 8px 12px",
              width: 28,
              borderBottom: `1px solid ${C.border}`,
            }} />
            <SortTh col="health" {...thProps}>
              Project
            </SortTh>
            <SortTh col="pm" {...thProps}>PM</SortTh>
            <SortTh col="type" {...thProps}>Type</SortTh>
            <SortTh col="pct" {...thProps} style={{ minWidth: 130 }}>Progress</SortTh>
            <SortTh col="actual" {...thProps}>Hours</SortTh>
            <SortTh col="rem" {...thProps}>Hours Left</SortTh>
            <SortTh col="phase" {...thProps}>Phase</SortTh>
            <SortTh col="budgetFit" {...thProps}>Budget Fit</SortTh>
            <SortTh col="golive" {...thProps}>Go-Live</SortTh>
            <SortTh col="notes" {...thProps}>Notes</SortTh>
            {/* Links — no sort */}
            <th style={{
              padding: "8px 12px",
              fontSize: 11, fontWeight: 700, color: C.textSub,
              textTransform: "uppercase", letterSpacing: "0.05em",
              borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
            }}>
              Links
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const remColor    = p.rem < 20 ? C.red : p.rem < 50 ? C.yellow : C.green;
            const rowBg       = hoveredRow === p.id
              ? "#ECF0F7"
              : i % 2 === 0 ? C.surface : C.alt;
            const notesOpen   = expandedNotes.has(p.id);
            const metricsOpen = expandedMetrics.has(p.id);
            const noteCount   = p.notes.length;
            const anyExpanded = notesOpen || metricsOpen;

            const activePhase   = getActivePhase(phases, p.id);
            const phaseName     = activePhase
              ? activePhase.phaseName.length > 14
                ? activePhase.phaseName.slice(0, 14) + "…"
                : activePhase.phaseName
              : null;

            const budgetFit = getBudgetFit(phases, p.id, p.rem);

            const borderB = anyExpanded ? "none" : `1px solid ${C.border}`;
            const cellStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
              ...CELL,
              borderBottom: borderB,
              background: rowBg,
              ...extra,
            });

            return (
              <>
                {/* ── Main row ── */}
                <tr
                  key={p.id}
                  onMouseEnter={() => setHoveredRow(p.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{ height: 44 }}
                >
                  {/* Expand / collapse metrics */}
                  <td style={{
                    ...cellStyle(),
                    padding: "0 4px 0 12px",
                    width: 28,
                    textAlign: "center",
                  }}>
                    <button
                      onClick={() => toggleMetrics(p.id)}
                      title={metricsOpen ? "Collapse metrics" : "Expand metrics"}
                      style={{
                        background: "none",
                        border: `1px solid ${metricsOpen ? C.blue : C.border}`,
                        borderRadius: 4,
                        cursor: "pointer",
                        color: metricsOpen ? C.blue : C.textSub,
                        fontSize: 9,
                        padding: "2px 4px",
                        lineHeight: 1,
                        fontFamily: C.font,
                      }}
                    >
                      {metricsOpen ? "▲" : "▼"}
                    </button>
                  </td>

                  {/* Project / Client */}
                  <td style={cellStyle()}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <HealthBadge health={p.health} size="sm" />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{p.client}</div>
                        <div style={{ fontSize: 11, color: C.textSub }}># {p.entityid}</div>
                      </div>
                      {p.timebillWarning && (
                        <span
                          title="Timebill total exceeds remaining hours by >20h"
                          style={{ fontSize: 13 }}
                        >
                          ⚠️
                        </span>
                      )}
                    </div>
                  </td>

                  {/* PM */}
                  <td style={cellStyle({ fontSize: 12, color: C.textMid, whiteSpace: "nowrap" })}>
                    {p.pm}
                  </td>

                  {/* Type */}
                  <td style={cellStyle()}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "2px 6px",
                      background: p.projectType === "Implementation" ? C.purpleBg : C.blueBg,
                      color:      p.projectType === "Implementation" ? C.purple   : C.blue,
                      border:    `1px solid ${p.projectType === "Implementation" ? C.purpleBd : C.blueBd}`,
                    }}>
                      {p.projectType === "Implementation" ? "Impl" : "Svc"}
                    </span>
                  </td>

                  {/* Progress */}
                  <td style={cellStyle({ minWidth: 130 })}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <ProgressBar val={p.pct} burn={p.burnRate} color={hColor(p.health)} h={6} />
                      </div>
                      <span style={{
                        fontSize: 12, fontFamily: C.mono, fontWeight: 600,
                        color: hColor(p.health), minWidth: 36,
                      }}>
                        {fmtPct(p.pct)}
                      </span>
                    </div>
                  </td>

                  {/* Hours */}
                  <td style={cellStyle()}>
                    <div style={{ fontFamily: C.mono, fontSize: 12, color: C.text, fontWeight: 600 }}>
                      {fmtH(p.actual)} / {fmtH(p.actual + p.rem)}
                    </div>
                    <div style={{ fontFamily: C.mono, fontSize: 11, color: p.rem < 15 ? C.red : C.textSub }}>
                      {fmtH(p.rem)} left
                    </div>
                  </td>

                  {/* Hours Left */}
                  <td style={cellStyle()}>
                    <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: remColor }}>
                      {p.rem.toFixed(1)}h
                    </span>
                  </td>

                  {/* Phase */}
                  <td style={cellStyle()}>
                    {phaseName ? (
                      <span
                        style={{ fontSize: 12, color: C.text, fontWeight: 500 }}
                        title={activePhase?.phaseName}
                      >
                        {phaseName}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: C.textSub }}>—</span>
                    )}
                  </td>

                  {/* Budget Fit */}
                  <td style={cellStyle()}>
                    <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700, color: budgetFit.color }}>
                      {budgetFit.label}
                    </span>
                  </td>

                  {/* Go-Live */}
                  <td style={cellStyle({ whiteSpace: "nowrap" })}>
                    {editingGoLive === p.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <input
                          type="date"
                          value={goLiveDraft}
                          onChange={e => setGoLiveDraft(e.target.value)}
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === "Enter") saveGoLive(p.id);
                            if (e.key === "Escape") setEditingGoLive(null);
                          }}
                          style={{
                            fontSize: 12, fontFamily: C.font,
                            border: `1px solid ${C.blue}`, borderRadius: 4,
                            padding: "2px 6px", outline: "none",
                            color: C.text, background: C.surface,
                            width: 120,
                          }}
                        />
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={() => saveGoLive(p.id)}
                            disabled={goLiveSaving === p.id}
                            style={{
                              fontSize: 10, fontWeight: 700, padding: "2px 7px",
                              borderRadius: 4, cursor: "pointer", fontFamily: C.font,
                              background: C.blue, color: "#fff",
                              border: `1px solid ${C.blue}`,
                              opacity: goLiveSaving === p.id ? 0.6 : 1,
                            }}
                          >
                            {goLiveSaving === p.id ? "…" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingGoLive(null)}
                            style={{
                              fontSize: 10, fontWeight: 600, padding: "2px 7px",
                              borderRadius: 4, cursor: "pointer", fontFamily: C.font,
                              background: C.alt, color: C.textMid,
                              border: `1px solid ${C.border}`,
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{ display: "flex", alignItems: "flex-start", gap: 4 }}
                        title="Click ✏ to edit go-live date"
                      >
                        <div>
                          {p.goliveDate ? (
                            <>
                              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                                {new Date(p.goliveDate.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", {
                                  day: "numeric", month: "short", year: "2-digit",
                                })}
                              </div>
                              <div style={{
                                fontSize: 11,
                                color: p.isOverdue ? C.red : C.textSub,
                                fontWeight: p.isOverdue ? 700 : 400,
                              }}>
                                {fmtD(p.daysLeft)}
                              </div>
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>⚠ No date</span>
                          )}
                        </div>
                        <button
                          onClick={() => startEditGoLive(p)}
                          title="Edit go-live date"
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: C.textSub, fontSize: 11, padding: "1px 2px",
                            lineHeight: 1, marginTop: 1, opacity: 0.6,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                          onMouseLeave={e => (e.currentTarget.style.opacity = "0.6")}
                        >
                          ✏
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Notes */}
                  <td style={cellStyle({ whiteSpace: "nowrap" })}>
                    <button
                      onClick={() => toggleNotes(p.id)}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 5,
                        cursor: "pointer", fontFamily: C.font,
                        background: notesOpen ? C.yellowBg : noteCount > 0 ? C.blueBg : C.alt,
                        color:      notesOpen ? C.yellow   : noteCount > 0 ? C.blue   : C.textSub,
                        border:    `1px solid ${notesOpen ? C.yellowBd : noteCount > 0 ? C.blueBd : C.border}`,
                      }}
                    >
                      📝 {noteCount > 0 ? `${noteCount} Note${noteCount !== 1 ? "s" : ""}` : "Notes"}
                      <span style={{ marginLeft: 4 }}>{notesOpen ? "▲" : "▼"}</span>
                    </button>
                  </td>

                  {/* Links */}
                  <td style={cellStyle()}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <LinkBtn href={p.nsUrl} color={C.purple} bg={C.purpleBg} bd={C.purpleBd} label="NetSuite" />
                      {p.clickupUrl && (
                        <LinkBtn href={p.clickupUrl} color={C.blue} bg={C.blueBg} bd={C.blueBd} label="ClickUp" />
                      )}
                    </div>
                  </td>
                </tr>

                {/* ── Metrics expansion row ── */}
                {metricsOpen && (
                  <tr key={`metrics-${p.id}`}>
                    <td
                      colSpan={12}
                      style={{
                        borderBottom: notesOpen ? "none" : `1px solid ${C.border}`,
                        padding: 0,
                      }}
                    >
                      <MetricsPanel p={p} phases={phases} onTaskClick={(tasks, title) => setTaskModal({ tasks, title })} />
                    </td>
                  </tr>
                )}

                {/* ── Notes expansion row ── */}
                {notesOpen && (
                  <tr key={`notes-${p.id}`}>
                    <td
                      colSpan={12}
                      style={{ borderBottom: `1px solid ${C.border}`, padding: 0 }}
                    >
                      <NotesPanel
                        projectId={p.id}
                        notes={p.notes}
                        onNotesChange={updated => handleNotesChange(p.id, updated)}
                      />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  );
}
