"use client";
import { useState, useEffect } from "react";
import { C, STATUS_STYLES, nsProjectUrl, EMPLOYEES } from "@/lib/constants";
import { isBlocked, isClientPending, isMilestone, isDone, taskBucket } from "@/lib/clickup";
import { fmtH, fmtD, fmtPct } from "@/lib/health";
import { HealthBadge } from "@/components/health/HealthBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LinkBtn } from "@/components/ui/LinkBtn";
import type { Project, CUTask } from "@/lib/types";
import type { Healthcheck } from "@/app/api/healthchecks/route";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NSCase {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  priority: string;
  company: string;
  assigned: string;
  createdDate: string;
  lastModified: string;
}

interface Props {
  projects: Project[];
  cases?: NSCase[];
}

type TaskTab =
  | "all"
  | "high_priority"
  | "due_this_week"
  | "due_next_week"
  | "upcoming"
  | "milestones"
  | "at_risk";

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const st  = status.toLowerCase();
  const sty = STATUS_STYLES[st] ?? { bg: C.alt, color: C.textMid, bd: C.border, label: status };
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      borderRadius: 3,
      padding: "1px 5px",
      background: sty.bg,
      color: sty.color,
      border: `1px solid ${sty.bd}`,
      whiteSpace: "nowrap",
    }}>
      {sty.label}
    </span>
  );
}

function CasePriorityBadge({ priority }: { priority: string }) {
  const p = priority.toLowerCase();
  const map: Record<string, { bg: string; color: string; bd: string }> = {
    high:     { bg: C.redBg,    color: C.red,    bd: C.redBd },
    medium:   { bg: C.yellowBg, color: C.yellow, bd: C.yellowBd },
    low:      { bg: C.greenBg,  color: C.green,  bd: C.greenBd },
    critical: { bg: C.redBg,    color: C.red,    bd: C.redBd },
  };
  const sty = map[p] ?? { bg: C.alt, color: C.textMid, bd: C.border };
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      borderRadius: 3,
      padding: "1px 5px",
      background: sty.bg,
      color: sty.color,
      border: `1px solid ${sty.bd}`,
      whiteSpace: "nowrap",
    }}>
      {priority}
    </span>
  );
}

function PriorityFlag({ task }: { task: CUTask }) {
  const overdue = task.due_date && !isDone(task) && parseInt(task.due_date) < Date.now();
  const blocked = isBlocked(task);
  if (overdue) return <span title="Overdue" style={{ fontSize: 13 }}>🔴</span>;
  if (blocked)  return <span title="Blocked" style={{ fontSize: 13 }}>⚠️</span>;
  if (isMilestone(task)) return <span title="Milestone" style={{ fontSize: 13 }}>★</span>;
  return <span style={{ fontSize: 13, color: C.mid }}>·</span>;
}

// ─── Tip data ─────────────────────────────────────────────────────────────────

const ERP_TIPS = [
  "Ensure task statuses are updated daily in ClickUp.",
  "Log time in NetSuite before end of each day.",
  "Flag any blockers immediately — don't wait for the standup.",
  "Confirm client deliverables have written sign-off before marking complete.",
];

// ─── Task table ───────────────────────────────────────────────────────────────

function TaskTable({
  rows,
  muted = false,
}: {
  rows: Array<{ task: CUTask; project: Project }>;
  muted?: boolean;
}) {
  const thBase: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "left" as const,
    fontSize: 10,
    fontWeight: 700,
    color: C.textSub,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    borderBottom: `1px solid ${C.border}`,
    background: C.alt,
    whiteSpace: "nowrap" as const,
  };
  const tdBase: React.CSSProperties = {
    padding: "8px 10px",
    borderBottom: `1px solid ${C.border}`,
    fontSize: 12,
    color: muted ? C.textSub : C.text,
    verticalAlign: "middle" as const,
  };

  if (rows.length === 0) {
    return (
      <div style={{ padding: "24px 16px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
        No tasks in this view.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
        <thead>
          <tr>
            <th style={{ ...thBase, width: 28, textAlign: "center" as const }}>!</th>
            <th style={thBase}>Task Name</th>
            <th style={thBase}>Project</th>
            <th style={thBase}>Due Date</th>
            <th style={thBase}>Status</th>
            <th style={{ ...thBase, textAlign: "center" as const }}>Link</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ task, project }, i) => {
            const overdue = !!task.due_date && !isDone(task) && parseInt(task.due_date) < Date.now();
            const rowBg = overdue && !muted
              ? C.redBg
              : i % 2 === 0 ? C.surface : C.alt;

            const dueTxt = task.due_date
              ? new Date(parseInt(task.due_date)).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "short",
                })
              : "—";

            return (
              <tr key={task.id} style={{ background: rowBg, opacity: muted ? 0.65 : 1 }}>
                {/* Priority flag */}
                <td style={{ ...tdBase, textAlign: "center" as const, width: 28 }}>
                  <PriorityFlag task={task} />
                </td>

                {/* Task name */}
                <td style={{ ...tdBase, maxWidth: 300 }}>
                  <a
                    href={task.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontWeight: 600,
                      fontSize: 12,
                      color: muted ? C.textSub : C.blue,
                      textDecoration: "none",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={task.name}
                  >
                    {isMilestone(task) && (
                      <span style={{ marginRight: 4, color: C.purple }}>★</span>
                    )}
                    {task.name}
                  </a>
                  <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                    {isBlocked(task) && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "0px 4px",
                        borderRadius: 3,
                        background: C.redBg,
                        color: C.red,
                        border: `1px solid ${C.redBd}`,
                      }}>
                        Blocked
                      </span>
                    )}
                    {isClientPending(task) && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "0px 4px",
                        borderRadius: 3,
                        background: C.orangeBg,
                        color: C.orange,
                        border: `1px solid ${C.orangeBd}`,
                      }}>
                        Client Pending
                      </span>
                    )}
                  </div>
                </td>

                {/* Project */}
                <td style={{ ...tdBase, fontSize: 11, color: C.textMid, whiteSpace: "nowrap" }}>
                  {project.client}
                </td>

                {/* Due date */}
                <td style={{
                  ...tdBase,
                  fontWeight: overdue && !muted ? 700 : 400,
                  color: overdue && !muted ? C.red : C.textMid,
                  whiteSpace: "nowrap",
                  fontSize: 12,
                }}>
                  {dueTxt}
                  {overdue && !muted && (
                    <span style={{ marginLeft: 4, fontSize: 10, color: C.red }}>(overdue)</span>
                  )}
                </td>

                {/* Status */}
                <td style={tdBase}>
                  <StatusBadge status={task.status.status} />
                </td>

                {/* Actions */}
                <td style={{ ...tdBase, textAlign: "center" as const }}>
                  <a
                    href={task.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: 4,
                      background: C.blueBg,
                      color: C.blue,
                      border: `1px solid ${C.blueBd}`,
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    CU ↗
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConsultantView({ projects, cases }: Props) {
  const [consultant,    setConsultant]    = useState<string>("");
  const [tipsOpen,      setTipsOpen]      = useState(false);
  const [taskTab,       setTaskTab]       = useState<TaskTab>("all");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [insightOpen,   setInsightOpen]   = useState(false);
  const [insightText,   setInsightText]   = useState<string>("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError,  setInsightError]  = useState<string>("");
  const [healthchecks,  setHealthchecks]  = useState<Healthcheck[]>([]);

  // Fetch scheduled health checks once on mount
  useEffect(() => {
    fetch("/api/healthchecks")
      .then(r => r.ok ? r.json() : { healthchecks: [] })
      .then(d => setHealthchecks(d.healthchecks ?? []))
      .catch(() => {});
  }, []);

  // Match ClickUp username → NS employee name (fuzzy: all name parts must appear in username)
  function resolveConsultantName(clickupUsername: string): string | null {
    const normalized = clickupUsername.toLowerCase().replace(/[._\-\s]/g, "");
    for (const name of Object.values(EMPLOYEES)) {
      const parts = name.toLowerCase().split(" ");
      if (parts.every(p => normalized.includes(p))) return name;
    }
    return null;
  }

  // Collect all unique assignee usernames across all projects
  const allConsultants = Array.from(
    new Set(
      projects.flatMap(p =>
        p.tasks.flatMap(t => t.assignees.map(a => a.username))
      )
    )
  ).sort();

  // ── Derived data for selected consultant ────────────────────────────────────

  const myProjects: Project[] = consultant
    ? projects.filter(p =>
        p.tasks.some(t => t.assignees.some(a => a.username === consultant))
      )
    : [];

  // All open tasks for this consultant (no project filter applied yet)
  const allMyTasks: Array<{ task: CUTask; project: Project }> = consultant
    ? projects.flatMap(p =>
        p.tasks
          .filter(t => t.assignees.some(a => a.username === consultant))
          .map(t => ({ task: t, project: p }))
      )
    : [];

  // Apply project filter to the task list
  const filteredTasks: Array<{ task: CUTask; project: Project }> = projectFilter
    ? allMyTasks.filter(({ project }) => project.id.toString() === projectFilter)
    : allMyTasks;

  // Only open tasks (not done) for most tabs
  const openFilteredTasks = filteredTasks.filter(({ task }) => !isDone(task));

  // ── Tab bucket helpers ──────────────────────────────────────────────────────

  const NOW = Date.now();
  const DAY_MS = 86400000;

  function tabRows(tab: TaskTab): Array<{ task: CUTask; project: Project }> {
    switch (tab) {
      case "all":
        return openFilteredTasks;

      case "high_priority":
        return openFilteredTasks.filter(({ task }) => {
          const overdue = !!task.due_date && parseInt(task.due_date) < NOW;
          return overdue || isBlocked(task) || isClientPending(task);
        });

      case "due_this_week":
        return openFilteredTasks.filter(({ task }) => taskBucket(task) === "this_week");

      case "due_next_week":
        return openFilteredTasks.filter(({ task }) => taskBucket(task) === "next_week");

      case "upcoming":
        return openFilteredTasks.filter(({ task }) => taskBucket(task) === "upcoming");

      case "milestones": {
        // Include done milestones too (muted), sorted by due date
        const milestoneRows = filteredTasks.filter(({ task }) => isMilestone(task));
        return milestoneRows.slice().sort((a, b) => {
          const da = a.task.due_date ? parseInt(a.task.due_date) : Infinity;
          const db = b.task.due_date ? parseInt(b.task.due_date) : Infinity;
          return da - db;
        });
      }

      case "at_risk":
        return openFilteredTasks.filter(({ task }) => {
          if (!task.due_date) return false;
          const due = parseInt(task.due_date);
          const within14 = due - NOW <= 14 * DAY_MS && due > NOW - DAY_MS;
          if (!within14) return false;
          const onlyMe = task.assignees.length === 1 && task.assignees[0].username === consultant;
          return isBlocked(task) || isClientPending(task) || onlyMe;
        });

      default:
        return openFilteredTasks;
    }
  }

  // Tab definitions
  const TABS: Array<{ key: TaskTab; label: string }> = [
    { key: "all",           label: "All" },
    { key: "high_priority", label: "High Priority" },
    { key: "due_this_week", label: "Due This Week" },
    { key: "due_next_week", label: "Due Next Week" },
    { key: "upcoming",      label: "Upcoming" },
    { key: "milestones",    label: "Milestones" },
    { key: "at_risk",       label: "At Risk" },
  ];

  // ── Alert counts ────────────────────────────────────────────────────────────

  const overdueCount = openFilteredTasks.filter(({ task }) =>
    !!task.due_date && parseInt(task.due_date) < NOW
  ).length;
  const blockedCount = openFilteredTasks.filter(({ task }) => isBlocked(task)).length;
  const showAlert    = overdueCount > 0 || blockedCount > 0;

  // ── Cases — show all open (non-closed) cases ──────────────────────────────
  // NS assigned display names don't reliably match ClickUp usernames, so we
  // show all open cases here; the dedicated Cases tab has per-assignee filtering.

  const CLOSED = ["closed", "resolved"];
  const myCases: NSCase[] = (cases ?? []).filter(
    c => !CLOSED.some(s => c.status.toLowerCase().includes(s))
  );

  // Health checks assigned to this consultant (scheduled or overdue), sorted by date
  const myNSName = consultant ? resolveConsultantName(consultant) : null;
  const myHealthchecks: Healthcheck[] = myNSName
    ? healthchecks
        .filter(h =>
          h.consultant_name === myNSName &&
          (h.status === "scheduled" || h.status === "overdue")
        )
        .sort((a, b) => {
          const da = a.scheduled_date ?? "";
          const db = b.scheduled_date ?? "";
          return da.localeCompare(db);
        })
    : [];

  // ── Project card helpers ─────────────────────────────────────────────────────

  const hColor = (h: string) =>
    h === "green" ? C.green : h === "yellow" ? C.yellow : C.red;

  function projectOpenTasks(p: Project): CUTask[] {
    return p.tasks.filter(
      t => !isDone(t) && t.assignees.some(a => a.username === consultant)
    );
  }

  // ── AI Insight ──────────────────────────────────────────────────────────────

  async function generateInsight() {
    if (!consultant || myProjects.length === 0) return;
    setInsightLoading(true);
    setInsightError("");
    setInsightText("");
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: myProjects, consultant }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInsightText(data.insight ?? data.text ?? JSON.stringify(data));
    } catch (err: unknown) {
      setInsightError(err instanceof Error ? err.message : "Failed to generate insight.");
    } finally {
      setInsightLoading(false);
    }
  }

  // ── Table styles (shared) ───────────────────────────────────────────────────

  const thBase: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "left" as const,
    fontSize: 10,
    fontWeight: 700,
    color: C.textSub,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    borderBottom: `1px solid ${C.border}`,
    background: C.alt,
    whiteSpace: "nowrap" as const,
  };
  const tdBase: React.CSSProperties = {
    padding: "8px 10px",
    borderBottom: `1px solid ${C.border}`,
    fontSize: 12,
    color: C.text,
    verticalAlign: "middle" as const,
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: C.font, color: C.text }}>

      {/* ── Consultant selector ─────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 20,
        padding: "12px 16px",
        background: C.surface,
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        boxShadow: C.sh,
      }}>
        <label style={{
          fontSize: 12,
          fontWeight: 700,
          color: C.textMid,
          whiteSpace: "nowrap",
        }}>
          Viewing as:
        </label>
        <select
          value={consultant}
          onChange={e => {
            setConsultant(e.target.value);
            setProjectFilter("");
            setTaskTab("all");
            setInsightText("");
            setInsightError("");
            setInsightOpen(false);
          }}
          style={{
            fontSize: 13,
            padding: "5px 10px",
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: consultant ? C.text : C.textSub,
            fontFamily: C.font,
            minWidth: 200,
            cursor: "pointer",
          }}
        >
          <option value="">Select consultant…</option>
          {allConsultants.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {consultant && (
          <span style={{ marginLeft: 4, fontSize: 12, color: C.textSub }}>
            {allMyTasks.filter(({ task }) => !isDone(task)).length} open task
            {allMyTasks.filter(({ task }) => !isDone(task)).length !== 1 ? "s" : ""} across{" "}
            {myProjects.length} project{myProjects.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!consultant && (
        <div style={{
          padding: "48px 24px",
          textAlign: "center",
          color: C.textSub,
          background: C.surface,
          borderRadius: 8,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>👤</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>
            Select a consultant to view their work
          </div>
          <div style={{ fontSize: 13 }}>
            Use the dropdown above to choose a consultant and see their tasks, projects, cases, and upcoming milestones.
          </div>
        </div>
      )}

      {/* ── Main content (only when consultant selected) ─────────────────────── */}
      {consultant && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* ── AI Insight banner ───────────────────────────────────────────── */}
          <div style={{
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
            borderRadius: 8,
            border: "1px solid #334155",
            boxShadow: C.shMd,
            overflow: "hidden",
          }}>
            {/* Header row */}
            <div style={{
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderBottom: insightOpen ? "1px solid #334155" : "none",
            }}>
              <span style={{ fontSize: 15 }}>✦</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", flex: 1 }}>
                Workload Analysis for {consultant}
              </span>
              <button
                onClick={() => setInsightOpen(v => !v)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "3px 10px",
                  borderRadius: 5,
                  border: "1px solid #475569",
                  background: "transparent",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontFamily: C.font,
                }}
              >
                {insightOpen ? "▲ Collapse" : "▼ Expand"}
              </button>
            </div>

            {/* Expanded body */}
            {insightOpen && (
              <div style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <button
                    onClick={generateInsight}
                    disabled={insightLoading}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "5px 14px",
                      borderRadius: 6,
                      border: "1px solid #3b82f6",
                      background: insightLoading ? "#1e3a5f" : "#1d4ed8",
                      color: "#e0effe",
                      cursor: insightLoading ? "not-allowed" : "pointer",
                      fontFamily: C.font,
                      transition: "background 0.15s",
                    }}
                  >
                    {insightLoading ? "Generating…" : "↻ Generate Insight"}
                  </button>
                  {insightText && !insightLoading && (
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      Based on {myProjects.length} project{myProjects.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {insightError && (
                  <div style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "#2d1a1a",
                    border: "1px solid #7f1d1d",
                    color: "#fca5a5",
                    fontSize: 12,
                  }}>
                    {insightError}
                  </div>
                )}

                {insightText && !insightError && (
                  <div style={{
                    padding: "12px 14px",
                    borderRadius: 6,
                    background: "#0f172a",
                    border: "1px solid #1e3a5f",
                  }}>
                    {insightText
                      .split(/\n/)
                      .filter(line => line.trim())
                      .map((line, i) => {
                        const isBullet = line.trim().startsWith("-") || line.trim().startsWith("•") || line.trim().startsWith("*");
                        return (
                          <div
                            key={i}
                            style={{
                              fontSize: 13,
                              color: "#cbd5e1",
                              lineHeight: 1.6,
                              marginBottom: 4,
                              paddingLeft: isBullet ? 16 : 0,
                              position: "relative",
                            }}
                          >
                            {isBullet && (
                              <span style={{
                                position: "absolute",
                                left: 4,
                                color: "#3b82f6",
                              }}>
                                •
                              </span>
                            )}
                            {isBullet
                              ? line.trim().replace(/^[-•*]\s*/, "")
                              : line}
                          </div>
                        );
                      })}
                  </div>
                )}

                {!insightText && !insightLoading && !insightError && (
                  <div style={{ fontSize: 12, color: "#475569" }}>
                    Click "Generate Insight" to run an AI workload analysis for {consultant}.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Section A — Priority Alert Bar ─────────────────────────────── */}
          {showAlert && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              background: overdueCount > 0 ? C.redBg : C.orangeBg,
              border: `1px solid ${overdueCount > 0 ? C.redBd : C.orangeBd}`,
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 600,
              color: overdueCount > 0 ? C.red : C.orange,
            }}>
              <span style={{ fontSize: 16 }}>⚠</span>
              <span>
                {overdueCount > 0 && blockedCount > 0 && (
                  <>You have <strong>{overdueCount}</strong> overdue task{overdueCount !== 1 ? "s" : ""} and <strong>{blockedCount}</strong> blocked task{blockedCount !== 1 ? "s" : ""} requiring attention.</>
                )}
                {overdueCount > 0 && blockedCount === 0 && (
                  <>You have <strong>{overdueCount}</strong> overdue task{overdueCount !== 1 ? "s" : ""} requiring attention.</>
                )}
                {overdueCount === 0 && blockedCount > 0 && (
                  <>You have <strong>{blockedCount}</strong> blocked task{blockedCount !== 1 ? "s" : ""} requiring attention.</>
                )}
              </span>
            </div>
          )}

          {/* ── Task section with sub-tabs + project filter ─────────────────── */}
          <div style={{
            background: C.surface,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            boxShadow: C.sh,
            overflow: "hidden",
          }}>
            {/* Section header */}
            <div style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ fontSize: 15 }}>📋</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                My Tasks
              </span>
              <span style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 600,
                padding: "1px 7px",
                borderRadius: 10,
                background: C.blueBg,
                color: C.blue,
                border: `1px solid ${C.blueBd}`,
              }}>
                {allMyTasks.filter(({ task }) => !isDone(task)).length}
              </span>
            </div>

            {/* Project filter + tab bar */}
            <div style={{
              padding: "10px 16px",
              borderBottom: `1px solid ${C.border}`,
              background: C.alt,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}>
              {/* Project filter */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: C.textMid, whiteSpace: "nowrap" }}>
                  Filter by Project:
                </label>
                <select
                  value={projectFilter}
                  onChange={e => setProjectFilter(e.target.value)}
                  style={{
                    fontSize: 12,
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: C.surface,
                    color: C.text,
                    fontFamily: C.font,
                    cursor: "pointer",
                    minWidth: 180,
                  }}
                >
                  <option value="">All Projects</option>
                  {myProjects.map(p => (
                    <option key={p.id} value={p.id.toString()}>
                      {p.client} ({p.entityid})
                    </option>
                  ))}
                </select>
              </div>

              {/* Pill tab bar */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TABS.map(({ key, label }) => {
                  const count  = tabRows(key).length;
                  const active = taskTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setTaskTab(key)}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "4px 12px",
                        borderRadius: 20,
                        border: `1px solid ${active ? C.blue : C.border}`,
                        background: active ? C.blue : C.surface,
                        color: active ? "#fff" : C.textMid,
                        cursor: "pointer",
                        fontFamily: C.font,
                        transition: "all 0.1s",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                      <span style={{
                        marginLeft: 5,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "0 5px",
                        borderRadius: 10,
                        background: active ? "rgba(255,255,255,0.25)" : C.alt,
                        color: active ? "#fff" : C.textSub,
                      }}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Task table */}
            <TaskTable
              rows={tabRows(taskTab)}
              muted={taskTab === "milestones"}
            />
          </div>

          {/* ── Section C — My Projects ─────────────────────────────────────── */}
          <div style={{
            background: C.surface,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            boxShadow: C.sh,
            overflow: "hidden",
          }}>
            <div style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ fontSize: 15 }}>🗂</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                My Projects
              </span>
              <span style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 600,
                padding: "1px 7px",
                borderRadius: 10,
                background: C.blueBg,
                color: C.blue,
                border: `1px solid ${C.blueBd}`,
              }}>
                {myProjects.length}
              </span>
            </div>

            {myProjects.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                No projects assigned to this consultant.
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 14,
                padding: 16,
              }}>
                {myProjects.map(p => {
                  const openTasks     = projectOpenTasks(p);
                  const overdueOnProj = openTasks.filter(t =>
                    t.due_date && parseInt(t.due_date) < NOW
                  ).length;
                  const color = hColor(p.health);

                  return (
                    <div
                      key={p.id}
                      style={{
                        background: C.alt,
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        boxShadow: C.sh,
                      }}
                    >
                      {/* Card header */}
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontWeight: 700,
                            fontSize: 13,
                            color: C.text,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {p.client}
                          </div>
                          <div style={{ fontSize: 10, color: C.textSub, marginTop: 1 }}>
                            # {p.entityid}
                          </div>
                        </div>
                        <HealthBadge health={p.health} score={p.score} size="sm" />
                      </div>

                      {/* Task counts */}
                      <div style={{ display: "flex", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1 }}>
                            {openTasks.length}
                          </div>
                          <div style={{ fontSize: 10, color: C.textSub }}>open tasks</div>
                        </div>
                        {overdueOnProj > 0 && (
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: C.red, lineHeight: 1 }}>
                              {overdueOnProj}
                            </div>
                            <div style={{ fontSize: 10, color: C.red }}>overdue</div>
                          </div>
                        )}
                        <div style={{ marginLeft: "auto", textAlign: "right" as const }}>
                          <div style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: p.rem < 15 ? C.red : C.textMid,
                            fontFamily: C.mono,
                            lineHeight: 1,
                          }}>
                            {fmtH(p.rem)}
                          </div>
                          <div style={{ fontSize: 10, color: C.textSub }}>remaining</div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 10, color: C.textSub }}>Task completion</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: C.mono }}>
                            {fmtPct(p.pct)}
                          </span>
                        </div>
                        <ProgressBar val={p.pct} burn={p.burnRate} color={color} h={5} />
                      </div>

                      {/* Go-live */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          {p.goliveDate ? (
                            <>
                              <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                                {new Date(p.goliveDate).toLocaleDateString("en-AU", {
                                  day: "numeric",
                                  month: "short",
                                  year: "2-digit",
                                })}
                              </div>
                              <div style={{
                                fontSize: 10,
                                color: p.isOverdue ? C.red : C.textSub,
                                fontWeight: p.isOverdue ? 700 : 400,
                              }}>
                                {fmtD(p.daysLeft)}
                              </div>
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>
                              ⚠ No go-live date
                            </span>
                          )}
                        </div>
                        {/* Links */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                          {p.clickupUrl && (
                            <LinkBtn
                              href={p.clickupUrl}
                              color={C.blue}
                              bg={C.blueBg}
                              bd={C.blueBd}
                              label="ClickUp"
                            />
                          )}
                          <LinkBtn
                            href={nsProjectUrl(p.id)}
                            color={C.purple}
                            bg={C.purpleBg}
                            bd={C.purpleBd}
                            label="NetSuite"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── My Cases ───────────────────────────────────────────────────── */}
          <div style={{
            background: C.surface,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            boxShadow: C.sh,
            overflow: "hidden",
          }}>
            <div style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ fontSize: 15 }}>🗃</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                Open Cases
              </span>
              <span style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 600,
                padding: "1px 7px",
                borderRadius: 10,
                background: myCases.length > 0 ? C.tealBg : C.alt,
                color: myCases.length > 0 ? C.teal : C.textSub,
                border: `1px solid ${myCases.length > 0 ? C.tealBd : C.border}`,
              }}>
                {myCases.length}
              </span>
            </div>

            {myCases.length === 0 ? (
              <div style={{ padding: "20px 16px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                <div style={{ marginBottom: 4 }}>No open cases found.</div>
                <div style={{ fontSize: 11, color: C.mid }}>Cases are sourced from NetSuite support records.</div>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
                  <thead>
                    <tr>
                      <th style={thBase}>Case #</th>
                      <th style={thBase}>Title</th>
                      <th style={thBase}>Company</th>
                      <th style={thBase}>Priority</th>
                      <th style={thBase}>Status</th>
                      <th style={thBase}>Last Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myCases.map((c, i) => {
                      const rowBg = i % 2 === 0 ? C.surface : C.alt;
                      return (
                        <tr key={c.id} style={{ background: rowBg }}>
                          <td style={{ ...tdBase, fontFamily: C.mono, fontSize: 11, color: C.textMid, whiteSpace: "nowrap" }}>
                            {c.caseNumber}
                          </td>
                          <td style={{ ...tdBase, maxWidth: 300 }}>
                            <div style={{
                              fontWeight: 600,
                              fontSize: 12,
                              color: C.text,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }} title={c.title}>
                              {c.title}
                            </div>
                          </td>
                          <td style={{ ...tdBase, fontSize: 11, color: C.textMid, whiteSpace: "nowrap" }}>
                            {c.company}
                          </td>
                          <td style={tdBase}>
                            <CasePriorityBadge priority={c.priority} />
                          </td>
                          <td style={tdBase}>
                            <StatusBadge status={c.status} />
                          </td>
                          <td style={{ ...tdBase, fontSize: 11, color: C.textMid, whiteSpace: "nowrap" }}>
                            {c.lastModified
                              ? new Date(c.lastModified).toLocaleDateString("en-AU", {
                                  day: "numeric",
                                  month: "short",
                                  year: "2-digit",
                                })
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Health Checks ──────────────────────────────────────────────── */}
          <div style={{
            background: C.surface,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            boxShadow: C.sh,
            overflow: "hidden",
          }}>
            <div style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ fontSize: 15 }}>🩺</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                Health Checks
              </span>
              {myHealthchecks.length > 0 && (
                <span style={{
                  marginLeft: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "1px 7px",
                  borderRadius: 10,
                  background: C.tealBg,
                  color: C.teal,
                  border: `1px solid ${C.tealBd}`,
                }}>
                  {myHealthchecks.length}
                </span>
              )}
            </div>

            {!myNSName ? (
              <div style={{ padding: "20px 16px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                Select a consultant to see their scheduled health checks.
              </div>
            ) : myHealthchecks.length === 0 ? (
              <div style={{ padding: "20px 16px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                No scheduled health checks for {myNSName}.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
                  <thead>
                    <tr>
                      {[["Customer", ""], ["Quarter", ""], ["Date", ""], ["Status", ""], ["Topics", ""]].map(([label]) => (
                        <th key={label} style={{
                          padding: "8px 12px",
                          textAlign: "left" as const,
                          fontSize: 10,
                          fontWeight: 700,
                          color: C.textSub,
                          textTransform: "uppercase" as const,
                          letterSpacing: "0.05em",
                          borderBottom: `1px solid ${C.border}`,
                          background: C.alt,
                          whiteSpace: "nowrap" as const,
                        }}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {myHealthchecks.map((hc, i) => {
                      const isOverdue = hc.status === "overdue";
                      const rowBg = isOverdue ? C.redBg : i % 2 === 0 ? C.surface : C.alt;
                      const dateStr = hc.scheduled_date
                        ? new Date(hc.scheduled_date + "T00:00:00").toLocaleDateString("en-AU", {
                            day: "numeric", month: "short", year: "2-digit",
                          })
                        : "—";
                      return (
                        <tr key={hc.id} style={{ background: rowBg }}>
                          <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.border}` }}>
                            {hc.customer_name}
                          </td>
                          <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: C.mono, color: C.textMid, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" as const }}>
                            {hc.quarter}
                          </td>
                          <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: C.mono, color: isOverdue ? C.red : C.text, fontWeight: isOverdue ? 700 : 400, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" as const }}>
                            {dateStr}
                            {isOverdue && <span style={{ marginLeft: 6, fontSize: 10 }}>⚠ Overdue</span>}
                          </td>
                          <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700, borderRadius: 4, padding: "2px 7px",
                              background: isOverdue ? C.redBg : C.blueBg,
                              color: isOverdue ? C.red : C.blue,
                              border: `1px solid ${isOverdue ? C.redBd : C.blueBd}`,
                            }}>
                              {isOverdue ? "⚠ Overdue" : "📅 Scheduled"}
                            </span>
                          </td>
                          <td style={{ padding: "8px 12px", fontSize: 12, color: C.textMid, borderBottom: `1px solid ${C.border}`, maxWidth: 240 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={hc.topics ?? ""}>
                              {hc.topics || <span style={{ color: C.mid }}>—</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── ERP Best Practice Tips ─────────────────────────────────────── */}
          <div style={{
            background: C.surface,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            boxShadow: C.sh,
            overflow: "hidden",
          }}>
            <button
              onClick={() => setTipsOpen(v => !v)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 16px",
                background: "none",
                border: "none",
                borderBottom: tipsOpen ? `1px solid ${C.border}` : "none",
                cursor: "pointer",
                fontFamily: C.font,
                textAlign: "left" as const,
              }}
            >
              <span style={{ fontSize: 15 }}>💡</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text, flex: 1 }}>
                ERP Best Practice Reminders
              </span>
              <span style={{ fontSize: 11, color: C.textSub }}>
                {tipsOpen ? "▲ Hide" : "▼ Show"}
              </span>
            </button>

            {tipsOpen && (
              <ul style={{
                margin: 0,
                padding: "12px 16px 14px 36px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}>
                {ERP_TIPS.map((tip, i) => (
                  <li key={i} style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>
                    {tip}
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
