"use client";
import { useState, useEffect, useCallback } from "react";
import { C, STATUS_STYLES, EMPLOYEES } from "@/lib/constants";
import type { Project } from "@/lib/types";

// ─── Shared types ─────────────────────────────────────────────────────────────

interface PMPhase {
  id: string;
  project_ns_id: string;
  name: string;
  phase_number: number | null;
  sort_order: number;
  color: string | null;
  pm_tasks: PMTask[];
}

interface PMTask {
  id: string;
  phase_id: string;
  project_ns_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_ns_id: number | null;
  assignee_name: string | null;
  due_date: string | null;
  time_estimate: number | null;
  time_logged: number;
  sort_order: number;
  clickup_task_id: string | null;
  is_customer_visible: boolean;
  created_at: string;
  updated_at: string;
}

interface PMTimeEntry {
  id: string;
  task_id: string;
  logged_by: string;
  hours: number;
  note: string | null;
  logged_date: string;
}

interface PMNote {
  id: string;
  clickup_task_id: string;
  project_ns_id: string;
  body: string;
  is_internal: boolean;
  author_name: string;
  author_type: "staff" | "customer";
  customer_ns_id: string | null;
  created_at: string;
}

interface PMApproval {
  clickup_task_id: string;
  project_ns_id: string;
  approved_by_name: string;
  approved_by_email: string;
  notes: string | null;
  approved_at: string;
}

interface PortalAccess {
  customer_ns_id: string;
  project_ns_id: string;
  project_name: string;
  invited_by: string;
  customer_portal_users?: { email: string; display_name: string | null };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_STATUSES = [
  { value: "new",         label: "New",         bg: C.alt,       color: C.textMid },
  { value: "in_progress", label: "In Progress",  bg: C.blueBg,    color: C.blue },
  { value: "in_review",   label: "In Review",    bg: C.purpleBg,  color: C.purple },
  { value: "awaiting",    label: "Awaiting",     bg: C.orangeBg,  color: C.orange },
  { value: "blocked",     label: "Blocked",      bg: C.redBg,     color: C.red },
  { value: "scheduled",   label: "Scheduled",    bg: C.purpleBg,  color: C.purple },
  { value: "supplied",    label: "Supplied",     bg: C.tealBg,    color: C.teal },
  { value: "done",        label: "Done",         bg: C.greenBg,   color: C.green },
];

const PRIORITIES = [
  { value: "urgent", label: "🔴 Urgent" },
  { value: "high",   label: "🟠 High" },
  { value: "normal", label: "⚪ Normal" },
  { value: "low",    label: "🔵 Low" },
];

const EMPLOYEE_LIST = Object.entries(EMPLOYEES).map(([id, name]) => ({ id: parseInt(id), name }));

function taskStatusStyle(s: string) {
  return TASK_STATUSES.find(x => x.value === s) ?? TASK_STATUSES[0];
}

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

function fmtH(h: number | null): string | null {
  if (h == null) return null;
  return (h % 1 === 0 ? String(h) : h.toFixed(1)) + "h";
}

// ─── InviteModal ──────────────────────────────────────────────────────────────

function InviteModal({
  projectId, projectName, onClose, onInvited,
}: { projectId: number; projectName: string; onClose: () => void; onInvited: () => void }) {
  const [customers, setCustomers] = useState<{ id: number; companyname: string }[]>([]);
  const [selectedCustomer, setSel] = useState("");
  const [email, setEmail]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/customers").then(r => r.json()).then(d => setCustomers(d.customers ?? []));
  }, []);

  const selCust = customers.find(c => String(c.id) === selectedCustomer);

  async function invite() {
    if (!selectedCustomer || !email) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/portal/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          customerNsId:  selectedCustomer,
          customerName:  selCust?.companyname ?? "",
          projectNsIds:  [String(projectId)],
          projectNames:  { [String(projectId)]: projectName },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      onInvited();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invite");
    } finally { setSaving(false); }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 4 }}>Invite Customer to Portal</div>
        <div style={{ fontSize: 12, color: C.textSub, marginBottom: 22 }}>
          Grant access to: <strong>{projectName}</strong>
        </div>
        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "8px 12px", color: C.red, fontSize: 12, marginBottom: 14 }}>
            {error}
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Customer</label>
          <select
            value={selectedCustomer}
            onChange={e => setSel(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontFamily: C.font, color: C.text, background: "#fff", outline: "none" }}
          >
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={String(c.id)}>{c.companyname}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Contact Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="contact@client.com"
            style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontFamily: C.font, color: C.text, outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>A magic-link invite email will be sent.</div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>
            Cancel
          </button>
          <button
            onClick={invite}
            disabled={!selectedCustomer || !email || saving}
            style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, opacity: (!selectedCustomer || !email || saving) ? 0.6 : 1 }}
          >
            {saving ? "Sending…" : "Send Invite"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = taskStatusStyle(status);
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

// ─── TaskDetailPanel ──────────────────────────────────────────────────────────

function TaskDetailPanel({
  task, phases, projectNsId, onClose, onUpdated, onDeleted,
}: {
  task: PMTask;
  phases: PMPhase[];
  projectNsId: string;
  onClose: () => void;
  onUpdated: (t: PMTask) => void;
  onDeleted: () => void;
}) {
  const [form, setForm]           = useState<Partial<PMTask>>({ ...task });
  const [subtasks, setSubtasks]   = useState<PMTask[]>([]);
  const [timeEntries, setTE]      = useState<PMTimeEntry[]>([]);
  const [notes, setNotes]         = useState<PMNote[]>([]);
  const [newSubtask, setNSub]     = useState("");
  const [logHours, setLogH]       = useState("");
  const [logNote, setLogN]        = useState("");
  const [newNote, setNewNote]     = useState("");
  const [noteInternal, setNI]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [showTimeForm, setShowTF] = useState(false);
  const [showNoteForm, setShowNF] = useState(false);

  useEffect(() => {
    fetch(`/api/pm/tasks/${task.id}`)
      .then(r => r.json())
      .then(d => { setSubtasks(d.subtasks ?? []); setTE(d.timeEntries ?? []); setNotes(d.notes ?? []); });
  }, [task.id]);

  async function save() {
    setSaving(true);
    try {
      const empName = EMPLOYEE_LIST.find(e => e.id === form.assignee_ns_id)?.name ?? form.assignee_name ?? null;
      const res = await fetch(`/api/pm/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:             form.title,
          description:       form.description,
          status:            form.status,
          priority:          form.priority,
          assigneeNsId:      form.assignee_ns_id,
          assigneeName:      empName,
          dueDate:           form.due_date,
          timeEstimate:      form.time_estimate,
          phaseId:           form.phase_id,
          isCustomerVisible: form.is_customer_visible,
        }),
      });
      const d = await res.json();
      if (d.task) onUpdated(d.task);
    } finally { setSaving(false); }
  }

  async function deleteTask() {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    await fetch(`/api/pm/tasks/${task.id}`, { method: "DELETE" });
    onDeleted();
  }

  async function addSubtask() {
    if (!newSubtask.trim()) return;
    const res = await fetch("/api/pm/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseId: task.phase_id, projectNsId, title: newSubtask.trim(), parentTaskId: task.id }),
    });
    const d = await res.json();
    if (d.task) { setSubtasks(s => [...s, d.task]); setNSub(""); }
  }

  async function logTime() {
    const h = parseFloat(logHours);
    if (!h || h <= 0) return;
    const res = await fetch(`/api/pm/tasks/${task.id}/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: h, note: logNote || null }),
    });
    const d = await res.json();
    if (d.entry) {
      setTE(t => [d.entry, ...t]);
      onUpdated({ ...task, time_logged: d.totalLogged });
      setLogH(""); setLogN(""); setShowTF(false);
    }
  }

  async function addNote() {
    if (!newNote.trim()) return;
    const res = await fetch("/api/pm/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clickupTaskId: task.id, projectNsId, body: newNote.trim(), isInternal: noteInternal }),
    });
    const d = await res.json();
    if (d.note) { setNotes(n => [...n, d.note]); setNewNote(""); setShowNF(false); }
  }

  const fieldLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", flexDirection: "column", gap: 4 };
  const fieldInput: React.CSSProperties = { padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: C.font, color: C.text, background: "#fff" };

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 440, background: C.surface, borderLeft: `1px solid ${C.border}`, boxShadow: "-4px 0 24px rgba(0,0,0,0.10)", display: "flex", flexDirection: "column", zIndex: 100, fontFamily: C.font }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <input
          value={form.title ?? ""}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          style={{ fontSize: 15, fontWeight: 700, color: C.text, background: "transparent", border: "none", outline: "none", flex: 1, fontFamily: C.font }}
        />
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.textSub, lineHeight: 1 }}>×</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

        {/* Status + Priority */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <label style={fieldLabel}>
            Status
            <select value={form.status ?? "new"} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={fieldInput}>
              {TASK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Priority
            <select value={form.priority ?? "normal"} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} style={fieldInput}>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
        </div>

        {/* Assignee */}
        <label style={{ ...fieldLabel, marginBottom: 14 }}>
          Assignee
          <select value={String(form.assignee_ns_id ?? "")} onChange={e => setForm(f => ({ ...f, assignee_ns_id: e.target.value ? parseInt(e.target.value) : null }))} style={fieldInput}>
            <option value="">Unassigned</option>
            {EMPLOYEE_LIST.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>

        {/* Phase */}
        <label style={{ ...fieldLabel, marginBottom: 14 }}>
          Phase
          <select value={form.phase_id ?? ""} onChange={e => setForm(f => ({ ...f, phase_id: e.target.value }))} style={fieldInput}>
            {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        {/* Due + Estimate */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <label style={fieldLabel}>
            Due Date
            <input type="date" value={form.due_date ?? ""} onChange={e => setForm(f => ({ ...f, due_date: e.target.value || null }))} style={fieldInput} />
          </label>
          <label style={fieldLabel}>
            Est. Hours
            <input type="number" min="0" step="0.5" value={form.time_estimate ?? ""} onChange={e => setForm(f => ({ ...f, time_estimate: e.target.value ? parseFloat(e.target.value) : null }))} style={fieldInput} />
          </label>
        </div>

        {/* Description */}
        <label style={{ ...fieldLabel, marginBottom: 14 }}>
          Description
          <textarea value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value || null }))} rows={3} style={{ ...fieldInput, resize: "vertical" }} />
        </label>

        {/* Customer visible */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 12, color: C.textMid, cursor: "pointer" }}>
          <input type="checkbox" checked={form.is_customer_visible ?? true} onChange={e => setForm(f => ({ ...f, is_customer_visible: e.target.checked }))} />
          Visible to customer in portal
        </label>

        <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "0 0 14px" }} />

        {/* Time tracking */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
              ⏱ {fmtH(task.time_logged) ?? "0h"} logged{task.time_estimate ? ` / ${fmtH(task.time_estimate)} est` : ""}
            </span>
            <button onClick={() => setShowTF(s => !s)} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.alt, color: C.textMid, cursor: "pointer" }}>
              + Log time
            </button>
          </div>
          {showTimeForm && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input type="number" placeholder="Hours" value={logHours} onChange={e => setLogH(e.target.value)} style={{ width: 70, ...fieldInput }} />
              <input placeholder="Note (optional)" value={logNote} onChange={e => setLogN(e.target.value)} style={{ flex: 1, ...fieldInput }} />
              <button onClick={logTime} style={{ padding: "5px 12px", borderRadius: 6, background: C.blue, color: "#fff", border: "none", fontSize: 12, cursor: "pointer" }}>Save</button>
            </div>
          )}
          {timeEntries.slice(0, 5).map(e => (
            <div key={e.id} style={{ fontSize: 11, color: C.textSub, display: "flex", gap: 8, padding: "2px 0" }}>
              <span style={{ color: C.blue, fontFamily: C.mono, fontWeight: 600 }}>{fmtH(e.hours)}</span>
              <span>{e.logged_by}</span>
              <span>{fmtDate(e.logged_date)}</span>
              {e.note && <span>— {e.note}</span>}
            </div>
          ))}
        </div>

        <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "0 0 14px" }} />

        {/* Subtasks */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.text, display: "block", marginBottom: 8 }}>Subtasks ({subtasks.length})</span>
          {subtasks.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
              <input
                type="checkbox"
                checked={s.status === "done"}
                onChange={async e => {
                  const res = await fetch(`/api/pm/tasks/${s.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: e.target.checked ? "done" : "new" }) });
                  const d = await res.json();
                  if (d.task) setSubtasks(st => st.map(t => t.id === s.id ? d.task : t));
                }}
              />
              <span style={{ flex: 1, fontSize: 12, color: s.status === "done" ? C.textSub : C.text, textDecoration: s.status === "done" ? "line-through" : "none" }}>{s.title}</span>
              <StatusBadge status={s.status} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              placeholder="Add subtask…"
              value={newSubtask}
              onChange={e => setNSub(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addSubtask()}
              style={{ flex: 1, ...fieldInput }}
            />
            <button onClick={addSubtask} style={{ padding: "5px 12px", borderRadius: 6, background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontSize: 12, cursor: "pointer" }}>Add</button>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "0 0 14px" }} />

        {/* Notes */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Notes ({notes.length})</span>
            <button onClick={() => setShowNF(s => !s)} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.alt, color: C.textMid, cursor: "pointer" }}>+ Add note</button>
          </div>
          {showNoteForm && (
            <div style={{ marginBottom: 10 }}>
              <textarea
                placeholder="Add a note…"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                rows={3}
                style={{ width: "100%", ...fieldInput, resize: "vertical", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                <label style={{ fontSize: 12, color: C.textMid, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={noteInternal} onChange={e => setNI(e.target.checked)} /> 🔒 Internal only
                </label>
                <button onClick={addNote} style={{ padding: "5px 14px", borderRadius: 6, background: C.blue, color: "#fff", border: "none", fontSize: 12, cursor: "pointer" }}>Save</button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {notes.map(n => (
              <div key={n.id} style={{ fontSize: 12, padding: "8px 10px", borderRadius: 6, background: n.is_internal ? C.yellowBg : n.author_type === "customer" ? C.blueBg : C.alt, border: `1px solid ${n.is_internal ? C.yellowBd : n.author_type === "customer" ? C.blueBd : C.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 11 }}>{n.author_name}</span>
                  <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    {n.is_internal && <span style={{ fontSize: 9, background: C.yellowBg, color: C.yellow, padding: "0 5px", borderRadius: 5, border: `1px solid ${C.yellowBd}` }}>🔒 INTERNAL</span>}
                    {n.author_type === "customer" && <span style={{ fontSize: 9, background: C.blueBg, color: C.blue, padding: "0 5px", borderRadius: 5, border: `1px solid ${C.blueBd}` }}>CUSTOMER</span>}
                    <span style={{ color: C.textSub, fontSize: 10 }}>{fmtDate(n.created_at)}</span>
                  </div>
                </div>
                <p style={{ margin: 0, color: C.textMid, whiteSpace: "pre-wrap" }}>{n.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between" }}>
        <button onClick={deleteTask} style={{ padding: "7px 14px", borderRadius: 6, background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, fontSize: 12, cursor: "pointer" }}>
          Delete
        </button>
        <button onClick={save} disabled={saving} style={{ padding: "7px 20px", borderRadius: 6, background: C.blue, color: "#fff", border: "none", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ─── PhaseSection ─────────────────────────────────────────────────────────────

function PhaseSection({
  phase, projectNsId, onTaskClick, onTaskAdded,
}: {
  phase: PMPhase;
  projectNsId: string;
  onTaskClick: (t: PMTask) => void;
  onTaskAdded: (t: PMTask) => void;
}) {
  const [expanded, setExpanded]     = useState(true);
  const [addingTask, setAddingTask] = useState(false);
  const [newTitle, setNewTitle]     = useState("");
  const [saving, setSaving]         = useState(false);

  const doneCount = phase.pm_tasks.filter(t => t.status === "done").length;

  async function createTask() {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pm/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseId: phase.id, projectNsId, title: newTitle.trim() }),
      });
      const d = await res.json();
      if (d.task) { onTaskAdded(d.task); setNewTitle(""); setAddingTask(false); }
    } finally { setSaving(false); }
  }

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Phase header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: C.alt, borderRadius: expanded ? "6px 6px 0 0" : 6, border: `1px solid ${C.border}`, cursor: "pointer", userSelect: "none" }}
      >
        <span style={{ fontSize: 11, color: C.textSub, width: 12 }}>{expanded ? "▼" : "▶"}</span>
        {phase.color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: phase.color, flexShrink: 0 }} />}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>{phase.name}</span>
        <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub }}>{doneCount}/{phase.pm_tasks.length}</span>
        <div style={{ width: 60, height: 4, background: C.border, borderRadius: 2 }}>
          <div style={{ height: "100%", borderRadius: 2, background: C.green, width: phase.pm_tasks.length > 0 ? `${(doneCount / phase.pm_tasks.length) * 100}%` : "0%", transition: "width 0.3s" }} />
        </div>
      </div>

      {expanded && (
        <div style={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 6px 6px", overflow: "hidden" }}>
          {phase.pm_tasks.length === 0 && !addingTask && (
            <div style={{ padding: "10px 14px", color: C.textSub, fontSize: 12, textAlign: "center" }}>No tasks yet</div>
          )}
          {phase.pm_tasks.map(task => {
            const ss = taskStatusStyle(task.status);
            const overdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== "done";
            return (
              <div
                key={task.id}
                onClick={() => onTaskClick(task)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = C.alt)}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: ss.bg, color: ss.color, whiteSpace: "nowrap" }}>{ss.label}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
                {task.assignee_name && <span style={{ fontSize: 11, color: C.textSub, whiteSpace: "nowrap" }}>{task.assignee_name.split(" ")[0]}</span>}
                {task.due_date && (
                  <span style={{ fontSize: 11, fontFamily: C.mono, color: overdue ? C.red : C.textSub, whiteSpace: "nowrap" }}>{fmtDate(task.due_date)}</span>
                )}
                {(task.time_estimate != null || task.time_logged > 0) && (
                  <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub, whiteSpace: "nowrap" }}>
                    {fmtH(task.time_logged) ?? "0h"}{task.time_estimate ? `/${fmtH(task.time_estimate)}` : ""}
                  </span>
                )}
                {task.priority === "urgent" && <span style={{ fontSize: 9, color: C.red }}>●</span>}
                {task.priority === "high"   && <span style={{ fontSize: 9, color: C.orange }}>●</span>}
              </div>
            );
          })}

          {/* Add task */}
          {addingTask ? (
            <div style={{ display: "flex", gap: 8, padding: "8px 12px" }}>
              <input
                autoFocus
                placeholder="Task name…"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") createTask(); if (e.key === "Escape") { setAddingTask(false); setNewTitle(""); } }}
                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.blue}`, fontSize: 12, fontFamily: C.font, outline: "none" }}
              />
              <button onClick={createTask} disabled={saving} style={{ padding: "5px 12px", borderRadius: 6, background: C.blue, color: "#fff", border: "none", fontSize: 12, cursor: "pointer" }}>Add</button>
              <button onClick={() => { setAddingTask(false); setNewTitle(""); }} style={{ padding: "5px 10px", borderRadius: 6, background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontSize: 12, cursor: "pointer" }}>Cancel</button>
            </div>
          ) : (
            <div
              onClick={() => setAddingTask(true)}
              style={{ padding: "6px 12px", color: C.textSub, fontSize: 12, cursor: "pointer" }}
              onMouseEnter={e => (e.currentTarget.style.color = C.blue)}
              onMouseLeave={e => (e.currentTarget.style.color = C.textSub)}
            >
              + Add task
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ClickUp NotePanel (legacy — used with ClickUp task IDs) ──────────────────

function NotePanel({ taskId, projectNsId, notes, approvals, onNoteAdded }: {
  taskId: string; projectNsId: string; notes: PMNote[]; approvals: PMApproval[]; onNoteAdded: (n: PMNote) => void;
}) {
  const [body, setBody]           = useState("");
  const [isInternal, setInternal] = useState(false);
  const [saving, setSaving]       = useState(false);
  const taskNotes     = notes.filter(n => n.clickup_task_id === taskId);
  const taskApprovals = approvals.filter(a => a.clickup_task_id === taskId);

  async function submit() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pm/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clickupTaskId: taskId, projectNsId, body: body.trim(), isInternal }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      onNoteAdded(d.note); setBody("");
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  }

  function fmtTs(s: string) {
    return new Date(s).toLocaleDateString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div style={{ padding: "14px 16px 16px", background: "#F8FAFF", borderTop: `1px solid ${C.border}` }}>
      {taskApprovals.map(ap => (
        <div key={ap.clickup_task_id} style={{ marginBottom: 10, padding: "8px 12px", background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, fontSize: 12, color: C.green, fontWeight: 600 }}>
          ✅ Approved by {ap.approved_by_name} · {new Date(ap.approved_at).toLocaleDateString("en-AU")}
          {ap.notes && <div style={{ fontWeight: 400, marginTop: 2 }}>{ap.notes}</div>}
        </div>
      ))}
      <div style={{ marginBottom: taskNotes.length > 0 ? 14 : 0 }}>
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Add a note…" rows={2}
          style={{ width: "100%", padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, fontFamily: C.font, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.textMid, cursor: "pointer" }}>
            <input type="checkbox" checked={isInternal} onChange={e => setInternal(e.target.checked)} style={{ accentColor: C.blue }} />
            🔒 Internal
          </label>
          <button onClick={submit} disabled={!body.trim() || saving} style={{ marginLeft: "auto", padding: "5px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, opacity: !body.trim() || saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Add Note"}
          </button>
        </div>
      </div>
      {taskNotes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {taskNotes.map(n => (
            <div key={n.id} style={{ padding: "8px 11px", borderRadius: 8, background: n.is_internal ? C.yellowBg : n.author_type === "customer" ? C.blueBg : C.surface, border: `1px solid ${n.is_internal ? C.yellowBd : n.author_type === "customer" ? C.blueBd : C.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{n.author_name}</span>
                {n.is_internal && <span style={{ background: C.yellowBg, color: C.yellow, border: `1px solid ${C.yellowBd}`, borderRadius: 5, padding: "0 5px", fontSize: 9 }}>🔒 INTERNAL</span>}
                {n.author_type === "customer" && <span style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 5, padding: "0 5px", fontSize: 9 }}>CUSTOMER</span>}
                <span style={{ marginLeft: "auto", fontWeight: 400 }}>{fmtTs(n.created_at)}</span>
              </div>
              <div style={{ fontSize: 12, color: C.text, whiteSpace: "pre-wrap" }}>{n.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

interface Props { projects: Project[] }

export function ProjectManagementView({ projects }: Props) {
  // Native task state
  const [nativePhases, setNativePhases] = useState<Map<number, PMPhase[]>>(new Map());
  const [loadingPhases, setLP]          = useState<Set<number>>(new Set());

  // UI state
  const [filterProject, setFilter]     = useState<string>("all");
  const [selectedTask, setSelectedTask] = useState<PMTask | null>(null);
  const [selectedTaskProjId, setSTPI]  = useState<number | null>(null);
  const [inviteFor, setInviteFor]       = useState<{ id: number; name: string } | null>(null);
  const [importing, setImporting]       = useState<number | null>(null);
  const [addingPhase, setAddingPhase]   = useState<number | null>(null);
  const [newPhaseName, setNPName]       = useState("");

  // ClickUp legacy state (for non-migrated projects)
  const [expandedProjs, setExpandedProjs] = useState<Set<number>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [legacyNotes, setLegacyNotes]     = useState<Record<string, PMNote[]>>({});
  const [legacyApprovals, setLegacyApprovals] = useState<Record<string, PMApproval[]>>({});
  const [legacyAccess, setLegacyAccess]   = useState<Record<string, PortalAccess[]>>({});
  const [loadingLegacy, setLoadingLegacy] = useState<Set<string>>(new Set());

  const activeProjects = projects.filter(p => !p.isInternal);
  const filtered = filterProject === "all" ? activeProjects : activeProjects.filter(p => String(p.id) === filterProject);

  // Load native phases for visible projects
  const loadNativePhases = useCallback(async (projectId: number) => {
    if (nativePhases.has(projectId) || loadingPhases.has(projectId)) return;
    setLP(s => new Set(s).add(projectId));
    try {
      const res = await fetch(`/api/pm/phases?projectId=${projectId}`);
      const d = await res.json();
      setNativePhases(m => new Map(m).set(projectId, d.phases ?? []));
    } finally {
      setLP(s => { const n = new Set(s); n.delete(projectId); return n; });
    }
  }, [nativePhases, loadingPhases]);

  useEffect(() => {
    for (const p of filtered) loadNativePhases(p.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.map(p => p.id).join(",")]);

  // Load legacy ClickUp notes/approvals/access
  const loadLegacyData = useCallback(async (projectId: number) => {
    const key = String(projectId);
    if (loadingLegacy.has(key) || legacyNotes[key]) return;
    setLoadingLegacy(s => new Set(s).add(key));
    try {
      const [nr, ar, acr] = await Promise.all([
        fetch(`/api/pm/notes?projectId=${projectId}`),
        fetch(`/api/pm/approvals?projectId=${projectId}`),
        fetch(`/api/pm/portal-access?projectId=${projectId}`),
      ]);
      const [nd, ad, acd] = await Promise.all([nr.json(), ar.json(), acr.json()]);
      setLegacyNotes(p => ({ ...p, [key]: nd.notes ?? [] }));
      setLegacyApprovals(p => ({ ...p, [key]: ad.approvals ?? [] }));
      setLegacyAccess(p => ({ ...p, [key]: acd.access ?? [] }));
    } finally {
      setLoadingLegacy(s => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [legacyNotes, loadingLegacy]);

  // Native task helpers
  function updateTaskInPhases(projectId: number, updated: PMTask) {
    setNativePhases(m => {
      const phases = m.get(projectId) ?? [];
      return new Map(m).set(projectId, phases.map(ph => ({
        ...ph,
        pm_tasks: ph.pm_tasks.map(t => t.id === updated.id ? updated : t),
      })));
    });
    if (selectedTask?.id === updated.id) setSelectedTask(updated);
  }

  function addTaskToPhase(projectId: number, task: PMTask) {
    setNativePhases(m => {
      const phases = m.get(projectId) ?? [];
      return new Map(m).set(projectId, phases.map(ph =>
        ph.id !== task.phase_id ? ph : { ...ph, pm_tasks: [...ph.pm_tasks, task] },
      ));
    });
  }

  function deleteTaskFromPhases(projectId: number, taskId: string) {
    setNativePhases(m => {
      const phases = m.get(projectId) ?? [];
      return new Map(m).set(projectId, phases.map(ph => ({
        ...ph, pm_tasks: ph.pm_tasks.filter(t => t.id !== taskId),
      })));
    });
    setSelectedTask(null); setSTPI(null);
  }

  async function addPhase(projectId: number) {
    if (!newPhaseName.trim()) return;
    const res = await fetch("/api/pm/phases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectNsId: String(projectId), name: newPhaseName.trim() }),
    });
    const d = await res.json();
    if (d.phase) {
      setNativePhases(m => new Map(m).set(projectId, [...(m.get(projectId) ?? []), { ...d.phase, pm_tasks: [] }]));
      setNPName(""); setAddingPhase(null);
    }
  }

  async function importFromClickUp(project: Project) {
    if (!project.clickupListId) { alert("No ClickUp list ID found for this project."); return; }
    if (!confirm(`Import "${project.label}" tasks from ClickUp?\n\nThis creates the 5 CEBA delivery phases and migrates all current tasks. Tasks can be reorganised afterwards.`)) return;
    setImporting(project.id);
    try {
      const res = await fetch("/api/pm/import/clickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectNsId: String(project.id), clickupListId: project.clickupListId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      alert(d.message);
      setNativePhases(m => { const n = new Map(m); n.delete(project.id); return n; });
      await loadNativePhases(project.id);
    } catch (e) { alert(`Import failed: ${e instanceof Error ? e.message : e}`); }
    finally { setImporting(null); }
  }

  const statusStyle = (s: string) =>
    STATUS_STYLES[s.toLowerCase()] ?? { bg: C.alt, color: C.textMid, bd: C.border, label: s };
  const fmtDue = (ms: string | null) => ms ? new Date(parseInt(ms)).toLocaleDateString("en-AU", { day: "2-digit", month: "short" }) : null;
  const fmtHours = (ms: number | null) => ms == null ? null : ((ms / 3_600_000) % 1 === 0 ? String(ms / 3_600_000) : (ms / 3_600_000).toFixed(1)) + "h";

  return (
    <div style={{ fontFamily: C.font }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Project Management</div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>{activeProjects.length} active projects</div>
        </div>
        <select
          value={filterProject}
          onChange={e => setFilter(e.target.value)}
          style={{ padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontFamily: C.font, color: C.text, background: C.surface, outline: "none" }}
        >
          <option value="all">All Projects</option>
          {activeProjects.map(p => <option key={p.id} value={String(p.id)}>{p.label}</option>)}
        </select>
      </div>

      {/* Projects */}
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {filtered.map(project => {
          const phases   = nativePhases.get(project.id);
          const isLoading = loadingPhases.has(project.id);
          const hasNative = phases !== undefined && phases.length > 0;
          const notYetMigrated = phases !== undefined && phases.length === 0;
          const projKey = String(project.id);

          return (
            <div key={project.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.sh }}>
              {/* Project header */}
              <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.alt, borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{project.label}</div>
                  <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>{project.projectType} · {project.pm}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {hasNative && (
                    <button
                      onClick={() => setAddingPhase(p => p === project.id ? null : project.id)}
                      style={{ padding: "4px 11px", fontSize: 11, fontWeight: 600, borderRadius: 7, cursor: "pointer", background: C.surface, color: C.textMid, border: `1px solid ${C.border}` }}
                    >
                      + Phase
                    </button>
                  )}
                  <button
                    onClick={() => setInviteFor({ id: project.id, name: project.label })}
                    style={{ padding: "4px 11px", fontSize: 11, fontWeight: 700, borderRadius: 7, cursor: "pointer", background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}` }}
                  >
                    👥 Invite
                  </button>
                </div>
              </div>

              <div style={{ padding: "14px 18px" }}>
                {isLoading && (
                  <div style={{ padding: "12px 0", fontSize: 12, color: C.textSub }}>Loading tasks…</div>
                )}

                {/* ── Native task view ── */}
                {hasNative && (
                  <div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {phases!.map(phase => (
                        <PhaseSection
                          key={phase.id}
                          phase={phase}
                          projectNsId={projKey}
                          onTaskClick={t => { setSelectedTask(t); setSTPI(project.id); }}
                          onTaskAdded={t => addTaskToPhase(project.id, t)}
                        />
                      ))}
                    </div>
                    {addingPhase === project.id && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8, padding: "8px 12px", background: C.alt, borderRadius: 6, border: `1px solid ${C.border}` }}>
                        <input
                          autoFocus
                          placeholder="Phase name…"
                          value={newPhaseName}
                          onChange={e => setNPName(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") addPhase(project.id); if (e.key === "Escape") { setAddingPhase(null); setNPName(""); } }}
                          style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.blue}`, fontSize: 12, fontFamily: C.font, outline: "none" }}
                        />
                        <button onClick={() => addPhase(project.id)} style={{ padding: "5px 12px", borderRadius: 6, background: C.blue, color: "#fff", border: "none", fontSize: 12, cursor: "pointer" }}>Add</button>
                        <button onClick={() => { setAddingPhase(null); setNPName(""); }} style={{ padding: "5px 10px", borderRadius: 6, background: C.surface, color: C.textMid, border: `1px solid ${C.border}`, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Import banner (no phases yet) ── */}
                {notYetMigrated && !isLoading && (
                  <div style={{ padding: "14px 16px", borderRadius: 8, background: C.blueBg, border: `1px solid ${C.blueBd}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: C.blue, marginBottom: 4 }}>No native tasks yet</div>
                      <div style={{ fontSize: 12, color: C.textMid }}>
                        {project.clickupListId
                          ? "Import from ClickUp to migrate tasks, or add phases manually."
                          : "Add your first phase to start managing tasks natively."}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      {project.clickupListId && (
                        <button
                          onClick={() => importFromClickUp(project)}
                          disabled={importing === project.id}
                          style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontWeight: 600 }}
                        >
                          {importing === project.id ? "Importing…" : "↓ Import from ClickUp"}
                        </button>
                      )}
                      <button
                        onClick={() => setAddingPhase(project.id)}
                        style={{ padding: "7px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer", background: C.surface, color: C.textMid, border: `1px solid ${C.border}` }}
                      >
                        + Add Phase
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Legacy ClickUp task list (phases not yet checked / still loading) ── */}
                {phases === undefined && !isLoading && (
                  <div>
                    {/* Expand/collapse ClickUp tasks */}
                    <div
                      onClick={() => {
                        const expanding = !expandedProjs.has(project.id);
                        setExpandedProjs(prev => { const s = new Set(prev); expanding ? s.add(project.id) : s.delete(project.id); return s; });
                        if (expanding) loadLegacyData(project.id);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 12, color: C.textSub }}
                    >
                      <span>{expandedProjs.has(project.id) ? "▼" : "▶"}</span>
                      <span>ClickUp tasks ({project.tasks.length})</span>
                      {project.blocked.length > 0 && <span style={{ color: C.red, fontWeight: 700 }}>· ⚠ {project.blocked.length} blocked</span>}
                    </div>
                    {expandedProjs.has(project.id) && (
                      <div>
                        {loadingLegacy.has(projKey) && <div style={{ padding: "8px 0", fontSize: 12, color: C.textSub }}>Loading…</div>}
                        {(legacyAccess[projKey] ?? []).length > 0 && (
                          <div style={{ padding: "6px 12px", background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 6, fontSize: 12, color: C.green, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                            👥 <strong>Portal access:</strong> {(legacyAccess[projKey] ?? []).map(a => a.customer_portal_users?.email ?? a.customer_ns_id).join(", ")}
                          </div>
                        )}
                        {/* Column headers */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px 70px 70px 70px 28px", padding: "5px 12px", background: C.alt, borderRadius: 6, fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", gap: 8, marginBottom: 2 }}>
                          <div>Task</div><div>Status</div><div>Assignee</div>
                          <div style={{ textAlign: "right" }}>Due</div>
                          <div style={{ textAlign: "right" }}>Est</div>
                          <div style={{ textAlign: "right" }}>Logged</div>
                          <div />
                        </div>
                        {project.tasks.map((task, ti) => {
                          const ss = statusStyle(task.status.status);
                          const isOpen = expandedTasks.has(task.id);
                          const taskNotes = (legacyNotes[projKey] ?? []);
                          const isApproved = (legacyApprovals[projKey] ?? []).some(a => a.clickup_task_id === task.id);
                          const isOverdue = !!task.due_date && parseInt(task.due_date) < Date.now() && !["done", "complete", "supplied"].includes(task.status.status.toLowerCase());
                          const isBlocked = task.status.status.toLowerCase() === "on hold" || task.status.status.toLowerCase() === "blocked" || task.tags.some(t => t.name.toLowerCase() === "blocked");
                          const isClient  = task.status.status.toLowerCase() === "awaiting confirmation" || task.tags.some(t => t.name.toLowerCase() === "client");
                          return (
                            <div key={task.id} style={{ borderBottom: ti < project.tasks.length - 1 ? `1px solid ${C.border}` : "none" }}>
                              <div
                                onClick={() => setExpandedTasks(s => { const n = new Set(s); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; })}
                                style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px 70px 70px 70px 28px", padding: "8px 12px", alignItems: "center", gap: 8, background: isOpen ? "#F0F7FF" : ti % 2 === 0 ? C.surface : C.alt, cursor: "pointer", borderRadius: isOpen ? "6px 6px 0 0" : 6 }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                  <span style={{ color: C.textSub, fontSize: 10 }}>{isOpen ? "▼" : "▶"}</span>
                                  <span style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</span>
                                  {isBlocked  && <span style={{ fontSize: 9, fontWeight: 700, background: C.redBg,    color: C.red,    border: `1px solid ${C.redBd}`,    borderRadius: 5, padding: "1px 4px", flexShrink: 0 }}>⚠ Blocked</span>}
                                  {isClient   && <span style={{ fontSize: 9, fontWeight: 700, background: C.orangeBg, color: C.orange, border: `1px solid ${C.orangeBd}`, borderRadius: 5, padding: "1px 4px", flexShrink: 0 }}>👤 Client</span>}
                                  {isApproved && <span style={{ fontSize: 9, fontWeight: 700, background: C.greenBg,  color: C.green,  border: `1px solid ${C.greenBd}`,  borderRadius: 5, padding: "1px 4px", flexShrink: 0 }}>✅</span>}
                                  {taskNotes.filter(n => n.clickup_task_id === task.id).length > 0 && <span style={{ fontSize: 9, color: C.textSub, flexShrink: 0 }}>💬{taskNotes.filter(n => n.clickup_task_id === task.id).length}</span>}
                                </div>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 7, background: ss.bg, color: ss.color, border: `1px solid ${ss.bd}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ss.label ?? task.status.status}</span>
                                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                                  {task.assignees.slice(0, 2).map(a => (
                                    <span key={a.id} style={{ fontSize: 10, background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 9, padding: "1px 5px" }}>{a.username}</span>
                                  ))}
                                </div>
                                <div style={{ textAlign: "right", fontSize: 11, fontFamily: C.mono, color: isOverdue ? C.red : C.textSub }}>{fmtDue(task.due_date) ?? "—"}</div>
                                <div style={{ textAlign: "right", fontSize: 11, fontFamily: C.mono, color: C.textSub }}>{fmtHours(task.time_estimate) ?? "—"}</div>
                                <div style={{ textAlign: "right", fontSize: 11, fontFamily: C.mono, color: C.textMid }}>{fmtHours(task.time_spent) ?? "—"}</div>
                                <a href={task.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: C.blue, fontSize: 13, textDecoration: "none", textAlign: "center" }}>↗</a>
                              </div>
                              {isOpen && (
                                <NotePanel
                                  taskId={task.id}
                                  projectNsId={projKey}
                                  notes={legacyNotes[projKey] ?? []}
                                  approvals={legacyApprovals[projKey] ?? []}
                                  onNoteAdded={note => setLegacyNotes(p => ({ ...p, [projKey]: [...(p[projKey] ?? []), note] }))}
                                />
                              )}
                            </div>
                          );
                        })}
                        {project.tasks.length === 0 && <div style={{ padding: "12px", fontSize: 12, color: C.textSub }}>No tasks.</div>}
                        {/* Import from ClickUp button in legacy view */}
                        {project.clickupListId && (
                          <div style={{ marginTop: 12, padding: "10px 12px", background: C.alt, borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: C.textMid }}>Manage tasks natively instead of ClickUp?</span>
                            <button
                              onClick={() => importFromClickUp(project)}
                              disabled={importing === project.id}
                              style={{ padding: "5px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none" }}
                            >
                              {importing === project.id ? "Importing…" : "↓ Import from ClickUp"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task detail panel + backdrop */}
      {selectedTask && selectedTaskProjId !== null && (
        <>
          <div onClick={() => { setSelectedTask(null); setSTPI(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.15)", zIndex: 99 }} />
          <TaskDetailPanel
            task={selectedTask}
            phases={nativePhases.get(selectedTaskProjId) ?? []}
            projectNsId={String(selectedTaskProjId)}
            onClose={() => { setSelectedTask(null); setSTPI(null); }}
            onUpdated={t => updateTaskInPhases(selectedTaskProjId, t)}
            onDeleted={() => deleteTaskFromPhases(selectedTaskProjId, selectedTask.id)}
          />
        </>
      )}

      {/* Invite modal */}
      {inviteFor && (
        <InviteModal
          projectId={inviteFor.id}
          projectName={inviteFor.name}
          onClose={() => setInviteFor(null)}
          onInvited={() => {
            const key = String(inviteFor.id);
            setLegacyAccess(p => ({ ...p, [key]: [] }));
            loadLegacyData(inviteFor.id);
          }}
        />
      )}
    </div>
  );
}
