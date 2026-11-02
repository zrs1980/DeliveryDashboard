"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { C, STATUS_STYLES } from "@/lib/constants";
import { LinkBtn } from "@/components/ui/LinkBtn";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { isBlocked, isClientPending, isMilestone, isDone, taskBucket, deriveTaskRollup, type CUStatus } from "@/lib/clickup";
import { nsProjectUrl } from "@/lib/constants";
import { PostToSlackModal } from "@/components/dashboard/PostToSlackModal";
import { TaskCommentsModal } from "@/components/dashboard/TaskCommentsModal";
import type { Project, CUTask, ProjectNote } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "overdue" | "this_week" | "next_week" | "upcoming" | "milestones" | "blocked" | "client";

/**
 * Accepts an updater as well as a plain array. The status dropdown writes twice
 * for one edit — optimistically, then again with whatever ClickUp reports back —
 * and a plain array built from the render-time `projects` would make the second
 * write discard the first, along with any other edit made in between.
 */
type ProjectsUpdate = Project[] | ((prev: Project[]) => Project[]);

interface Props {
  projects: Project[];
  onProjectsChange: (updated: ProjectsUpdate) => void;
  initialTab?: TabId;
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

// ─── Sorting ──────────────────────────────────────────────────────────────────

type SortKey = "status" | "priority" | "task" | "client" | "assignees" | "due" | "scheduled";
type SortDir = "asc" | "desc";

/**
 * Fixed rather than built from the loaded tasks (unlike the status filter):
 * ClickUp's four priorities are the same on every list, and "No priority" is
 * the one most worth finding.
 */
const PRIORITY_OPTIONS = [
  { value: "1",    label: "Urgent" },
  { value: "2",    label: "High" },
  { value: "3",    label: "Normal" },
  { value: "4",    label: "Low" },
  { value: "none", label: "No priority" },
];

/** ClickUp's rank, 1 = urgent … 4 = low. Null when no priority is set. */
function priorityRank(task: CUTask): number | null {
  const n = parseInt(task.priority?.orderindex ?? "");
  return isNaN(n) ? null : n;
}

/**
 * The value a column sorts on. Null means "no value" — those rows go LAST in
 * both directions, so flipping a sort never buries the tasks that have one
 * under a block of blanks.
 */
function sortValue(row: TaskRow, key: SortKey, scheduledMap: Map<string, string>): string | number | null {
  const { task, project } = row;
  switch (key) {
    case "status":    return statusLabel(task.status.status).toLowerCase();
    case "priority":  return priorityRank(task);
    case "task":      return task.name.toLowerCase();
    case "client":    return project.client.toLowerCase() || null;
    case "assignees": return task.assignees.map(a => firstName(a.username)).join(", ").toLowerCase() || null;
    case "due":       return task.due_date ? parseInt(task.due_date) : null;
    case "scheduled": {
      const s = scheduledMap.get(task.id);
      return s ? new Date(s).getTime() : null;
    }
  }
}

function sortRows(rows: TaskRow[], key: SortKey, dir: SortDir, scheduledMap: Map<string, string>): TaskRow[] {
  const sign = dir === "asc" ? 1 : -1;
  // Decorate once rather than recomputing values inside the comparator.
  return rows
    .map((row, i) => ({ row, i, v: sortValue(row, key, scheduledMap) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === "number" && typeof b.v === "number"
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v));
      return c !== 0 ? c * sign : a.i - b.i;   // ties keep their original order
    })
    .map(d => d.row);
}

// ─── Priority ─────────────────────────────────────────────────────────────────

/**
 * ClickUp's flag, in ClickUp's own colour so it reads the same as it does there.
 * Not a RAG signal — the label carries the meaning, the colour only matches ClickUp.
 */
function PriorityFlag({ task }: { task: CUTask }) {
  const p = task.priority;
  if (!p?.priority) return <span style={{ color: C.textSub, fontSize: 11 }}>—</span>;
  const label = p.priority.charAt(0).toUpperCase() + p.priority.slice(1);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: C.textMid, whiteSpace: "nowrap" }}>
      <span style={{ color: p.color || C.textSub, fontSize: 12 }}>⚑</span>
      {label}
    </span>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

/** Badge colours, falling back to neutral for a status STATUS_STYLES doesn't know. */
function statusStyle(status: string) {
  return STATUS_STYLES[status.toLowerCase()]
    ?? { bg: C.alt, color: C.textMid, bd: C.border, label: statusLabel(status) };
}

/**
 * Display form of a status name.
 *
 * ClickUp stores these lower-case ("in progress", "requires ns support") and
 * these lists carry 19 of them, so the raw values make for an unreadable
 * dropdown. STATUS_STYLES supplies a proper label for the seven it knows;
 * everything else is title-cased rather than shown as ClickUp stores it.
 */
function statusLabel(status: string): string {
  const known = STATUS_STYLES[status.toLowerCase()];
  if (known) return known.label;
  return status.replace(/\b[a-z]/g, ch => ch.toUpperCase());
}

function StatusBadge({ status }: { status: string }) {
  const sty = statusStyle(status);
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

// ─── StatusSelect — the badge, editable in place ─────────────────────────────

/**
 * Renders as the same coloured badge, but is a native <select> so the whole
 * cell is the hit target and keyboard/screen-reader behaviour comes for free.
 *
 * Falls back to a read-only badge when the list's statuses haven't loaded (or
 * failed to load): offering an empty dropdown would imply the task cannot be
 * moved, when in fact we just don't know the options yet.
 */
function StatusSelect({
  task,
  statuses,
  saving,
  onChange,
}: {
  task:     CUTask;
  statuses: CUStatus[] | undefined;
  saving:   boolean;
  onChange: (next: string) => void;
}) {
  const current = task.status.status;
  const sty     = statusStyle(current);

  if (!statuses || statuses.length === 0) {
    return <StatusBadge status={current} />;
  }

  // ClickUp is case-insensitive about status names but echoes its own casing.
  // Match case-insensitively so the select doesn't fall to a blank value when
  // the task carries "In Review" and the list defines "in review".
  const match = statuses.find(s => s.status.toLowerCase() === current.toLowerCase());

  return (
    <select
      value={match?.status ?? ""}
      disabled={saving}
      onChange={e => { if (e.target.value) onChange(e.target.value); }}
      title={saving ? "Saving…" : `${current} — change to update ClickUp`}
      style={{
        appearance:   "none",
        WebkitAppearance: "none",
        maxWidth:     "100%",
        fontSize:     10,
        fontWeight:   600,
        fontFamily:   C.font,
        borderRadius: 3,
        padding:      "1px 5px",
        background:   sty.bg,
        color:        sty.color,
        border:       `1px solid ${sty.bd}`,
        cursor:       saving ? "wait" : "pointer",
        opacity:      saving ? 0.55 : 1,
        textOverflow: "ellipsis",
        overflow:     "hidden",
        whiteSpace:   "nowrap",
      }}
    >
      {/* Only reachable if the task's status isn't among the list's — keeps the
          real value visible instead of silently showing a blank control. */}
      {!match && <option value="">{statusLabel(current)}</option>}
      {statuses.map(s => (
        <option key={s.status} value={s.status}>{statusLabel(s.status)}</option>
      ))}
    </select>
  );
}

// ─── Table header ─────────────────────────────────────────────────────────────

const COLUMNS: Array<{ key: SortKey | null; label: string }> = [
  { key: "status",    label: "Status" },
  { key: "priority",  label: "Priority" },
  { key: "task",      label: "Task" },
  { key: "client",    label: "Client" },
  { key: "assignees", label: "Assignees" },
  { key: "due",       label: "Due" },
  { key: "scheduled", label: "Scheduled" },
  { key: null,        label: "Links" },
];

function TableHead({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
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
        {COLUMNS.map(({ key, label }) => {
          if (!key) return <th key={label} style={th}>{label}</th>;
          const active = sortKey === key;
          return (
            <th
              key={label}
              onClick={() => onSort(key)}
              title={`Sort by ${label.toLowerCase()}`}
              aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              style={{ ...th, cursor: "pointer", userSelect: "none", color: active ? C.blue : th.color }}
            >
              {label}
              <span style={{ marginLeft: 4, fontSize: 9, color: active ? C.blue : C.mid }}>
                {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

// ─── Task table row ───────────────────────────────────────────────────────────

function TaskTableRow({
  task,
  project,
  isAlt,
  scheduledAt,
  statuses,
  saving,
  onStatusChange,
  onOpenComments,
}: {
  task: CUTask;
  project: Project;
  isAlt: boolean;
  scheduledAt?: string | null;
  statuses: CUStatus[] | undefined;
  saving: boolean;
  onStatusChange: (task: CUTask, next: string) => void;
  onOpenComments: (task: CUTask) => void;
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
        <StatusSelect
          task={task}
          statuses={statuses}
          saving={saving}
          onChange={next => onStatusChange(task, next)}
        />
      </td>

      {/* Priority */}
      <td style={td}>
        <PriorityFlag task={task} />
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

      {/* Scheduled */}
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {scheduledAt ? (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            fontSize: 10,
            fontWeight: 600,
            borderRadius: 3,
            padding: "1px 5px",
            background: C.greenBg,
            color: C.green,
            border: `1px solid ${C.greenBd}`,
          }}>
            📅 {new Date(scheduledAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
          </span>
        ) : (
          <span style={{ color: C.textSub, fontSize: 11 }}>—</span>
        )}
      </td>

      {/* Links */}
      <td style={td}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button
            onClick={() => onOpenComments(task)}
            title="Read and post ClickUp comments"
            style={{
              fontSize: 10,
              fontWeight: 600,
              fontFamily: C.font,
              borderRadius: 4,
              padding: "1px 5px",
              background: C.alt,
              color: C.textMid,
              border: `1px solid ${C.border}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            💬
          </button>
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
        colSpan={COLUMNS.length}
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
  scheduledMap,
  statusesByList,
  savingTaskId,
  onStatusChange,
  onOpenComments,
}: {
  rows: TaskRow[];
  groupByProject: boolean;
  scheduledMap: Map<string, string>;
  statusesByList: Record<string, CUStatus[]>;
  savingTaskId: string | null;
  onStatusChange: (task: CUTask, next: string) => void;
  onOpenComments: (task: CUTask) => void;
}) {
  // Click a header to sort ascending, again for descending, a third time to go
  // back to the default order (due-date buckets, as the tab defines them).
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const onSort = (key: SortKey) => {
    if (sortKey !== key)     { setSortKey(key); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else                     { setSortKey(null); setSortDir("asc"); }
  };

  const sortedRows = useMemo(
    () => (sortKey ? sortRows(rows, sortKey, sortDir, scheduledMap) : rows),
    [rows, sortKey, sortDir, scheduledMap],
  );

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

  const renderRow = (task: CUTask, project: Project, alt: boolean) => (
    <TaskTableRow
      key={task.id}
      task={task}
      project={project}
      isAlt={alt}
      scheduledAt={scheduledMap.get(task.id)}
      statuses={task.list?.id ? statusesByList[task.list.id] : undefined}
      saving={savingTaskId === task.id}
      onStatusChange={onStatusChange}
      onOpenComments={onOpenComments}
    />
  );

  const buildRows = (): React.ReactNode[] => {
    if (!groupByProject) {
      return sortedRows.map(({ task, project }) => {
        const alt = rowIndex % 2 === 1;
        rowIndex++;
        return renderRow(task, project, alt);
      });
    }

    // Group by project. The group ORDER comes from the unsorted rows, so sorting
    // reorders tasks inside each project rather than shuffling the projects.
    const groups = new Map<number, TaskRow[]>();
    const order: number[] = [];
    for (const row of rows) {
      if (!groups.has(row.project.id)) {
        groups.set(row.project.id, []);
        order.push(row.project.id);
      }
    }
    for (const row of sortedRows) groups.get(row.project.id)!.push(row);

    const result: React.ReactNode[] = [];
    for (const projectId of order) {
      const projectRows = groups.get(projectId)!;
      const projectLabel = projectRows[0].project.client;
      result.push(<GroupHeaderRow key={`grp-${projectId}`} label={projectLabel} />);
      rowIndex = 0;
      for (const { task, project } of projectRows) {
        const alt = rowIndex % 2 === 1;
        rowIndex++;
        result.push(renderRow(task, project, alt));
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
          <col style={{ width: 90 }} />
          <col />
          <col style={{ width: 140 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 85 }} />
          <col style={{ width: 100 }} />
          {/* Links now carries the comments button alongside CU/NS. */}
          <col style={{ width: 140 }} />
        </colgroup>
        <TableHead sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        <tbody>{buildRows()}</tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TaskCommandCenter({ projects, onProjectsChange, initialTab }: Props) {
  const { data: session } = useSession();
  const [tab, setTab]                       = useState<TabId>(initialTab ?? "overdue");

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  // Dropdown order only — a copy, because `projects` drives the rest of this view
  // (and its parent) in go-live order, which the grouped task lists rely on.
  // Client first, then project, so a customer's projects sit together and in a
  // stable order rather than however NetSuite returned them.
  const projectOptions = useMemo(
    () => [...projects].sort((a, b) =>
      a.client.localeCompare(b.client, undefined, { sensitivity: "base" }) ||
      a.projectName.localeCompare(b.projectName, undefined, { sensitivity: "base" })),
    [projects],
  );
  const [selectedResource, setSelectedResource] = useState<string>("");
  const [selectedStatus, setSelectedStatus]   = useState<string>("");
  // "" = all, "none" = no priority set, otherwise ClickUp's orderindex "1"–"4".
  const [selectedPriority, setSelectedPriority] = useState<string>("");
  const [groupByProject, setGroupByProject]   = useState<boolean>(false);
  const [myWork, setMyWork]                   = useState<boolean>(false);
  const [scheduleFilter, setScheduleFilter]   = useState<"all" | "scheduled" | "unscheduled">("all");
  // Map of task_id → scheduled_at ISO string
  const [scheduledMap, setScheduledMap]       = useState<Map<string, string>>(new Map());
  const [slackModalOpen, setSlackModalOpen]   = useState(false);

  // ── ClickUp write state ──
  const [statusesByList, setStatusesByList] = useState<Record<string, CUStatus[]>>({});
  const [savingTaskId,   setSavingTaskId]   = useState<string | null>(null);
  const [actionError,    setActionError]    = useState<string | null>(null);
  const [commentTask,    setCommentTask]    = useState<CUTask | null>(null);

  useEffect(() => {
    fetch("/api/calendar/scheduled")
      .then(r => r.json())
      .then((data: { tasks?: Array<{ task_id: string; scheduled_at: string }> }) => {
        const map = new Map<string, string>();
        for (const t of data.tasks ?? []) {
          map.set(t.task_id, t.scheduled_at);
        }
        setScheduledMap(map);
      })
      .catch(() => {});
  }, [session]);

  // ── Status options per ClickUp list ──
  // Statuses belong to the LIST, not the task, so the inline dropdown needs one
  // lookup per distinct list on screen. Batched into a single request: as
  // separate calls this is a dozen round trips every time the tab opens.
  const listIdsKey = useMemo(
    () => Array.from(new Set(
      projects.flatMap(p => p.tasks.map(t => t.list?.id).filter((id): id is string => !!id)),
    )).sort().join(","),
    [projects],
  );

  useEffect(() => {
    if (!listIdsKey) return;
    let cancelled = false;
    fetch(`/api/clickup/statuses?listIds=${encodeURIComponent(listIdsKey)}`)
      .then(r => r.json())
      .then((d: { statuses?: Record<string, CUStatus[]> }) => {
        // Silent on failure by design: without statuses the dropdown degrades to
        // the read-only badge it has always been, which is not worth a banner.
        if (!cancelled && d.statuses) setStatusesByList(d.statuses);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [listIdsKey]);

  /**
   * Write one task's status into the in-memory Project graph.
   *
   * Re-derives blocked / clientPending / milestones / pct from the updated task
   * list via the same helper /api/projects uses, so a task moved out of "On Hold"
   * here also leaves Portfolio's Blocked KPI — those are stored arrays, not live
   * predicates, and would otherwise stay stale until the next Refresh Data.
   */
  const applyStatus = useCallback((taskId: string, status: string) => {
    onProjectsChange(prev => prev.map(p => {
      if (!p.tasks.some(t => t.id === taskId)) return p;
      const tasks = p.tasks.map(t =>
        t.id === taskId ? { ...t, status: { ...t.status, status } } : t,
      );
      return { ...p, tasks, ...deriveTaskRollup(tasks) };
    }));
  }, [onProjectsChange]);

  const changeStatus = useCallback(async (task: CUTask, next: string) => {
    const previous = task.status.status;
    // Case-insensitive: lists spell the same status differently from the task
    // ("Closed" vs "closed"), and an exact compare would fire a pointless write
    // when the PM reselects the status the task is already in.
    if (next.toLowerCase() === previous.toLowerCase()) return;

    setSavingTaskId(task.id);
    setActionError(null);
    applyStatus(task.id, next);   // optimistic — the row re-buckets immediately

    try {
      const res = await fetch("/api/clickup/task-status", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ taskId: task.id, status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);

      // Render what ClickUp reports, not what we asked for — a list automation
      // can land the task somewhere else entirely.
      if (data.status && data.status !== next) applyStatus(task.id, data.status);
    } catch (e) {
      applyStatus(task.id, previous);
      setActionError(
        `Could not move "${task.name}" to ${next}: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setSavingTaskId(null);
    }
  }, [applyStatus]);

  const visibleProjects = selectedProject
    ? projects.filter(p => p.id === selectedProject)
    : projects;

  const sessionName = session?.user?.name ?? "";

  const allRows: TaskRow[] = visibleProjects.flatMap(p =>
    p.tasks
      .filter(t => !selectedResource || t.assignees.some(a => a.username === selectedResource))
      // Case-insensitive: the same status is spelled differently across lists
      // ("In Review" / "in review"), and an exact match would silently split one
      // status into two half-empty filter entries.
      .filter(t => !selectedStatus || t.status.status.toLowerCase() === selectedStatus)
      .filter(t => !selectedPriority || String(priorityRank(t) ?? "none") === selectedPriority)
      .filter(t => !myWork || !sessionName || t.assignees.some(a =>
        a.username.toLowerCase() === sessionName.toLowerCase()
      ))
      .filter(t => {
        if (scheduleFilter === "scheduled")   return scheduledMap.has(t.id);
        if (scheduleFilter === "unscheduled") return !scheduledMap.has(t.id);
        return true;
      })
      .map(t => ({ task: t, project: p }))
  );

  const allResources = Array.from(new Set(
    projects.flatMap(p => p.tasks.flatMap(t => t.assignees.map(a => a.username)))
  )).sort();

  /**
   * Statuses actually present on the loaded tasks, keyed lower-case with the
   * first-seen spelling kept for display.
   *
   * Deliberately built from the tasks rather than from `statusesByList`: a list
   * can define a dozen statuses nothing currently sits in, and offering those
   * fills the filter with options that can only ever return zero rows.
   */
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of projects) {
      for (const t of p.tasks) {
        const key = t.status.status.toLowerCase();
        if (key && !seen.has(key)) seen.set(key, t.status.status);
      }
    }
    return Array.from(seen.entries())
      .map(([key, raw]) => ({ key, label: statusLabel(raw) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [projects]);

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
            {/* `label` is already "Customer — Project Name". Showing the client
                alone made the several projects a customer can have at once
                indistinguishable in this list. */}
            {projectOptions.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
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

        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Status</label>
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            {statusOptions.map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Priority</label>
          <select
            value={selectedPriority}
            onChange={e => setSelectedPriority(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            {PRIORITY_OPTIONS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Schedule</label>
          <select
            value={scheduleFilter}
            onChange={e => setScheduleFilter(e.target.value as "all" | "scheduled" | "unscheduled")}
            style={selectStyle}
          >
            <option value="all">All</option>
            <option value="scheduled">Scheduled</option>
            <option value="unscheduled">Unscheduled</option>
          </select>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: myWork ? C.blue : C.textMid, cursor: "pointer", userSelect: "none", fontWeight: myWork ? 700 : 400 }}>
          <input
            type="checkbox"
            checked={myWork}
            onChange={e => setMyWork(e.target.checked)}
            style={{ cursor: "pointer", accentColor: C.blue }}
          />
          My Work
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={groupByProject}
            onChange={e => setGroupByProject(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Group by Project
        </label>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: C.textSub }}>
            {totalDone} / {allRows.length} done
          </span>
          <button
            onClick={() => setSlackModalOpen(true)}
            title="Prepend current view to Weekly Deliverables canvas in #oxide"
            style={{
              display:      "flex",
              alignItems:   "center",
              gap:          5,
              padding:      "4px 11px",
              fontSize:     12,
              fontWeight:   700,
              borderRadius: 5,
              border:       `1px solid #3CB371`,
              background:   "#E8F8EE",
              color:        "#1A7A45",
              cursor:       "pointer",
              fontFamily:   C.font,
              whiteSpace:   "nowrap",
            }}
          >
            ↗ Post to Slack
          </button>
        </div>
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

      {/* ── Status write error ── */}
      {/* Sits above the table because the row it refers to has already reverted
          to its old status — without this the click just appears to do nothing. */}
      {actionError && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          background: C.redBg,
          border: `1px solid ${C.redBd}`,
          borderTop: "none",
          padding: "9px 12px",
          fontSize: 12,
          color: C.red,
        }}>
          <span style={{ flex: 1 }}>⚠ {actionError}</span>
          <button
            onClick={() => setActionError(null)}
            style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderTop: "none",
        borderRadius: "0 0 8px 8px",
        overflow: "hidden",
        boxShadow: C.sh,
      }}>
        <TaskTable
          rows={activeRows}
          groupByProject={groupByProject}
          scheduledMap={scheduledMap}
          statusesByList={statusesByList}
          savingTaskId={savingTaskId}
          onStatusChange={changeStatus}
          onOpenComments={setCommentTask}
        />
      </div>

      {/* ── ClickUp comments ── */}
      {commentTask && (
        <TaskCommentsModal
          taskId={commentTask.id}
          taskName={commentTask.name}
          taskUrl={commentTask.url}
          onClose={() => setCommentTask(null)}
        />
      )}

      {/* ── Post to Slack modal ── */}
      {slackModalOpen && (
        <PostToSlackModal
          rows={activeRows}
          tabLabel={TAB_DEFS.find(t => t.id === tab)?.label ?? tab}
          projectLabel={
            selectedProject
              ? (projects.find(p => p.id === selectedProject)?.client ?? "Selected Project")
              : "All Projects"
          }
          canvasId={
            selectedProject
              ? (projects.find(p => p.id === selectedProject)?.slackCanvasId ?? null)
              : null
          }
          onClose={() => setSlackModalOpen(false)}
        />
      )}

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
