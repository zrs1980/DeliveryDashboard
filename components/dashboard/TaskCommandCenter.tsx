"use client";
import { useState } from "react";
import { C, STATUS_STYLES } from "@/lib/constants";
import { LinkBtn } from "@/components/ui/LinkBtn";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { isBlocked, isClientPending, isMilestone, isDone, taskBucket, type Bucket } from "@/lib/clickup";
import { nsProjectUrl } from "@/lib/constants";
import type { Project, CUTask, ProjectNote } from "@/lib/types";

type Tab = "timeline" | "milestones" | "resource" | "blocked" | "client";

interface Props {
  projects: Project[];
  onProjectsChange: (updated: Project[]) => void;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "timeline",   label: "📅 Timeline" },
  { id: "milestones", label: "★ Milestones" },
  { id: "resource",   label: "👤 By Resource" },
  { id: "blocked",    label: "⚠ Blocked" },
  { id: "client",     label: "🤝 Client" },
];

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue:   "Overdue",
  this_week: "This Week",
  next_week: "Next Week",
  upcoming:  "Upcoming",
  no_date:   "No Date",
};

function StatusBadge({ status }: { status: string }) {
  const st  = status.toLowerCase();
  const sty = STATUS_STYLES[st] ?? { bg: C.alt, color: C.textMid, bd: C.border, label: status };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, borderRadius: 3, padding: "1px 5px",
      background: sty.bg, color: sty.color, border: `1px solid ${sty.bd}`,
    }}>
      {sty.label}
    </span>
  );
}

function TaskCard({ task, projectLabel, nsProjectId }: { task: CUTask; projectLabel: string; nsProjectId: number }) {
  const blocked  = isBlocked(task);
  const client   = isClientPending(task) && !isDone(task);
  const milestone = isMilestone(task);

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 7,
      padding: "10px 12px",
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      boxShadow: C.sh,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 5 }}>
          <StatusBadge status={task.status.status} />
          {blocked  && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 3, padding: "1px 5px", background: C.redBg,    color: C.red,    border: `1px solid ${C.redBd}`    }}>⚠ Blocked</span>}
          {client   && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 3, padding: "1px 5px", background: C.orangeBg, color: C.orange, border: `1px solid ${C.orangeBd}` }}>👤 Client</span>}
          {milestone && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 3, padding: "1px 5px", background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}` }}>★ Milestone</span>}
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text, lineHeight: 1.3 }}>{task.name}</div>
        <div style={{ fontSize: 11, color: C.textSub, marginTop: 3 }}>{projectLabel}</div>
        {task.assignees.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            {task.assignees.map(a => (
              <span key={a.id} style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 10,
                background: C.alt, color: C.textMid, border: `1px solid ${C.border}`,
              }}>
                {a.username}
              </span>
            ))}
          </div>
        )}
        {task.due_date && (
          <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>
            Due: {new Date(parseInt(task.due_date)).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        <LinkBtn href={task.url} color={C.blue} bg={C.blueBg} bd={C.blueBd} label="ClickUp" />
        <LinkBtn href={nsProjectUrl(nsProjectId)} color={C.purple} bg={C.purpleBg} bd={C.purpleBd} label="NetSuite" />
      </div>
    </div>
  );
}

function Section({ title, tasks, projects }: { title: string; tasks: Array<{ task: CUTask; project: Project }>; projects: Project[] }) {
  if (tasks.length === 0) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title} ({tasks.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tasks.map(({ task, project }) => (
          <TaskCard key={task.id} task={task} projectLabel={project.label} nsProjectId={project.id} />
        ))}
      </div>
    </div>
  );
}

export function TaskCommandCenter({ projects, onProjectsChange }: Props) {
  const [tab, setTab]               = useState<Tab>("timeline");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedResource, setSelectedResource] = useState<string>("");

  const visibleProjects = selectedProject
    ? projects.filter(p => p.id === selectedProject)
    : projects;

  const allTasks: Array<{ task: CUTask; project: Project }> = visibleProjects.flatMap(p =>
    p.tasks
      .filter(t => !selectedResource || t.assignees.some(a => a.username === selectedResource))
      .map(t => ({ task: t, project: p }))
  );

  const allResources = Array.from(new Set(
    projects.flatMap(p => p.tasks.flatMap(t => t.assignees.map(a => a.username)))
  )).sort();

  const totalDone = allTasks.filter(({ task }) => isDone(task)).length;

  // Diagnostic: task counts per project
  const taskDiag = projects.map(p =>
    `${p.client}: ${p.tasks.length} fetched, listId=${p.clickupListId ?? "none"}${p.clickupError ? ` ERR:${p.clickupError}` : ""}`
  ).join(" | ");

  function renderTimeline() {
    const buckets: Bucket[] = ["overdue", "this_week", "next_week", "upcoming", "no_date"];
    return buckets.map(b => {
      const items = allTasks.filter(({ task }) => taskBucket(task) === b && !isDone(task));
      return <Section key={b} title={BUCKET_LABELS[b]} tasks={items} projects={projects} />;
    });
  }

  function renderMilestones() {
    const items = allTasks.filter(({ task }) => isMilestone(task));
    return <Section title="Milestones" tasks={items} projects={projects} />;
  }

  function renderByResource() {
    const resources = Array.from(new Set(allTasks.flatMap(({ task }) => task.assignees.map(a => a.username))));
    return resources.map(r => {
      const items = allTasks.filter(({ task }) => task.assignees.some(a => a.username === r) && !isDone(task));
      return <Section key={r} title={r} tasks={items} projects={projects} />;
    });
  }

  function renderBlocked() {
    const items = allTasks.filter(({ task }) => isBlocked(task));
    return <Section title="Blocked / On Hold" tasks={items} projects={projects} />;
  }

  function renderClient() {
    const items = allTasks.filter(({ task }) => isClientPending(task) && !isDone(task));
    return <Section title="Awaiting Client" tasks={items} projects={projects} />;
  }

  const blockedCount = allTasks.filter(({ task }) => isBlocked(task)).length;
  const clientCount  = allTasks.filter(({ task }) => isClientPending(task) && !isDone(task)).length;

  const tabsWithCounts = TABS.map(t => ({
    ...t,
    label: t.id === "blocked" ? `⚠ Blocked (${blockedCount})` : t.id === "client" ? `🤝 Client (${clientCount})` : t.label,
  }));

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", marginRight: 6 }}>Project</label>
          <select
            value={selectedProject ?? ""}
            onChange={e => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.font }}
          >
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.client}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", marginRight: 6 }}>Resource</label>
          <select
            value={selectedResource}
            onChange={e => setSelectedResource(e.target.value)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: C.font }}
          >
            <option value="">All</option>
            {allResources.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 12, color: C.textSub }}>
          {totalDone} / {allTasks.length} done
        </span>
        <span style={{ fontSize: 10, color: C.textSub, fontFamily: C.mono }}>{taskDiag}</span>
      </div>


      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${C.border}`, marginBottom: 16 }}>
        {tabsWithCounts.map(t => (
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
              borderBottom: tab === t.id ? `2px solid ${C.blue}` : "2px solid transparent",
              color: tab === t.id ? C.blue : C.textMid,
              cursor: "pointer",
              marginBottom: -2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "timeline"   && renderTimeline()}
      {tab === "milestones" && renderMilestones()}
      {tab === "resource"   && renderByResource()}
      {tab === "blocked"    && renderBlocked()}
      {tab === "client"     && renderClient()}

      {/* Project notes — shown when a single project is selected */}
      {selectedProject && (() => {
        const proj = projects.find(p => p.id === selectedProject);
        if (!proj) return null;
        return (
          <div style={{ marginTop: 24, background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 13, color: C.text }}>
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
