"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { C, STATUS_STYLES } from "@/lib/constants";
import { LinkBtn } from "@/components/ui/LinkBtn";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { isBlocked, isClientPending, isMilestone, isDone, taskBucket, startOfToday, deriveTaskRollup, type CUStatus } from "@/lib/clickup";
import { PostToSlackModal } from "@/components/dashboard/PostToSlackModal";
import { DeliverablesReportModal } from "@/components/dashboard/DeliverablesReportModal";
import { TaskCommentsModal } from "@/components/dashboard/TaskCommentsModal";
import { TaskDescriptionModal, taskDescription } from "@/components/dashboard/TaskDescriptionModal";
import { TaskCasesTable, isOpenCase, samePerson, caseMatchesProject, casePriorityRank, type TaskCase } from "@/components/dashboard/TaskCases";
import type { Project, CUTask, ProjectNote } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "overdue" | "this_week" | "next_week" | "upcoming" | "milestones" | "blocked" | "client" | "cases";

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
  /** NetSuite support cases (the page's /api/cases load) for the Cases sub-tab. */
  cases?: TaskCase[];
  casesError?: string | null;
}

interface TaskRow {
  task: CUTask;
  project: Project;
}

/** An inline priority / due-date edit. Omitted = unchanged, null = clear. */
interface TaskFieldsPatch {
  name?:     string;
  priority?: number | null;
  dueDate?:  number | null;
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
  // NetSuite support cases, not ClickUp tasks — filterForTab returns none for it.
  { id: "cases",      label: "Cases",      icon: "🎫" },
];

/** Case priority filter — NetSuite's three, matched on casePriorityRank. */
const CASE_PRIORITY_OPTIONS = [
  { value: "1",    label: "High" },
  { value: "2",    label: "Medium" },
  { value: "3",    label: "Low" },
  { value: "none", label: "No priority" },
];

/** Lists per /api/clickup/statuses request (the route caps at 40). */
const STATUS_LISTS_PER_REQUEST = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The timeline sub-tab a task sits under, by due date. taskBucket never calls a
 * done task overdue (right for the overdue badge), which would drop every
 * past-due done task into This Week; with "Show Done" ticked it belongs under
 * Overdue, where its due date puts it.
 */
function timelineBucket(task: CUTask) {
  if (isDone(task) && task.due_date && parseInt(task.due_date) < startOfToday()) return "overdue";
  return taskBucket(task);
}

/** Done tasks are hidden on every sub-tab unless the "Show Done" box is ticked. */
function filterForTab(rows: TaskRow[], tabId: TabId, showDone: boolean): TaskRow[] {
  const shown = (task: CUTask) => showDone || !isDone(task);
  switch (tabId) {
    case "overdue":
      return rows.filter(({ task }) => timelineBucket(task) === "overdue" && shown(task));
    case "this_week":
      return rows.filter(({ task }) => timelineBucket(task) === "this_week" && shown(task));
    case "next_week":
      return rows.filter(({ task }) => timelineBucket(task) === "next_week" && shown(task));
    case "upcoming":
      return rows.filter(({ task }) => timelineBucket(task) === "upcoming" && shown(task));
    case "milestones":
      return rows.filter(({ task }) => isMilestone(task) && shown(task));
    case "blocked":
      return rows.filter(({ task }) => isBlocked(task) && shown(task));
    case "client":
      return rows.filter(({ task }) => isClientPending(task) && shown(task));
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

/** The table's order until a header is clicked (and after a third click). */
const DEFAULT_SORT_KEY: SortKey = "priority";

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
 * ClickUp's four priorities as its API writes them back — used to update the row
 * optimistically before the response lands. Colours are ClickUp's defaults, so
 * the flag reads as it does there; not a RAG signal — the label carries meaning.
 */
const CU_PRIORITIES: Record<number, NonNullable<CUTask["priority"]>> = {
  1: { id: "1", priority: "urgent", color: "#f50000", orderindex: "1" },
  2: { id: "2", priority: "high",   color: "#f8ae00", orderindex: "2" },
  3: { id: "3", priority: "normal", color: "#6fddff", orderindex: "3" },
  4: { id: "4", priority: "low",    color: "#d8d8d8", orderindex: "4" },
};

/** The flag, editable in place: a native <select> styled as the flag and label. */
function PrioritySelect({
  task,
  saving,
  onChange,
}: {
  task: CUTask;
  saving: boolean;
  onChange: (next: number | null) => void;
}) {
  const rank = priorityRank(task);
  const p    = task.priority;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" }}>
      <span style={{ color: p?.color || C.mid, fontSize: 12 }}>⚑</span>
      <select
        value={rank ?? ""}
        disabled={saving}
        onChange={e => onChange(e.target.value ? parseInt(e.target.value) : null)}
        title={saving ? "Saving…" : "Change priority in ClickUp"}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          border: "1px solid transparent",
          borderRadius: 3,
          background: "transparent",
          padding: "1px 3px",
          fontSize: 11,
          fontFamily: C.font,
          color: rank ? C.textMid : C.textSub,
          cursor: saving ? "wait" : "pointer",
          opacity: saving ? 0.55 : 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.border; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; }}
      >
        <option value="">—</option>
        {PRIORITY_OPTIONS.filter(o => o.value !== "none").map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </span>
  );
}

// ─── Due date ─────────────────────────────────────────────────────────────────

function pad2(n: number): string { return String(n).padStart(2, "0"); }

/** Unix-ms string → local "YYYY-MM-DD" for <input type="date">. Local, never toISOString. */
function dueInputValue(dueDateMs: string | null): string {
  if (!dueDateMs) return "";
  const d = new Date(parseInt(dueDateMs));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Local "YYYY-MM-DD" → Unix ms at local NOON. Noon rather than midnight so the
 * date reads the same in ClickUp for anyone within ±11h of the person who set it.
 */
function dueFromInput(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12).getTime();
}

/**
 * The due date, editable in place. Shows the short date as before; clicking it
 * opens the browser's date picker. Clearing the picker removes the due date.
 */
function DueDateInput({
  task,
  saving,
  overdue,
  onChange,
}: {
  task: CUTask;
  saving: boolean;
  overdue: boolean;
  onChange: (next: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const color = overdue ? C.red : C.textMid;

  if (!editing) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => setEditing(true)}
        title={saving ? "Saving…" : "Change due date in ClickUp"}
        style={{
          background: "none",
          border: "1px solid transparent",
          borderRadius: 3,
          padding: "1px 4px",
          margin: "0 -4px",
          fontSize: 12,
          fontFamily: C.font,
          fontWeight: overdue ? 600 : 400,
          color,
          cursor: saving ? "wait" : "pointer",
          opacity: saving ? 0.55 : 1,
          whiteSpace: "nowrap",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.border; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; }}
      >
        {formatDue(task.due_date)}
      </button>
    );
  }

  const current = dueInputValue(task.due_date);
  // Commit on blur rather than on every change: typing a date into the field
  // fires change events for each partial value, and each would be a ClickUp write.
  return (
    <input
      type="date"
      autoFocus
      defaultValue={current}
      onBlur={e => {
        setEditing(false);
        const v = e.target.value;
        if (v === current) return;
        onChange(v ? dueFromInput(v) : null);
      }}
      onKeyDown={e => {
        if (e.key === "Enter")  e.currentTarget.blur();
        if (e.key === "Escape") { e.currentTarget.value = current; e.currentTarget.blur(); }
      }}
      style={{
        fontSize: 11,
        fontFamily: C.font,
        padding: "1px 3px",
        border: `1px solid ${C.blue}`,
        borderRadius: 3,
        color: C.text,
        background: C.surface,
      }}
    />
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
  onFieldChange,
  onOpenComments,
  onOpenDescription,
}: {
  task: CUTask;
  project: Project;
  isAlt: boolean;
  scheduledAt?: string | null;
  statuses: CUStatus[] | undefined;
  saving: boolean;
  onStatusChange: (task: CUTask, next: string) => void;
  onFieldChange: (task: CUTask, fields: TaskFieldsPatch) => void;
  onOpenComments: (task: CUTask) => void;
  onOpenDescription: (task: CUTask) => void;
}) {
  const [hovered, setHovered] = useState(false);
  // Inline title edit: ✏️ opens an input; Enter or leaving the field saves,
  // Esc cancels. An unchanged or blank title writes nothing.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft]     = useState(task.name);

  const startEditName = () => { setNameDraft(task.name); setEditingName(true); };
  const commitName = () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next && next !== task.name) onFieldChange(task, { name: next });
  };

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
        <PrioritySelect
          task={task}
          saving={saving}
          onChange={priority => onFieldChange(task, { priority })}
        />
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
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === "Enter")  { e.preventDefault(); commitName(); }
                if (e.key === "Escape") { e.preventDefault(); setEditingName(false); }
              }}
              style={{
                flex: 1, minWidth: 0, fontSize: 12, fontFamily: C.font,
                padding: "2px 6px", borderRadius: 4,
                border: `1px solid ${C.blueBd}`, outline: "none", color: C.text,
              }}
            />
          ) : (
            <>
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
              <button
                onClick={startEditName}
                disabled={saving}
                title="Edit the task title"
                aria-label="Edit title"
                style={{
                  flexShrink: 0, background: "none", border: "none", padding: "0 2px",
                  fontSize: 11, lineHeight: 1, cursor: saving ? "not-allowed" : "pointer",
                  opacity: hovered ? 0.8 : 0.35,
                }}
              >
                ✏️
              </button>
            </>
          )}
          {/* Only on tasks that have one — an icon that opens "no description"
              on most rows would teach people to stop clicking it. */}
          {taskDescription(task) && (
            <button
              onClick={() => onOpenDescription(task)}
              title="View the ClickUp description"
              aria-label="View description"
              style={{
                flexShrink: 0, background: "none", border: "none", padding: "0 2px",
                fontSize: 12, lineHeight: 1, cursor: "pointer", opacity: 0.75,
              }}
            >
              📝
            </button>
          )}
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
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <DueDateInput
          task={task}
          saving={saving}
          overdue={taskBucket(task) === "overdue" && !done}
          onChange={dueDate => onFieldChange(task, { dueDate })}
        />
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
  onFieldChange,
  onOpenComments,
  onOpenDescription,
}: {
  rows: TaskRow[];
  groupByProject: boolean;
  scheduledMap: Map<string, string>;
  statusesByList: Record<string, CUStatus[]>;
  savingTaskId: string | null;
  onStatusChange: (task: CUTask, next: string) => void;
  onFieldChange: (task: CUTask, fields: TaskFieldsPatch) => void;
  onOpenComments: (task: CUTask) => void;
  onOpenDescription: (task: CUTask) => void;
}) {
  // Default: priority, Urgent first, no-priority last. Click a header to sort
  // ascending, again for descending, a third time to go back to the default.
  const [sortKey, setSortKey] = useState<SortKey | null>(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const onSort = (key: SortKey) => {
    if (sortKey !== key)     { setSortKey(key); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else                     { setSortKey(DEFAULT_SORT_KEY); setSortDir("asc"); }
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
      onFieldChange={onFieldChange}
      onOpenComments={onOpenComments}
      onOpenDescription={onOpenDescription}
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

export function TaskCommandCenter({ projects, onProjectsChange, initialTab, cases = [], casesError = null }: Props) {
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
  const [showDone, setShowDone]               = useState(false);
  // "" = all, "none" = no priority set, otherwise ClickUp's orderindex "1"–"4".
  const [selectedPriority, setSelectedPriority] = useState<string>("");
  // Cases have their own status/priority vocabularies, so the Status and Priority
  // dropdowns switch to these while the Cases sub-tab is open.
  const [caseStatus, setCaseStatus]           = useState<string>("");
  const [casePriority, setCasePriority]       = useState<string>("");
  const [groupByProject, setGroupByProject]   = useState<boolean>(false);
  const [myWork, setMyWork]                   = useState<boolean>(false);
  const [scheduleFilter, setScheduleFilter]   = useState<"all" | "scheduled" | "unscheduled">("all");
  // Map of task_id → scheduled_at ISO string
  const [scheduledMap, setScheduledMap]       = useState<Map<string, string>>(new Map());
  const [slackModalOpen, setSlackModalOpen]   = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  // ── ClickUp write state ──
  const [statusesByList, setStatusesByList] = useState<Record<string, CUStatus[]>>({});
  const [savingTaskId,   setSavingTaskId]   = useState<string | null>(null);
  const [actionError,    setActionError]    = useState<string | null>(null);
  const [commentTask,    setCommentTask]    = useState<CUTask | null>(null);
  const [descTask,       setDescTask]       = useState<CUTask | null>(null);

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

    // Small chunks, so one slow or rate-limited batch can't time out the whole
    // lookup (and the route's MAX_LISTS cap can never drop lists). Failed lists
    // are retried once; until then the cell uses statusesSeenByList below.
    const fetchChunk = (ids: string[]) =>
      fetch(`/api/clickup/statuses?listIds=${encodeURIComponent(ids.join(","))}`)
        .then(r => r.json())
        .then((d: { statuses?: Record<string, CUStatus[]>; failed?: Record<string, string>; error?: string }) => {
          if (d.error) throw new Error(d.error);
          if (!cancelled && d.statuses && Object.keys(d.statuses).length) {
            setStatusesByList(prev => ({ ...prev, ...d.statuses }));
          }
          return Object.keys(d.failed ?? {});
        })
        .catch(e => { console.warn("[Tasks] list statuses request failed:", e); return ids; });

    const ids = listIdsKey.split(",");
    (async () => {
      let failed: string[] = [];
      for (let i = 0; i < ids.length && !cancelled; i += STATUS_LISTS_PER_REQUEST) {
        failed = failed.concat(await fetchChunk(ids.slice(i, i + STATUS_LISTS_PER_REQUEST)));
      }
      if (!failed.length || cancelled) return;
      await new Promise(r => setTimeout(r, 3000));
      if (cancelled) return;
      const still = await fetchChunk(failed);
      if (still.length) console.warn("[Tasks] statuses unavailable for lists (using statuses seen on tasks):", still);
    })();
    return () => { cancelled = true; };
  }, [listIdsKey]);

  /**
   * Fallback status options per list: the statuses its loaded tasks are in.
   *
   * Incomplete — a list status nothing currently sits in won't be offered — but
   * it keeps the Status cell editable when ClickUp's list lookup fails, rather
   * than dropping to a read-only badge (which is what kept happening). Replaced
   * by the full list as soon as the lookup succeeds.
   */
  const statusesSeenByList = useMemo(() => {
    const out: Record<string, CUStatus[]> = {};
    for (const p of projects) {
      for (const t of p.tasks) {
        const listId = t.list?.id;
        const name   = t.status?.status;
        if (!listId || !name) continue;
        const arr = (out[listId] ??= []);
        if (!arr.some(s => s.status.toLowerCase() === name.toLowerCase())) {
          arr.push({ status: name, color: t.status.color ?? "", orderindex: arr.length, type: "custom" });
        }
      }
    }
    return out;
  }, [projects]);

  const statusOptionsByList = useMemo(
    () => ({ ...statusesSeenByList, ...statusesByList }),
    [statusesSeenByList, statusesByList],
  );

  /**
   * Write one task's status into the in-memory Project graph.
   *
   * Re-derives blocked / clientPending / milestones / pct from the updated task
   * list via the same helper /api/projects uses, so a task moved out of "On Hold"
   * here also leaves Portfolio's Blocked KPI — those are stored arrays, not live
   * predicates, and would otherwise stay stale until the next Refresh Data.
   */
  const applyTask = useCallback((taskId: string, update: (t: CUTask) => CUTask) => {
    onProjectsChange(prev => prev.map(p => {
      if (!p.tasks.some(t => t.id === taskId)) return p;
      const tasks = p.tasks.map(t => (t.id === taskId ? update(t) : t));
      return { ...p, tasks, ...deriveTaskRollup(tasks) };
    }));
  }, [onProjectsChange]);

  const applyStatus = useCallback((taskId: string, status: string) => {
    applyTask(taskId, t => ({ ...t, status: { ...t.status, status } }));
  }, [applyTask]);

  /**
   * Inline priority / due-date edit. Same shape as changeStatus: optimistic, then
   * whatever ClickUp reports back, reverting with a banner on failure. A new due
   * date re-buckets the row immediately (it may move to another sub-tab).
   */
  const changeFields = useCallback(async (task: CUTask, fields: TaskFieldsPatch) => {
    const previous = { name: task.name, priority: task.priority ?? null, due_date: task.due_date };
    const optimistic: Partial<CUTask> = {};
    if (fields.name     !== undefined) optimistic.name = fields.name;
    if (fields.priority !== undefined) optimistic.priority = fields.priority ? CU_PRIORITIES[fields.priority] : null;
    if (fields.dueDate  !== undefined) optimistic.due_date = fields.dueDate != null ? String(fields.dueDate) : null;

    setSavingTaskId(task.id);
    setActionError(null);
    applyTask(task.id, t => ({ ...t, ...optimistic }));

    try {
      const res = await fetch("/api/clickup/task-fields", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ taskId: task.id, ...fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);

      const landed: Partial<CUTask> = {};
      if (fields.name     !== undefined && data.name) landed.name = data.name;
      if (fields.priority !== undefined) landed.priority = data.priority ?? null;
      if (fields.dueDate  !== undefined) landed.due_date = data.due_date ?? null;
      applyTask(task.id, t => ({ ...t, ...landed }));
    } catch (e) {
      applyTask(task.id, t => ({ ...t, ...previous }));
      const what = fields.name !== undefined ? "title"
        : fields.priority !== undefined ? "priority" : "due date";
      setActionError(
        `Could not change the ${what} of "${task.name}": ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setSavingTaskId(null);
    }
  }, [applyTask]);

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

  const openCases = useMemo(() => cases.filter(isOpenCase), [cases]);

  // ── Cases sub-tab rows ──
  // The shared filters apply here too: picking a resource shows their ClickUp
  // tasks on the other sub-tabs and their NetSuite cases on this one. Names are
  // matched with samePerson because the two systems spell people separately.
  const caseRows: TaskCase[] = openCases
    .filter(c => !selectedProject || visibleProjects.some(p => caseMatchesProject(c, p)))
    .filter(c => !selectedResource || samePerson(c.assigned, selectedResource))
    .filter(c => !caseStatus || c.status.toLowerCase() === caseStatus)
    .filter(c => !casePriority || String(casePriorityRank(c.priority) ?? "none") === casePriority)
    .filter(c => !myWork || !sessionName || samePerson(c.assigned, sessionName));

  const caseStatusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of openCases) {
      const key = c.status.toLowerCase();
      if (key && !seen.has(key)) seen.set(key, c.status);
    }
    return Array.from(seen.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [openCases]);

  // ClickUp assignees plus anyone who only holds cases (e.g. a support consultant
  // with no ClickUp tasks). A case assignee who IS a ClickUp user is not listed
  // twice — the ClickUp spelling wins, and matches their cases via samePerson.
  const allResources = useMemo(() => {
    const names = Array.from(new Set(
      projects.flatMap(p => p.tasks.flatMap(t => t.assignees.map(a => a.username)))
    ));
    for (const c of openCases) {
      if (!c.assigned || c.assigned === "Unassigned") continue;
      if (!names.some(n => samePerson(n, c.assigned))) names.push(c.assigned);
    }
    return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [projects, openCases]);

  const onCasesTab = tab === "cases";

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
        // Done tasks are shown via the "Show Done" box, not this filter.
        if (isDone(t)) continue;
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
    overdue:    filterForTab(allRows, "overdue", showDone).length,
    this_week:  filterForTab(allRows, "this_week", showDone).length,
    next_week:  filterForTab(allRows, "next_week", showDone).length,
    upcoming:   filterForTab(allRows, "upcoming", showDone).length,
    milestones: filterForTab(allRows, "milestones", showDone).length,
    blocked:    filterForTab(allRows, "blocked", showDone).length,
    client:     filterForTab(allRows, "client", showDone).length,
    cases:      caseRows.length,
  };

  const activeRows = filterForTab(allRows, tab, showDone);

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
            value={onCasesTab ? caseStatus : selectedStatus}
            onChange={e => (onCasesTab ? setCaseStatus : setSelectedStatus)(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            {(onCasesTab ? caseStatusOptions : statusOptions).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={labelStyle}>Priority</label>
          <select
            value={onCasesTab ? casePriority : selectedPriority}
            onChange={e => (onCasesTab ? setCasePriority : setSelectedPriority)(e.target.value)}
            style={selectStyle}
          >
            <option value="">All</option>
            {(onCasesTab ? CASE_PRIORITY_OPTIONS : PRIORITY_OPTIONS).map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Calendar scheduling and project grouping are ClickUp-task concepts. */}
        {!onCasesTab && <div style={{ display: "flex", alignItems: "center" }}>
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
        </div>}

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: myWork ? C.blue : C.textMid, cursor: "pointer", userSelect: "none", fontWeight: myWork ? 700 : 400 }}>
          <input
            type="checkbox"
            checked={myWork}
            onChange={e => setMyWork(e.target.checked)}
            style={{ cursor: "pointer", accentColor: C.blue }}
          />
          My Work
        </label>

        {!onCasesTab && <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={groupByProject}
            onChange={e => setGroupByProject(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Group by Project
        </label>}

        {!onCasesTab && <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={showDone}
            onChange={e => setShowDone(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Show Done
        </label>}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: C.textSub }}>
            {onCasesTab
              ? `${caseRows.length} open case${caseRows.length === 1 ? "" : "s"}`
              : `${totalDone} / ${allRows.length} done`}
          </span>
          {!onCasesTab && <button
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
            ↗ Post Open Deliverables to Slack
          </button>}
          {!onCasesTab && <button
            onClick={() => setReportModalOpen(true)}
            disabled={!selectedProject}
            title={selectedProject
              ? "Post this week's done and pending deliverables to the project's Slack channel"
              : "Pick a project first — the report goes to that project's Slack channel"}
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
              cursor:       selectedProject ? "pointer" : "not-allowed",
              opacity:      selectedProject ? 1 : 0.5,
              fontFamily:   C.font,
              whiteSpace:   "nowrap",
            }}
          >
            ↗ Post Deliverables Week End Report
          </button>}
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
        {onCasesTab ? (
          <TaskCasesTable cases={caseRows} error={casesError} />
        ) : (
          <TaskTable
            rows={activeRows}
            groupByProject={groupByProject}
            scheduledMap={scheduledMap}
            statusesByList={statusOptionsByList}
            savingTaskId={savingTaskId}
            onStatusChange={changeStatus}
            onFieldChange={changeFields}
            onOpenComments={setCommentTask}
            onOpenDescription={setDescTask}
          />
        )}
      </div>

      {/* ── ClickUp description ── */}
      {descTask && (
        <TaskDescriptionModal task={descTask} onClose={() => setDescTask(null)} />
      )}

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

      {/* ── Deliverables week-end report modal ── */}
      {reportModalOpen && selectedProject && (() => {
        const proj = projects.find(p => p.id === selectedProject);
        if (!proj) return null;
        // Exactly the rows on screen: the selected section under the current
        // filters, so done tasks only appear when "Show Done" is ticked.
        const sectionTasks = activeRows
          .filter(r => r.project.id === proj.id)
          .map(r => r.task);
        return (
          <DeliverablesReportModal
            project={proj}
            tasks={sectionTasks}
            sectionLabel={TAB_DEFS.find(t => t.id === tab)?.label ?? tab}
            onClose={() => setReportModalOpen(false)}
          />
        );
      })()}

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
