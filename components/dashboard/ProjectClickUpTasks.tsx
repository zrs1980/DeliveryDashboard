"use client";
// ─── ClickUp tasks for one project ────────────────────────────────────────────
// Renders from the Project the dashboard already holds — /api/projects fetches
// ClickUp tasks per project on refresh, so this needs no request of its own.

import { useMemo, useState } from "react";
import { C, STATUS_STYLES } from "@/lib/constants";
import { isBlocked, isClientPending, isDone, isMilestone, isOverdueTask, taskBucket, type Bucket } from "@/lib/clickup";
import type { CUTask, Project } from "@/lib/types";

const BUCKET_LABEL: Record<Bucket, string> = {
  overdue:   "⚠ Overdue",
  this_week: "This week",
  next_week: "Next week",
  upcoming:  "Upcoming",
  no_date:   "No due date",
};
const BUCKET_ORDER: Bucket[] = ["overdue", "this_week", "next_week", "upcoming", "no_date"];

type GroupBy = "due" | "status" | "assignee";

const fmtDue = (ms: string | null) => {
  if (!ms) return "—";
  const d = new Date(parseInt(ms));
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "2-digit" });
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status.toLowerCase()] ?? { bg: C.alt, color: C.textMid, bd: C.border, label: status };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: s.bg, color: s.color, border: `1px solid ${s.bd}`, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

/** The flag filters. Independent toggles, ANDed — "blocked AND client" is a real question. */
interface Flags { blocked: boolean; client: boolean; milestone: boolean; overdue: boolean }
const NO_FLAGS: Flags = { blocked: false, client: false, milestone: false, overdue: false };

export function ProjectClickUpTasks({ project }: { project: Project }) {
  const [search, setSearch]     = useState("");
  const [openOnly, setOpen]     = useState(true);
  const [groupBy, setGroupBy]   = useState<GroupBy>("due");
  const [status, setStatus]     = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [bucket, setBucket]     = useState<"all" | Bucket>("all");
  const [flags, setFlags]       = useState<Flags>(NO_FLAGS);

  const tasks = project.tasks ?? [];

  // Options come from the tasks actually present, so the dropdowns never offer a
  // status or person this project doesn't have.
  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) counts.set(t.status.status, (counts.get(t.status.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const assigneeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      if (t.assignees.length === 0) counts.set("__unassigned", (counts.get("__unassigned") ?? 0) + 1);
      for (const a of t.assignees) counts.set(a.username, (counts.get(a.username) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const stats = useMemo(() => ({
    total:     tasks.length,
    done:      tasks.filter(isDone).length,
    blocked:   tasks.filter(isBlocked).length,
    client:    tasks.filter(t => isClientPending(t) && !isDone(t)).length,
    milestone: tasks.filter(isMilestone).length,
    overdue:   tasks.filter(isOverdueTask).length,
  }), [tasks]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return tasks.filter(t => {
      if (openOnly && isDone(t)) return false;
      if (status !== "all" && t.status.status !== status) return false;
      if (assignee !== "all") {
        const match = assignee === "__unassigned"
          ? t.assignees.length === 0
          : t.assignees.some(a => a.username === assignee);
        if (!match) return false;
      }
      if (bucket !== "all" && taskBucket(t) !== bucket) return false;
      if (flags.blocked   && !isBlocked(t)) return false;
      if (flags.client    && !(isClientPending(t) && !isDone(t))) return false;
      if (flags.milestone && !isMilestone(t)) return false;
      if (flags.overdue   && !isOverdueTask(t)) return false;
      if (q && !(
        t.name.toLowerCase().includes(q) ||
        t.status.status.toLowerCase().includes(q) ||
        t.assignees.some(a => a.username.toLowerCase().includes(q))
      )) return false;
      return true;
    });
  }, [tasks, search, openOnly, status, assignee, bucket, flags]);

  const anyFilter = !openOnly || !!search || status !== "all" || assignee !== "all" ||
    bucket !== "all" || Object.values(flags).some(Boolean);

  const clearAll = () => {
    setSearch(""); setOpen(true); setStatus("all"); setAssignee("all");
    setBucket("all"); setFlags(NO_FLAGS);
  };

  const groups = useMemo(() => {
    const map = new Map<string, CUTask[]>();
    for (const t of filtered) {
      let key: string;
      if (groupBy === "due")        key = taskBucket(t);
      else if (groupBy === "status") key = t.status.status;
      else key = t.assignees.length ? t.assignees.map(a => a.username).join(", ") : "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }

    const entries = [...map.entries()];
    if (groupBy === "due") {
      // Chronological, not alphabetical — overdue first is the whole point.
      entries.sort((a, b) => BUCKET_ORDER.indexOf(a[0] as Bucket) - BUCKET_ORDER.indexOf(b[0] as Bucket));
    } else {
      entries.sort((a, b) => b[1].length - a[1].length);
    }
    // Inside a group, soonest due first with undated last.
    for (const [, list] of entries) {
      list.sort((a, b) => (a.due_date ? parseInt(a.due_date) : Infinity) - (b.due_date ? parseInt(b.due_date) : Infinity));
    }
    return entries;
  }, [filtered, groupBy]);

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
    fontSize: 12, fontFamily: C.font, color: C.text, background: C.surface, outline: "none",
  };

  if (project.clickupError) {
    return (
      <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: "14px 18px", color: C.red, fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ ClickUp tasks could not be loaded</div>
        {project.clickupError}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "44px 12px", color: C.textSub }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🗂️</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>No ClickUp tasks for this project</div>
        <div style={{ fontSize: 12.5, maxWidth: 460, margin: "0 auto", lineHeight: 1.6 }}>
          {project.clickupUrl
            ? "The linked ClickUp list returned no tasks. Check the list still exists and that custentity20 points at the right one."
            : <>No ClickUp list is linked. Set <strong>custentity20</strong> on the NetSuite project to the project&apos;s ClickUp list URL, then refresh.</>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: C.font }}>
      {/* Counters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { label: "Tasks",      value: stats.total,     color: C.blue },
          { label: "Done",       value: stats.done,      color: C.green },
          { label: "⚠ Blocked",  value: stats.blocked,   color: stats.blocked ? C.red : C.textSub },
          { label: "👤 Client",  value: stats.client,    color: stats.client ? C.orange : C.textSub },
          { label: "★ Milestones", value: stats.milestone, color: C.purple },
          { label: "Overdue",    value: stats.overdue,   color: stats.overdue ? C.red : C.textSub },
        ].map(k => (
          <div key={k.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 16px", boxShadow: C.sh, flex: "1 1 0", minWidth: 105 }}>
            <div style={{ fontFamily: C.mono, fontSize: 19, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 9, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search tasks, status or assignee…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle, cursor: "pointer", maxWidth: 210 }}>
          <option value="all">All statuses</option>
          {statusOptions.map(([s, n]) => (
            <option key={s} value={s}>{STATUS_STYLES[s.toLowerCase()]?.label ?? s} ({n})</option>
          ))}
        </select>
        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ ...inputStyle, cursor: "pointer", maxWidth: 200 }}>
          <option value="all">All assignees</option>
          {assigneeOptions.map(([a, n]) => (
            <option key={a} value={a}>{a === "__unassigned" ? "Unassigned" : a} ({n})</option>
          ))}
        </select>
        <select value={bucket} onChange={e => setBucket(e.target.value as "all" | Bucket)} style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="all">Any due date</option>
          {BUCKET_ORDER.map(b => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{ ...inputStyle, cursor: "pointer", fontWeight: 600, color: openOnly ? C.blue : C.textMid, borderColor: openOnly ? C.blueBd : C.border, background: openOnly ? C.blueBg : C.surface }}
        >
          {openOnly ? "Open only" : "All tasks"}
        </button>

        <FlagBtn on={flags.blocked}   fg={C.red}    bg={C.redBg}    bd={C.redBd}
                 onClick={() => setFlags(f => ({ ...f, blocked: !f.blocked }))}>⚠ Blocked</FlagBtn>
        <FlagBtn on={flags.client}    fg={C.orange} bg={C.orangeBg} bd={C.orangeBd}
                 onClick={() => setFlags(f => ({ ...f, client: !f.client }))}>👤 Client</FlagBtn>
        <FlagBtn on={flags.milestone} fg={C.purple} bg={C.purpleBg} bd={C.purpleBd}
                 onClick={() => setFlags(f => ({ ...f, milestone: !f.milestone }))}>★ Milestone</FlagBtn>
        <FlagBtn on={flags.overdue}   fg={C.red}    bg={C.redBg}    bd={C.redBd}
                 onClick={() => setFlags(f => ({ ...f, overdue: !f.overdue }))}>Overdue</FlagBtn>

        <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)} style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="due">Group by due date</option>
          <option value="status">Group by status</option>
          <option value="assignee">Group by assignee</option>
        </select>

        {anyFilter && (
          <button onClick={clearAll} style={{ ...inputStyle, cursor: "pointer", color: C.textSub }}>Clear filters</button>
        )}

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
          {filtered.length} of {tasks.length}
        </span>
        {project.clickupUrl && (
          <a href={project.clickupUrl} target="_blank" rel="noopener noreferrer"
             style={{ ...inputStyle, textDecoration: "none", fontWeight: 700, color: C.blue, background: C.blueBg, borderColor: C.blueBd }}>
            ↗ ClickUp
          </a>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "34px 0", color: C.textSub, fontSize: 13 }}>
          No tasks match these filters.
          {anyFilter && <> <button onClick={clearAll} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 13, fontFamily: C.font, padding: 0, textDecoration: "underline" }}>Clear them</button></>}
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.sh, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead>
              <tr>
                {["Task", "Status", "Assignees", "Due", ""].map((h, i) => (
                  <th key={h || i} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: i === 3 ? "right" : "left", borderBottom: `1px solid ${C.border}`, background: C.alt, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.flatMap(([key, list]) => [
                <tr key={`g-${key}`}>
                  <td colSpan={5} style={{ padding: "6px 12px", background: C.alt, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: key === "overdue" ? C.red : C.textMid }}>
                    {groupBy === "due" ? BUCKET_LABEL[key as Bucket] : key}
                    <span style={{ marginLeft: 8, fontFamily: C.mono, fontWeight: 500, color: C.textSub }}>{list.length}</span>
                  </td>
                </tr>,
                ...list.map((t, i) => (
                  <tr key={t.id} style={{ background: i % 2 ? C.alt : C.surface }}>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, maxWidth: 420 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: isDone(t) ? C.textSub : C.text, textDecoration: isDone(t) ? "line-through" : "none" }}>
                        {t.name}
                      </div>
                      <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                        {isMilestone(t)     && <Tag bg={C.purpleBg} fg={C.purple} bd={C.purpleBd}>★ Milestone</Tag>}
                        {isBlocked(t)       && <Tag bg={C.redBg} fg={C.red} bd={C.redBd}>⚠ Blocked</Tag>}
                        {isClientPending(t) && !isDone(t) && <Tag bg={C.orangeBg} fg={C.orange} bd={C.orangeBd}>👤 Client</Tag>}
                      </div>
                    </td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}><StatusPill status={t.status.status} /></td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                        {t.assignees.length === 0
                          ? <span style={{ fontSize: 11, color: C.mid }}>Unassigned</span>
                          : t.assignees.map(a => (
                              <span key={a.id} style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 999, background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
                                {a.username}
                              </span>
                            ))}
                      </div>
                    </td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontFamily: C.mono, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap", color: isOverdueTask(t) ? C.red : C.textMid, fontWeight: isOverdueTask(t) ? 700 : 400 }}>
                      {fmtDue(t.due_date)}
                    </td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>
                      <a href={t.url} target="_blank" rel="noopener noreferrer" title="Open in ClickUp"
                         style={{ fontSize: 11, fontWeight: 700, color: C.blue, textDecoration: "none", whiteSpace: "nowrap" }}>↗</a>
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A filter toggle that adopts its own flag's colour when active, so the bar reads at a glance. */
function FlagBtn({ on, fg, bg, bd, onClick, children }: {
  on: boolean; fg: string; bg: string; bd: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      style={{
        padding: "7px 11px", borderRadius: 8, fontSize: 12, fontWeight: on ? 700 : 600,
        cursor: "pointer", fontFamily: C.font, whiteSpace: "nowrap",
        background: on ? bg : C.surface,
        color:      on ? fg : C.textMid,
        border: `1px solid ${on ? bd : C.border}`,
      }}
    >
      {children}
    </button>
  );
}

const Tag = ({ bg, fg, bd, children }: { bg: string; fg: string; bd: string; children: React.ReactNode }) => (
  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: bg, color: fg, border: `1px solid ${bd}`, whiteSpace: "nowrap" }}>
    {children}
  </span>
);
