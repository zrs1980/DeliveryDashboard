"use client";
import { useState } from "react";
import { C, STATUS_STYLES } from "@/lib/constants";
import { LinkBtn } from "@/components/ui/LinkBtn";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { isBlocked, isClientPending, isMilestone, isDone, taskBucket } from "@/lib/clickup";
import { nsProjectUrl } from "@/lib/constants";
import type { Project, CUTask, ProjectNote } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "overdue" | "this_week" | "next_week" | "upcoming" | "milestones" | "blocked" | "client";

interface Props {
  projects: Project[];
  onProjectsChange: (updated: Project[]) => void;
}

interface TaskRow {
  task: CUTask;
  project: Project;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TAB_DEFS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "overdue",    label: "Overdue",    icon: "🔴" },
  { id: "this_week",  label: "This Week",  icon: "📅" },
  { id: "next_week",  label: "Next Week",  icon: "📆" },
  { id: "upcoming",   label: "Upcoming",   icon: "🗓" },
  { id: "milestones", label: "Milestones", icon: "★" },
  { id: "blocked",    label: "Blocked",    icon: "⚠" },
  { id: "client",     label: "Client",     icon: "🤝" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterForTab(rows: TaskRow[], tabId: TabId): TaskRow[] {
  switch (tabId) {
    case "overdue":
      return rows.filter(({ task }) => taskBucket(task) === "overdue" && !isDone(task));
    case "this_week":
      return rows.filter(({ task }) => taskBucket(task) === "this_week" && !isDone(task));
    case "next_week":
      return rows.filter(({ task }) => taskBucket(task) === "next_week" && !isDone(task));
    case "upcoming":
      return rows.filter(({ task }) => taskBucket(task) === "upcoming" && !isDone(task));
    case "milestones":
      return rows.filter(({ task }) => isMilestone(task));
    case "blocked":
      return rows.filter(({ task }) => isBlocked(task));
    case "client":
      return rows.filter(({ task }) => isClientPending(task) && !isDone(task));
    default:
      return [];
  }
}

function formatDue(dueDateMs: string | null): string {
  if (!dueDateMs) return "—";
  return new Date(parseInt(dueDateMs)).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function firstName(username: string): string {
  return username.split(" ")[0] ?? username;
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const st  = status.toLowerCase();
  const sty = STATUS_STYLES[st] ?? { bg: C.alt, color: C.textMid, bd: C.border, label: status };
  return (
    <span style={{
      display: "inline-block",
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

// ─── Table header ─────────────────────────────────────────────────────────────

function TableHead() {
  const th: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: C.textMid,
    textAlign: "left",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    background: C.alt,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  };
  return (
    <thead>
      <tr>
        <th style={{ ...th, width: 80 }}>Status</th>
        <th style={{ ...th }}>Task</th>
        <th style={{ ...th, width: 130 }}>Client</th>
        <th style={{ ...th, width: 110 }}>Assignees</th>
        <th style={{ ...th, width: 80 }}>Due</th>
        <th style={{ ...th, width: 100 }}>Links</th>
      </tr>
    </thead>
  );
}

// ─── Task table row ───────────────────────────────────────────────────────────

function TaskTableRow({
  task,
  project,
  isAlt,
}: {
  task: CUTask;
  project: Project;
  isAlt: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const blocked    = isBlocked(task);
  const client     = isClientPending(task) && !isDone(task);
  const milestone  = isMilestone(task);
  const done       = isDone(task);

  const rowBg = hovered
    ? "#E8EEF8"
    : isAlt
    ? C.alt
    : C.surface;

  const td: React.CSSProperties = {
    padding: "0 10px",
    height: 36,
    verticalAlign: "middle",
    borderBottom: `1px solid ${C.border}`,
    fontSize: 12,
    color: done ? C.textSub : C.text,
  };

  const assigneeNames = task.assignees
    .map(a => firstName(a.username))
    .join(", ") || "—";

  return (
    <tr
      style={{ background: rowBg, transition: "background 0.1s" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Status */}
      <td style={td}>
        <StatusBadge status={task.status.status} />
      </td>

      {/* Task name */}
      <td style={{ ...td, maxWidth: 320 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          {milestone && (
            <span title="Milestone" style={{ color: C.purple, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>★</span>
          )}
          {blocked && (
            <span title="Blocked" style={{ color: C.red, fontWeight: 700, fontSize: 12, flexShrink: 0 }}>⚠</span>
          )}
          {client && !blocked && (
            <span title="Awaiting client" style={{ color: C.orange, fontSize: 12, flexShrink: 0 }}>👤</span>
          )}
          <a
            href={task.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: done ? C.textSub : C.blue,
              textDecoration: "none",
              fontWeight: done ? 400 : 500,
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
              opacity: done ? 0.7 : 1,
            }}
            title={task.name}
          >
            {task.name}
          </a>
        </div>
      </td>

      {/* Client */}
      <td style={{ ...td, color: C.textMid }}>
        <span style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "block",
          maxWidth: 128,
        }} title={project.client}>
          {project.client}
        </span>
      </td>

      {/* Assignees */}
      <td style={{ ...td, color: C.textMid }}>
        <span style={{ whiteSpace: "nowrap" }}>{assigneeNames}</span>
      </td>

      {/* Due date */}
      <td style={{
        ...td,
        color: taskBucket(task) === "overdue" && !done ? C.red : C.textMid,
        fontWeight: taskBucket(task) === "overdue" && !done ? 600 : 400,
        whiteSpace: "nowrap",
      }}>
        {formatDue(task.due_date)}
      </td>

      {/* Links */}
      <td style={td}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <LinkBtn
            href={task.url}
            color={C.blue}
            bg={C.blueBg}
            bd={C.blueBd}
            label="CU"
          />
          <LinkBtn
            href={nsProjectUrl(project.id)}
            color={C.purple}
            bg={C.purpleBg}
            bd={C.purpleBd}
            label="NS"
          />
        </div>
      </td>
    </tr>
  );
}

// ─── Group header row ─────────────────────────────────────────────────────────

function GroupHeaderRow({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={6}
        style={{
          padding: "4px 10px",
          background: "#DDEAF8",
          borderBottom: `1px solid ${C.border}`,
          borderTop: `1px solid ${C.border}`,
          fontSize: 11,
          fontWeight: 700,
          color: C.textMid,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </td>
    </tr>
  );
}

// ─── Task table body ──────────────────────────────────────────────────────────

function TaskTable({
  rows,
  groupByProject,
}: {
  rows: TaskRow[];
  groupByProject: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div style={{
        padding: "40px 0",
        textAlign: "center",
        color: C.textSub,
        fontSize: 13,
      }}>
        No tasks in this category.
      </div>
    );
  }

  let rowIndex = 0;

  const buildRows = (): React.ReactNode[] => {
    if (!groupByProject) {
      return rows.map(({ task, project }) => {
        const alt = rowIndex % 2 === 1;
        rowIndex++;
        return (
          <TaskTableRow key={task.id} task={task} project={project} isAlt={alt} />
        );
      });
    }

    // Group by project
    const groups = new Map<number, TaskRow[]>();
    const order: number[] = [];
    for (const row of rows) {
      if (!groups.has(row.project.id)) {
        groups.set(row.project.id, []);
        order.push(row.project.id);
      }
      groups.get(row.project.id)!.push(row);
    }

    const result: React.ReactNode[] = [];
    for (const projectId of order) {
      const projectRows = groups.get(projectId)!;
      const projectLabel = projectRows[0].project.client;
      result.push(<GroupHeaderRow key={`grp-${projectId}`} label={projectLabel} />);
      rowIndex = 0;
      for (const { task, project } of projectRows) {
        const alt = rowIndex % 2 === 1;
        rowIndex++;
        result.push(
          <TaskTableRow key={task.id} task={task} project={project} isAlt={alt} />
        );
      }
    }
    return result;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        fontFamily: C.font,
      }}>
        <colgroup>
          <col style={{ width: 90 }} />
          <col />
          <col style={{ width: 140 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 85 }} />
          <col style={{ width: 110 }} />
        </colgroup>
        <TableHead />
        <tbody>{buildRows()}</tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TaskCommandCenter({ projects, onProjectsChange }: Props) {
  const [tab, setTab]                       = useState<TabId>("overdue");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedResource, setSelectedResource] = useState<string>("");
  const [groupByProject, setGroupByProject]   = useState<boolean>(false);

  const visibleProjects = selectedProject
    ? projects.filter(p => p.id === selectedProject)
    : projects;

  const allRows: TaskRow[] = visibleProjects.flatMap(p =>
    p.tasks
      .filter(t => !selectedResource || t.assignees.some(a => a.username === selectedResource))
      .map(t => ({ task: t, project: p }))
  );

  const allResources = Array.from(new Set(
    projects.flatMap(p => p.tasks.flatMap(t => t.assignees.map(a => a.username)))
  )).sort();

  // Precompute counts for each tab
  const tabCounts: Record<TabId, number> = {
    overdue:    filterForTab(allRows, "overdue").length,
    this_week:  filterForTab(allRows, "this_week").length,
    next_week:  filterForTab(allRows, "next_week").length,
    upcoming:   filterForTab(allRows, "upcoming").length,
    milestones: filterForTab(allRows, "milestones").length,
    blocked:    filterForTab(allRows, "blocked").length,
    client:     filterForTab(allRows, "client").length,
  };

  const activeRows = filterForTab(allRows, tab);

  const totalDone = allRows.filter(({ task }) => isDone(task)).length;

  const selectStyle: React.CSSProperties = {
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 5,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
    fontFamily: C.font,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: C.textSub,
    textTransform: "uppercase",
    marginRight: 6,
  };

  return (
    <div style={{ fontFamily: C.font }}>

      {/* ── Filter bar ── */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Project</label>
          <select
            value={selectedProject ?? ""}
            onChange={e => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
            style={selectStyle}
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.client}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Resource</label>
          <select
            value={selectedResource}
            onChange={e => setSelectedResource(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            {allResources.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={groupByProject}
            onChange={e => setGroupByProject(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Group by Project
        </label>

        <span style={{ marginLeft: "auto", fontSize: 12, color: C.textSub }}>
          {totalDone} / {allRows.length} done
        </span>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: "flex",
        gap: 0,
        borderBottom: `2px solid ${C.border}`,
        marginBottom: 0,
        overflowX: "auto",
      }}>
        {TAB_DEFS.map(t => {
          const count   = tabCounts[t.id];
          const active  = tab === t.id;
          const isAlert = t.id === "overdue" || t.id === "blocked";
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: C.font,
                background: "none",
                border: "none",
                borderBottom: active ? `2px solid ${C.blue}` : "2px solid transparent",
                color: active
                  ? C.blue
                  : (isAlert && count > 0 ? C.red : C.textMid),
                cursor: "pointer",
                marginBottom: -2,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {t.icon} {t.label} ({count})
            </button>
          );
        })}
      </div>

      {/* ── Table ── */}
      <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderTop: "none",
        borderRadius: "0 0 8px 8px",
        overflow: "hidden",
        boxShadow: C.sh,
      }}>
        <TaskTable rows={activeRows} groupByProject={groupByProject} />
      </div>

      {/* ── Notes panel (single project selected) ── */}
      {selectedProject && (() => {
        const proj = projects.find(p => p.id === selectedProject);
        if (!proj) return null;
        return (
          <div style={{
            marginTop: 20,
            background: C.surface,
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            overflow: "hidden",
            boxShadow: C.sh,
          }}>
            <div style={{
              padding: "10px 16px",
              borderBottom: `1px solid ${C.border}`,
              fontWeight: 700,
              fontSize: 13,
              color: C.text,
            }}>
              Project Notes — {proj.client}
            </div>
            <NotesPanel
              projectId={proj.id}
              notes={proj.notes}
              onNotesChange={updated =>
                onProjectsChange(projects.map(p => p.id === proj.id ? { ...p, notes: updated } : p))
              }
            />
          </div>
        );
      })()}

    </div>
  );
}
