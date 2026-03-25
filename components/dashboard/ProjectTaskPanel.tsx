"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";
import { isPhaseRow } from "@/lib/health";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NSTask {
  id: number;
  title: string;
  budgetedHours: number;
  actualHours: number;
  remainingHours: number;
  status: string;
  statusLabel: string;   // display name from NS REST refName
  statusRestId: string;  // ID used for PATCH (from NS REST record)
  parentId: number | null;
  startDate: string | null;
  endDate: string | null;
}

interface TreeNode {
  task: NSTask;
  children: TreeNode[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Status options are derived at runtime from the loaded tasks (statusRestId + statusLabel from NS REST)
// so we never hardcode potentially wrong IDs.

function statusStyle(label: string): { bg: string; color: string; bd: string } {
  const l = label.toLowerCase();
  if (l.includes("complet") || l.includes("done"))
    return { bg: C.greenBg,  color: C.green,  bd: C.greenBd  };
  if (l.includes("progress") || l.includes("active"))
    return { bg: C.blueBg,   color: C.blue,   bd: C.blueBd   };
  if (l.includes("hold") || l.includes("block") || l.includes("cancel"))
    return { bg: C.redBg,    color: C.red,    bd: C.redBd    };
  return { bg: C.alt, color: C.textSub, bd: C.border };
}

// ─── Tree builder ─────────────────────────────────────────────────────────────

function buildTree(tasks: NSTask[]): TreeNode[] {
  // Check if any tasks have real parent IDs pointing to other tasks
  const taskIds = new Set(tasks.map(t => t.id));
  const hasRealParents = tasks.some(t => t.parentId !== null && taskIds.has(t.parentId));

  if (hasRealParents) {
    // Use parentId hierarchy
    const nodeMap = new Map<number, TreeNode>();
    tasks.forEach(t => nodeMap.set(t.id, { task: t, children: [] }));

    const roots: TreeNode[] = [];
    tasks.forEach(t => {
      const node = nodeMap.get(t.id)!;
      if (t.parentId !== null && nodeMap.has(t.parentId)) {
        nodeMap.get(t.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  // Fall back: use isPhaseRow to group tasks under phases
  const roots: TreeNode[] = [];
  let currentPhase: TreeNode | null = null;

  for (const task of tasks) {
    const node: TreeNode = { task, children: [] };
    if (isPhaseRow(task.title)) {
      roots.push(node);
      currentPhase = node;
    } else {
      if (currentPhase) {
        currentPhase.children.push(node);
      } else {
        // No phase yet — add as top-level
        roots.push(node);
      }
    }
  }
  return roots;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtHours(n: number): string {
  if (n === 0) return "—";
  return n % 1 === 0 ? `${n}h` : `${n.toFixed(1)}h`;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

// ─── Task row component ───────────────────────────────────────────────────────

interface StatusOption { id: string; label: string; }

interface TaskRowProps {
  task: NSTask;
  isPhase: boolean;
  depth: number;
  projectId: number;
  statusOptions: StatusOption[];
  onUpdate: (taskId: number, updated: Partial<NSTask>) => void;
}

function TaskRow({ task, isPhase, depth, projectId, statusOptions, onUpdate }: TaskRowProps) {
  const [editing, setEditing] = useState<"status" | "startDate" | "endDate" | null>(null);
  const [draft, setDraft] = useState<{ status: string; startDate: string; endDate: string }>({
    status:    task.statusRestId,
    startDate: task.startDate ?? "",
    endDate:   task.endDate   ?? "",
  });
  const [saving, setSaving] = useState(false);

  const st = statusStyle(task.statusLabel);
  const noBudget = task.budgetedHours === 0;

  async function save(field: "status" | "startDate" | "endDate") {
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (field === "status")    body.status    = draft.status;
      if (field === "startDate") body.startDate = draft.startDate || null;
      if (field === "endDate")   body.endDate   = draft.endDate   || null;

      const res = await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert("Failed to save: " + (data.error ?? res.statusText));
        return;
      }

      // Update local state via parent callback
      const updated: Partial<NSTask> = {};
      if (field === "status") {
        updated.statusRestId = draft.status;
        updated.statusLabel  = statusOptions.find(s => s.id === draft.status)?.label ?? draft.status;
        updated.status       = draft.status;
      }
      if (field === "startDate") updated.startDate = draft.startDate || null;
      if (field === "endDate")   updated.endDate   = draft.endDate   || null;
      onUpdate(task.id, updated);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  const rowBg    = isPhase ? "#F0F4F8" : C.surface;
  const indent   = depth * 24;
  const fontSize = isPhase ? 13 : 12;

  const cellSt: React.CSSProperties = {
    padding:        "6px 10px",
    borderBottom:   `1px solid ${C.border}`,
    verticalAlign:  "middle",
    fontSize,
    color:          C.text,
    background:     rowBg,
  };

  const monoSt: React.CSSProperties = {
    fontFamily: C.mono,
    fontSize:   fontSize - 1,
    color:      C.textMid,
  };

  // Inline editor components
  function StatusCell() {
    if (editing === "status") {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <select
            autoFocus
            value={draft.status}
            onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
            style={{
              fontSize: 11, fontFamily: C.font,
              border: `1px solid ${C.blue}`, borderRadius: 4,
              padding: "2px 4px", outline: "none", background: C.surface, color: C.text,
            }}
          >
            {statusOptions.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={() => save("status")}
            disabled={saving}
            style={saveBtnSt}
          >
            {saving ? "…" : "✓"}
          </button>
          <button onClick={() => setEditing(null)} style={cancelBtnSt}>✕</button>
        </div>
      );
    }
    return (
      <span
        onClick={() => {
          setDraft(d => ({ ...d, status: task.statusRestId }));
          setEditing("status");
        }}
        title="Click to edit status"
        style={{
          fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "2px 7px",
          background: st.bg, color: st.color, border: `1px solid ${st.bd}`,
          cursor: "pointer", whiteSpace: "nowrap", display: "inline-block",
        }}
      >
        {task.statusLabel || task.status}
      </span>
    );
  }

  function DateCell({ field }: { field: "startDate" | "endDate" }) {
    const val     = field === "startDate" ? task.startDate : task.endDate;
    const draftV  = field === "startDate" ? draft.startDate : draft.endDate;
    const isEdit  = editing === field;

    if (isEdit) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="date"
            autoFocus
            value={draftV}
            onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
            onKeyDown={e => {
              if (e.key === "Enter")  save(field);
              if (e.key === "Escape") setEditing(null);
            }}
            style={{
              fontSize: 11, fontFamily: C.font,
              border: `1px solid ${C.blue}`, borderRadius: 4,
              padding: "2px 4px", outline: "none", background: C.surface, color: C.text,
              width: 120,
            }}
          />
          <button onClick={() => save(field)} disabled={saving} style={saveBtnSt}>
            {saving ? "…" : "✓"}
          </button>
          <button onClick={() => setEditing(null)} style={cancelBtnSt}>✕</button>
        </div>
      );
    }
    return (
      <span
        onClick={() => {
          setDraft(d => ({ ...d, [field]: val ?? "" }));
          setEditing(field);
        }}
        title="Click to edit date"
        style={{
          ...monoSt,
          cursor: "pointer",
          textDecoration: "underline",
          textDecorationStyle: "dotted",
          textUnderlineOffset: 2,
        }}
      >
        {fmtDate(val)}
      </span>
    );
  }

  return (
    <tr>
      {/* # */}
      <td style={{ ...cellSt, color: C.textSub, fontFamily: C.mono, fontSize: 11, width: 40, textAlign: "right", paddingRight: 8 }}>
        {task.id}
      </td>

      {/* Task Name */}
      <td style={{ ...cellSt, paddingLeft: indent + 10 }}>
        <span style={{ fontWeight: isPhase ? 700 : 400 }}>
          {task.title}
        </span>
      </td>

      {/* Status */}
      <td style={{ ...cellSt, whiteSpace: "nowrap" }}>
        <StatusCell />
      </td>

      {/* Start Date */}
      <td style={{ ...cellSt, whiteSpace: "nowrap" }}>
        <DateCell field="startDate" />
      </td>

      {/* End Date */}
      <td style={{ ...cellSt, whiteSpace: "nowrap" }}>
        <DateCell field="endDate" />
      </td>

      {/* Budgeted Hrs */}
      <td style={{ ...cellSt, ...monoSt, textAlign: "right" }}>
        {noBudget ? "—" : fmtHours(task.budgetedHours)}
      </td>

      {/* Actual Hrs */}
      <td style={{ ...cellSt, ...monoSt, textAlign: "right" }}>
        {noBudget ? "—" : fmtHours(task.actualHours)}
      </td>

      {/* Remaining Hrs */}
      <td style={{
        ...cellSt,
        ...monoSt,
        textAlign: "right",
        color: !noBudget && task.remainingHours < 0 ? C.red : monoSt.color,
        fontWeight: !noBudget && task.remainingHours < 0 ? 700 : 400,
      }}>
        {noBudget ? "—" : fmtHours(task.remainingHours)}
      </td>
    </tr>
  );
}

// Button micro-styles
const saveBtnSt: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: "2px 6px",
  borderRadius: 4, cursor: "pointer", fontFamily: "'DM Sans','Segoe UI',sans-serif",
  background: "#1A56DB", color: "#fff", border: "1px solid #1A56DB",
};
const cancelBtnSt: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: "2px 6px",
  borderRadius: 4, cursor: "pointer", fontFamily: "'DM Sans','Segoe UI',sans-serif",
  background: "#F7F9FC", color: "#4A5568", border: "1px solid #E2E5EA",
};

// ─── Phase header with collapse toggle ───────────────────────────────────────

interface PhaseRowProps {
  task: NSTask;
  projectId: number;
  expanded: boolean;
  statusOptions: StatusOption[];
  onToggle: () => void;
  onUpdate: (taskId: number, updated: Partial<NSTask>) => void;
}

function PhaseRow({ task, projectId, expanded, statusOptions, onToggle, onUpdate }: PhaseRowProps) {
  return (
    <>
      <tr style={{ background: "#F0F4F8" }}>
        {/* Toggle collapse */}
        <td style={{
          padding: "6px 8px 6px 10px",
          borderBottom: `1px solid ${C.border}`,
          background: "#F0F4F8",
          textAlign: "right",
          verticalAlign: "middle",
          width: 40,
        }}>
          <button
            onClick={onToggle}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 10, color: C.textSub, padding: "2px 3px",
            }}
            title={expanded ? "Collapse phase" : "Expand phase"}
          >
            {expanded ? "▼" : "▶"}
          </button>
        </td>

        {/* Task name (full width) via TaskRow approach but in a phase style */}
        <td colSpan={7} style={{ padding: 0, borderBottom: `1px solid ${C.border}`, background: "#F0F4F8" }}>
          {/* Reuse TaskRow for consistent columns */}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <TaskRow
                task={task}
                isPhase={true}
                depth={0}
                projectId={projectId}
                statusOptions={statusOptions}
                onUpdate={onUpdate}
              />
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  projectId: number;
}

export function ProjectTaskPanel({ projectId }: Props) {
  const [tasks,      setTasks]      = useState<NSTask[]>([]);
  const [allStatuses, setAllStatuses] = useState<StatusOption[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [collapsed,  setCollapsed]  = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/tasks`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setTasks(data.tasks ?? []);
        if (data.allStatuses?.length) setAllStatuses(data.allStatuses);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleUpdate = useCallback((taskId: number, updated: Partial<NSTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updated } : t));
  }, []);

  function toggleCollapse(phaseId: number) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(phaseId) ? next.delete(phaseId) : next.add(phaseId);
      return next;
    });
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div style={{
        padding: "20px 24px",
        background: "#F6F8FC",
        borderTop: `1px dashed ${C.border}`,
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: C.textSub }}>Loading tasks from NetSuite…</span>
          <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
            (fetching dates via REST API)
          </span>
        </div>
        {/* Skeleton rows */}
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{
            height: 32, background: "#E8ECF2", borderRadius: 4,
            marginTop: 8, opacity: 1 - i * 0.15,
            animation: "pulse 1.5s ease-in-out infinite",
          }} />
        ))}
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div style={{
        padding: "16px 24px",
        background: C.redBg,
        borderTop: `1px dashed ${C.redBd}`,
        color: C.red,
        fontSize: 12,
      }}>
        <strong>Error loading tasks:</strong> {error}
      </div>
    );
  }

  // ── Empty state ──
  if (tasks.length === 0) {
    return (
      <div style={{
        padding: "16px 24px",
        background: "#F6F8FC",
        borderTop: `1px dashed ${C.border}`,
        color: C.textSub,
        fontSize: 12,
      }}>
        No project tasks found in NetSuite.
      </div>
    );
  }

  // ── Build status options: prefer full list from API, fall back to per-task values ──
  const statusOptions: StatusOption[] = allStatuses.length > 0
    ? allStatuses
    : Array.from(
        new Map(
          tasks
            .filter(t => t.statusRestId)
            .map(t => [t.statusRestId, { id: t.statusRestId, label: t.statusLabel || t.statusRestId }])
        ).values()
      ).sort((a, b) => a.label.localeCompare(b.label));

  // ── Build tree and render ──
  const tree = buildTree(tasks);

  const thSt: React.CSSProperties = {
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: C.textSub,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: `2px solid ${C.border}`,
    background: "#F0F4F8",
    whiteSpace: "nowrap",
    userSelect: "none",
  };

  return (
    <div style={{
      borderTop: `1px dashed ${C.border}`,
      background: "#F6F8FC",
    }}>
      {/* Header bar */}
      <div style={{
        padding: "8px 16px",
        background: "#EBF0F8",
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textMid, letterSpacing: "0.04em" }}>
          ☰ PROJECT TASKS
        </span>
        <span style={{
          fontSize: 11, fontFamily: C.mono, color: C.textSub,
          background: C.alt, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: "1px 7px",
        }}>
          {tasks.length} tasks
        </span>
        <span style={{ fontSize: 10, color: C.textSub }}>
          Status, start and end dates are editable — click to change
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: C.font,
          fontSize: 12,
        }}>
          <thead>
            <tr>
              <th style={{ ...thSt, width: 40, textAlign: "right", paddingRight: 8 }}>#</th>
              <th style={{ ...thSt, minWidth: 220 }}>Task Name</th>
              <th style={{ ...thSt, minWidth: 110 }}>Status</th>
              <th style={{ ...thSt, minWidth: 100 }}>Start Date</th>
              <th style={{ ...thSt, minWidth: 100 }}>End Date</th>
              <th style={{ ...thSt, textAlign: "right", minWidth: 90 }}>Budgeted Hrs</th>
              <th style={{ ...thSt, textAlign: "right", minWidth: 80 }}>Actual Hrs</th>
              <th style={{ ...thSt, textAlign: "right", minWidth: 90 }}>Remaining Hrs</th>
            </tr>
          </thead>
          <tbody>
            {tree.map(node => {
              const phase    = node.task;
              const isPhase  = isPhaseRow(phase.title) || node.children.length > 0;
              const isCollapsed = collapsed.has(phase.id);

              if (!isPhase) {
                // Top-level non-phase task
                return (
                  <TaskRow
                    key={phase.id}
                    task={phase}
                    isPhase={false}
                    depth={0}
                    projectId={projectId}
                    statusOptions={statusOptions}
                    onUpdate={handleUpdate}
                  />
                );
              }

              return (
                <PhaseBlock
                  key={phase.id}
                  node={node}
                  projectId={projectId}
                  collapsed={isCollapsed}
                  statusOptions={statusOptions}
                  onToggle={() => toggleCollapse(phase.id)}
                  onUpdate={handleUpdate}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Phase block (phase row + its children) ───────────────────────────────────

interface PhaseBlockProps {
  node: TreeNode;
  projectId: number;
  collapsed: boolean;
  statusOptions: StatusOption[];
  onToggle: () => void;
  onUpdate: (taskId: number, updated: Partial<NSTask>) => void;
}

function PhaseBlock({ node, projectId, collapsed, statusOptions, onToggle, onUpdate }: PhaseBlockProps) {
  const { task: phase, children } = node;

  const st = statusStyle(phase.statusLabel);

  const thSt: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: `1px solid ${C.border}`,
    verticalAlign: "middle",
    fontSize: 13,
    background: "#F0F4F8",
  };
  const monoSt: React.CSSProperties = {
    fontFamily: C.mono,
    fontSize: 12,
    color: C.textMid,
  };

  const [editingField, setEditingField] = useState<"status" | "startDate" | "endDate" | null>(null);
  const [draft, setDraft] = useState({
    status:    phase.statusRestId,
    startDate: phase.startDate ?? "",
    endDate:   phase.endDate   ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save(field: "status" | "startDate" | "endDate") {
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (field === "status")    body.status    = draft.status;
      if (field === "startDate") body.startDate = draft.startDate || null;
      if (field === "endDate")   body.endDate   = draft.endDate   || null;

      const res = await fetch(`/api/projects/${projectId}/tasks/${phase.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert("Failed to save: " + (data.error ?? res.statusText));
        return;
      }

      const updated: Partial<NSTask> = {};
      if (field === "status") {
        updated.statusRestId = draft.status;
        updated.statusLabel  = statusOptions.find(s => s.id === draft.status)?.label ?? draft.status;
        updated.status       = draft.status;
      }
      if (field === "startDate") updated.startDate = draft.startDate || null;
      if (field === "endDate")   updated.endDate   = draft.endDate   || null;
      onUpdate(phase.id, updated);
      setEditingField(null);
    } finally {
      setSaving(false);
    }
  }

  // Use current task state from parent (phase is passed from node.task which is from tasks state)
  const noBudget = phase.budgetedHours === 0;

  function StatusCell() {
    const currentSt = statusStyle(phase.statusLabel);
    if (editingField === "status") {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <select
            autoFocus
            value={draft.status}
            onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
            style={{
              fontSize: 11, fontFamily: C.font,
              border: `1px solid ${C.blue}`, borderRadius: 4,
              padding: "2px 4px", outline: "none", background: C.surface, color: C.text,
            }}
          >
            {statusOptions.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <button onClick={() => save("status")} disabled={saving} style={saveBtnSt}>
            {saving ? "…" : "✓"}
          </button>
          <button onClick={() => setEditingField(null)} style={cancelBtnSt}>✕</button>
        </div>
      );
    }
    return (
      <span
        onClick={() => { setDraft(d => ({ ...d, status: phase.statusRestId })); setEditingField("status"); }}
        title="Click to edit status"
        style={{
          fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "2px 7px",
          background: currentSt.bg, color: currentSt.color, border: `1px solid ${currentSt.bd}`,
          cursor: "pointer", whiteSpace: "nowrap", display: "inline-block",
        }}
      >
        {phase.statusLabel || phase.status}
      </span>
    );
  }

  function DateCell({ field }: { field: "startDate" | "endDate" }) {
    const val    = field === "startDate" ? phase.startDate : phase.endDate;
    const draftV = field === "startDate" ? draft.startDate : draft.endDate;
    const isEdit = editingField === field;

    if (isEdit) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="date"
            autoFocus
            value={draftV}
            onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
            onKeyDown={e => {
              if (e.key === "Enter")  save(field);
              if (e.key === "Escape") setEditingField(null);
            }}
            style={{
              fontSize: 11, fontFamily: C.font,
              border: `1px solid ${C.blue}`, borderRadius: 4,
              padding: "2px 4px", outline: "none", background: C.surface, color: C.text,
              width: 120,
            }}
          />
          <button onClick={() => save(field)} disabled={saving} style={saveBtnSt}>
            {saving ? "…" : "✓"}
          </button>
          <button onClick={() => setEditingField(null)} style={cancelBtnSt}>✕</button>
        </div>
      );
    }
    return (
      <span
        onClick={() => { setDraft(d => ({ ...d, [field]: val ?? "" })); setEditingField(field); }}
        title="Click to edit date"
        style={{
          ...monoSt,
          cursor: "pointer",
          textDecoration: "underline",
          textDecorationStyle: "dotted",
          textUnderlineOffset: 2,
        }}
      >
        {fmtDate(val)}
      </span>
    );
  }

  return (
    <>
      {/* Phase row */}
      <tr>
        {/* Collapse toggle */}
        <td style={{ ...thSt, textAlign: "right", paddingRight: 8, width: 40 }}>
          <button
            onClick={onToggle}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 10, color: C.textSub, padding: "2px 3px",
            }}
            title={collapsed ? "Expand phase" : "Collapse phase"}
          >
            {collapsed ? "▶" : "▼"}
          </button>
        </td>

        {/* Phase name */}
        <td style={{ ...thSt, fontWeight: 700, color: C.text }}>
          {phase.title}
          {children.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 10, color: C.textSub, fontWeight: 400 }}>
              ({children.length} task{children.length !== 1 ? "s" : ""})
            </span>
          )}
        </td>

        {/* Status */}
        <td style={{ ...thSt, whiteSpace: "nowrap" }}>
          <StatusCell />
        </td>

        {/* Start Date */}
        <td style={{ ...thSt, whiteSpace: "nowrap" }}>
          <DateCell field="startDate" />
        </td>

        {/* End Date */}
        <td style={{ ...thSt, whiteSpace: "nowrap" }}>
          <DateCell field="endDate" />
        </td>

        {/* Budgeted Hrs */}
        <td style={{ ...thSt, ...monoSt, textAlign: "right" }}>
          {noBudget ? "—" : fmtHours(phase.budgetedHours)}
        </td>

        {/* Actual Hrs */}
        <td style={{ ...thSt, ...monoSt, textAlign: "right" }}>
          {noBudget ? "—" : fmtHours(phase.actualHours)}
        </td>

        {/* Remaining Hrs */}
        <td style={{
          ...thSt,
          ...monoSt,
          textAlign: "right",
          color: !noBudget && phase.remainingHours < 0 ? C.red : monoSt.color,
          fontWeight: !noBudget && phase.remainingHours < 0 ? 700 : 400,
        }}>
          {noBudget ? "—" : fmtHours(phase.remainingHours)}
        </td>
      </tr>

      {/* Child task rows */}
      {!collapsed && children.map(child => (
        <TaskRow
          key={child.task.id}
          task={child.task}
          isPhase={false}
          depth={1}
          projectId={projectId}
          statusOptions={statusOptions}
          onUpdate={onUpdate}
        />
      ))}
    </>
  );
}
