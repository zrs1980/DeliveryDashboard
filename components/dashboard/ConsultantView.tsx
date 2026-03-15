"use client";
import { useState } from "react";
import { C, nsProjectUrl, STATUS_STYLES } from "@/lib/constants";
import { isBlocked, isClientPending, isMilestone, isDone, taskBucket } from "@/lib/clickup";
import { fmtH, fmtD, fmtPct } from "@/lib/health";
import { HealthBadge } from "@/components/health/HealthBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LinkBtn } from "@/components/ui/LinkBtn";
import type { Project, CUTask } from "@/lib/types";

interface Props {
  projects: Project[];
}

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

function PriorityFlag({ task }: { task: CUTask }) {
  const overdue = task.due_date && !isDone(task) && parseInt(task.due_date) < Date.now();
  const blocked = isBlocked(task);
  if (overdue) return <span title="Overdue" style={{ fontSize: 13 }}>🔴</span>;
  if (blocked)  return <span title="Blocked" style={{ fontSize: 13 }}>⚠️</span>;
  if (isMilestone(task)) return <span title="Milestone" style={{ fontSize: 13 }}>★</span>;
  return <span style={{ fontSize: 13, color: C.mid }}>·</span>;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      color: C.textSub,
      textTransform: "uppercase" as const,
      letterSpacing: "0.06em",
      marginBottom: 10,
    }}>
      {title}
    </div>
  );
}

// ─── Tip data ─────────────────────────────────────────────────────────────────

const ERP_TIPS = [
  "Ensure task statuses are updated daily in ClickUp.",
  "Log time in NetSuite before end of each day.",
  "Flag any blockers immediately — don't wait for the standup.",
  "Confirm client deliverables have written sign-off before marking complete.",
];

// ─── Main component ───────────────────────────────────────────────────────────

export function ConsultantView({ projects }: Props) {
  const [consultant, setConsultant] = useState<string>("");
  const [tipsOpen,   setTipsOpen]   = useState(false);

  // Collect all unique assignee usernames across all projects
  const allConsultants = Array.from(
    new Set(
      projects.flatMap(p =>
        p.tasks.flatMap(t => t.assignees.map(a => a.username))
      )
    )
  ).sort();

  // ── Derived data for selected consultant ──────────────────────────────────

  const myTasks: Array<{ task: CUTask; project: Project }> = consultant
    ? projects.flatMap(p =>
        p.tasks
          .filter(t => !isDone(t) && t.assignees.some(a => a.username === consultant))
          .map(t => ({ task: t, project: p }))
      )
    : [];

  const myProjects: Project[] = consultant
    ? projects.filter(p =>
        p.tasks.some(t => t.assignees.some(a => a.username === consultant))
      )
    : [];

  // Tasks due this week or overdue (for Section B)
  const weekTasks = myTasks
    .filter(({ task }) => {
      const b = taskBucket(task);
      return b === "overdue" || b === "this_week";
    })
    .sort((a, b) => {
      const bucketA = taskBucket(a.task);
      const bucketB = taskBucket(b.task);
      // Overdue always first
      if (bucketA === "overdue" && bucketB !== "overdue") return -1;
      if (bucketA !== "overdue" && bucketB === "overdue") return 1;
      // Then by due date ascending
      const da = a.task.due_date ? parseInt(a.task.due_date) : Infinity;
      const db = b.task.due_date ? parseInt(b.task.due_date) : Infinity;
      return da - db;
    })
    .slice(0, 20);

  // Alert counts
  const overdueCount  = myTasks.filter(({ task }) => task.due_date && parseInt(task.due_date) < Date.now()).length;
  const blockedCount  = myTasks.filter(({ task }) => isBlocked(task)).length;
  const showAlert     = overdueCount > 0 || blockedCount > 0;

  // Milestones (Section D)
  const myMilestones = myTasks.filter(({ task }) => isMilestone(task));

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmtDue(task: CUTask): string {
    if (!task.due_date) return "—";
    return new Date(parseInt(task.due_date)).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
    });
  }

  function taskIsOverdue(task: CUTask): boolean {
    return !!task.due_date && !isDone(task) && parseInt(task.due_date) < Date.now();
  }

  function projectOpenTasks(p: Project): CUTask[] {
    return p.tasks.filter(
      t => !isDone(t) && t.assignees.some(a => a.username === consultant)
    );
  }

  const hColor = (h: string) =>
    h === "green" ? C.green : h === "yellow" ? C.yellow : C.red;

  // ── Table cell style helpers ───────────────────────────────────────────────

  const tdBase: React.CSSProperties = {
    padding: "8px 10px",
    borderBottom: `1px solid ${C.border}`,
    fontSize: 12,
    color: C.text,
    verticalAlign: "middle" as const,
  };

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

  // ── Render ────────────────────────────────────────────────────────────────

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
          onChange={e => setConsultant(e.target.value)}
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
          <span style={{
            marginLeft: 4,
            fontSize: 12,
            color: C.textSub,
          }}>
            {myTasks.length} open task{myTasks.length !== 1 ? "s" : ""} across{" "}
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
            Use the dropdown above to choose a consultant and see their tasks, projects, and upcoming milestones.
          </div>
        </div>
      )}

      {/* ── Main content (only when consultant selected) ─────────────────────── */}
      {consultant && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

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

          {/* ── Section B — My Tasks This Week ─────────────────────────────── */}
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
              <span style={{ fontSize: 15 }}>📅</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                My Tasks This Week
              </span>
              <span style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 600,
                padding: "1px 7px",
                borderRadius: 10,
                background: weekTasks.length > 0 ? C.blueBg : C.alt,
                color: weekTasks.length > 0 ? C.blue : C.textSub,
                border: `1px solid ${weekTasks.length > 0 ? C.blueBd : C.border}`,
              }}>
                {weekTasks.length}
              </span>
            </div>

            {weekTasks.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                No tasks due this week. Nice work!
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
                  <thead>
                    <tr>
                      <th style={{ ...thBase, width: 28, textAlign: "center" as const }}>!</th>
                      <th style={thBase}>Task Name</th>
                      <th style={thBase}>Project</th>
                      <th style={thBase}>Due Date</th>
                      <th style={thBase}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekTasks.map(({ task, project }, i) => {
                      const overdue = taskIsOverdue(task);
                      const rowBg   = overdue
                        ? C.redBg
                        : i % 2 === 0 ? C.surface : C.alt;

                      return (
                        <tr key={task.id} style={{ background: rowBg }}>
                          {/* Priority flag */}
                          <td style={{ ...tdBase, textAlign: "center" as const, width: 28 }}>
                            <PriorityFlag task={task} />
                          </td>

                          {/* Task name */}
                          <td style={{ ...tdBase, maxWidth: 320 }}>
                            <a
                              href={task.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontWeight: 600,
                                fontSize: 12,
                                color: C.blue,
                                textDecoration: "none",
                                display: "block",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={task.name}
                            >
                              {task.name}
                            </a>
                            {isBlocked(task) && (
                              <span style={{
                                display: "inline-block",
                                marginTop: 2,
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
                          </td>

                          {/* Project */}
                          <td style={{ ...tdBase, fontSize: 11, color: C.textMid, whiteSpace: "nowrap" }}>
                            {project.client}
                          </td>

                          {/* Due date */}
                          <td style={{
                            ...tdBase,
                            fontWeight: overdue ? 700 : 400,
                            color: overdue ? C.red : C.textMid,
                            whiteSpace: "nowrap",
                            fontSize: 12,
                          }}>
                            {fmtDue(task)}
                            {overdue && (
                              <span style={{ marginLeft: 4, fontSize: 10, color: C.red }}>
                                (overdue)
                              </span>
                            )}
                          </td>

                          {/* Status */}
                          <td style={tdBase}>
                            <StatusBadge status={task.status.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
                    t.due_date && parseInt(t.due_date) < Date.now()
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

          {/* ── Section D — Upcoming Milestones ────────────────────────────── */}
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
              <span style={{ fontSize: 15 }}>★</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                Upcoming Milestones
              </span>
              <span style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 600,
                padding: "1px 7px",
                borderRadius: 10,
                background: myMilestones.length > 0 ? C.purpleBg : C.alt,
                color: myMilestones.length > 0 ? C.purple : C.textSub,
                border: `1px solid ${myMilestones.length > 0 ? C.purpleBd : C.border}`,
              }}>
                {myMilestones.length}
              </span>
            </div>

            {myMilestones.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                No milestones assigned to this consultant.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
                  <thead>
                    <tr>
                      <th style={thBase}>Milestone</th>
                      <th style={thBase}>Project</th>
                      <th style={thBase}>Due Date</th>
                      <th style={thBase}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myMilestones
                      .slice()
                      .sort((a, b) => {
                        const da = a.task.due_date ? parseInt(a.task.due_date) : Infinity;
                        const db = b.task.due_date ? parseInt(b.task.due_date) : Infinity;
                        return da - db;
                      })
                      .map(({ task, project }, i) => {
                        const overdue = taskIsOverdue(task);
                        const rowBg   = i % 2 === 0 ? C.surface : C.alt;

                        return (
                          <tr key={task.id} style={{ background: rowBg }}>
                            {/* Milestone name */}
                            <td style={{ ...tdBase, maxWidth: 300 }}>
                              <a
                                href={task.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontWeight: 600,
                                  fontSize: 12,
                                  color: C.purple,
                                  textDecoration: "none",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={task.name}
                              >
                                <span style={{ fontSize: 11 }}>★</span>
                                {task.name}
                              </a>
                            </td>

                            {/* Project */}
                            <td style={{ ...tdBase, fontSize: 11, color: C.textMid, whiteSpace: "nowrap" }}>
                              {project.client}
                            </td>

                            {/* Due date */}
                            <td style={{
                              ...tdBase,
                              fontWeight: overdue ? 700 : 400,
                              color: overdue ? C.red : C.textMid,
                              whiteSpace: "nowrap",
                              fontSize: 12,
                            }}>
                              {fmtDue(task)}
                              {overdue && (
                                <span style={{ marginLeft: 4, fontSize: 10, color: C.red }}>
                                  (overdue)
                                </span>
                              )}
                            </td>

                            {/* Status */}
                            <td style={tdBase}>
                              <StatusBadge status={task.status.status} />
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
                  <li
                    key={i}
                    style={{
                      fontSize: 13,
                      color: C.textMid,
                      lineHeight: 1.5,
                    }}
                  >
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
