"use client";
import { useState, useEffect, useCallback } from "react";
import { C, STATUS_STYLES } from "@/lib/constants";
import type { Project } from "@/lib/types";

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
  customer_ns_id: string;
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
  invited_at: string;
  customer_portal_users?: { email: string; display_name: string | null };
}

interface InviteModalProps {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onInvited: () => void;
}

function InviteModal({ projectId, projectName, onClose, onInvited }: InviteModalProps) {
  const [customers, setCustomers]   = useState<{ id: number; companyname: string }[]>([]);
  const [selectedCustomer, setSel]  = useState<string>("");
  const [email, setEmail]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [step, setStep]             = useState<"select" | "confirm">("select");

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onInvited();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invite");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 4 }}>Invite Customer to Portal</div>
        <div style={{ fontSize: 12, color: C.textSub, marginBottom: 22 }}>Grant access to: <strong>{projectName}</strong></div>

        {error && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "8px 12px", color: C.red, fontSize: 12, marginBottom: 14 }}>{error}</div>}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>Customer</label>
          <select
            value={selectedCustomer}
            onChange={e => setSel(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontFamily: C.font, color: C.text, background: "#fff", outline: "none" }}
          >
            <option value="">Select customer…</option>
            {customers.map(c => (
              <option key={c.id} value={String(c.id)}>{c.companyname}</option>
            ))}
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
          <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>A magic-link invite email will be sent to this address.</div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>
            Cancel
          </button>
          <button
            onClick={invite}
            disabled={!selectedCustomer || !email || saving}
            style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: (!selectedCustomer || !email || saving) ? "not-allowed" : "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, opacity: (!selectedCustomer || !email || saving) ? 0.6 : 1 }}
          >
            {saving ? "Sending…" : "Send Invite"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Note Panel ───────────────────────────────────────────────────────────────

interface NotePanelProps {
  taskId: string;
  projectNsId: string;
  notes: PMNote[];
  approvals: PMApproval[];
  onNoteAdded: (note: PMNote) => void;
}

function NotePanel({ taskId, projectNsId, notes, approvals, onNoteAdded }: NotePanelProps) {
  const [body,       setBody]       = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [saving,     setSaving]     = useState(false);

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onNoteAdded(data.note);
      setBody("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  function fmtTs(s: string) {
    return new Date(s).toLocaleDateString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div style={{ padding: "14px 16px 16px", background: "#F8FAFF", borderTop: `1px solid ${C.border}` }}>

      {/* Approvals */}
      {taskApprovals.map(ap => (
        <div key={ap.clickup_task_id} style={{ marginBottom: 10, padding: "8px 12px", background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, fontSize: 12, color: C.green, fontWeight: 600 }}>
          ✅ Approved by {ap.approved_by_name} · {ap.approved_by_email} · {new Date(ap.approved_at).toLocaleDateString("en-AU")}
          {ap.notes && <div style={{ fontWeight: 400, marginTop: 2, color: C.green }}>{ap.notes}</div>}
        </div>
      ))}

      {/* Add note form */}
      <div style={{ marginBottom: taskNotes.length > 0 ? 14 : 0 }}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          style={{ width: "100%", padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, fontFamily: C.font, resize: "vertical", outline: "none", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={isInternal}
              onChange={e => setIsInternal(e.target.checked)}
              style={{ accentColor: C.blue }}
            />
            🔒 Internal (not visible to customer)
          </label>
          <button
            onClick={submit}
            disabled={!body.trim() || saving}
            style={{ marginLeft: "auto", padding: "5px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: (!body.trim() || saving) ? "not-allowed" : "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, opacity: (!body.trim() || saving) ? 0.6 : 1 }}
          >
            {saving ? "Saving…" : "Add Note"}
          </button>
        </div>
      </div>

      {/* Existing notes */}
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

interface Props {
  projects: Project[];
}

type ViewMode = "list" | "kanban";

const KANBAN_COLS = ["new", "in progress", "in review", "awaiting confirmation", "done"];

export function ProjectManagementView({ projects }: Props) {
  const [viewMode,      setViewMode]      = useState<ViewMode>("list");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [expandedProjs, setExpandedProjs] = useState<Set<number>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [notes,         setNotes]         = useState<Record<string, PMNote[]>>({});
  const [approvals,     setApprovals]     = useState<Record<string, PMApproval[]>>({});
  const [access,        setAccess]        = useState<Record<string, PortalAccess[]>>({});
  const [loadingNotes,  setLoadingNotes]  = useState<Set<string>>(new Set());
  const [inviteFor,     setInviteFor]     = useState<{ id: number; name: string } | null>(null);

  const activeProjects = projects.filter(p => !p.isInternal);
  const filtered = filterProject === "all"
    ? activeProjects
    : activeProjects.filter(p => String(p.id) === filterProject);

  const loadProjectData = useCallback(async (projectId: number) => {
    const key = String(projectId);
    if (loadingNotes.has(key) || notes[key]) return;
    setLoadingNotes(prev => new Set(prev).add(key));
    try {
      const [notesRes, approvalsRes, accessRes] = await Promise.all([
        fetch(`/api/pm/notes?projectId=${projectId}`),
        fetch(`/api/pm/approvals?projectId=${projectId}`),
        fetch(`/api/pm/portal-access?projectId=${projectId}`),
      ]);
      const [nd, ad, ac] = await Promise.all([notesRes.json(), approvalsRes.json(), accessRes.json()]);
      setNotes(prev => ({ ...prev, [key]: nd.notes ?? [] }));
      setApprovals(prev => ({ ...prev, [key]: ad.approvals ?? [] }));
      setAccess(prev => ({ ...prev, [key]: ac.access ?? [] }));
    } finally {
      setLoadingNotes(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, [notes, loadingNotes]);

  function toggleProject(id: number) {
    setExpandedProjs(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); loadProjectData(id); }
      return next;
    });
  }

  function toggleTask(id: string) {
    setExpandedTasks(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function addNote(projectId: string, note: PMNote) {
    setNotes(prev => ({ ...prev, [projectId]: [...(prev[projectId] ?? []), note] }));
  }

  function fmtDue(ms: string | null) {
    if (!ms) return null;
    const d = new Date(parseInt(ms));
    return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
  }

  function fmtHours(ms: number | null) {
    if (ms === null) return null;
    const h = ms / 3600000;
    return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
  }

  const statusStyle = (s: string) => STATUS_STYLES[s.toLowerCase()] ?? { bg: C.alt, color: C.textMid, bd: C.border, label: s };

  return (
    <div style={{ fontFamily: C.font }}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Project Management</div>
          <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>{activeProjects.length} active projects · task list synced from ClickUp</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            style={{ padding: "7px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontFamily: C.font, color: C.text, background: C.surface, outline: "none" }}
          >
            <option value="all">All Projects</option>
            {activeProjects.map(p => <option key={p.id} value={String(p.id)}>{p.label}</option>)}
          </select>
          {/* View toggle */}
          {(["list", "kanban"] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setViewMode(v)} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 700, borderRadius: 7, border: "none", cursor: "pointer", fontFamily: C.font, background: viewMode === v ? C.blue : C.alt, color: viewMode === v ? "#fff" : C.textMid, transition: "background 0.1s" }}>
              {v === "list" ? "≡ List" : "⬜ Kanban"}
            </button>
          ))}
        </div>
      </div>

      {/* ── List View ─────────────────────────────────────────────────────────── */}
      {viewMode === "list" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(proj => {
            const isExpanded = expandedProjs.has(proj.id);
            const projKey    = String(proj.id);
            const projNotes    = notes[projKey] ?? [];
            const projApprovals = approvals[projKey] ?? [];
            const projAccess   = access[projKey] ?? [];
            const noteCount    = projNotes.length;
            const approvalCount = projApprovals.length;
            const accessCount  = projAccess.length;

            return (
              <div key={proj.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.sh }}>
                {/* Project header */}
                <div
                  onClick={() => toggleProject(proj.id)}
                  style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: isExpanded ? C.blueBg : C.surface, borderBottom: isExpanded ? `1px solid ${C.border}` : "none", transition: "background 0.1s" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 18 }}>{isExpanded ? "▼" : "▶"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{proj.label}</div>
                      <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>
                        {proj.tasks.length} tasks
                        {proj.blocked.length > 0 && <span style={{ marginLeft: 8, color: C.red, fontWeight: 700 }}>· ⚠ {proj.blocked.length} blocked</span>}
                        {proj.clientPending.length > 0 && <span style={{ marginLeft: 8, color: C.orange, fontWeight: 700 }}>· ⏳ {proj.clientPending.length} awaiting</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {noteCount > 0 && <span style={{ fontSize: 11, color: C.textSub }}>💬 {noteCount}</span>}
                    {approvalCount > 0 && <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>✅ {approvalCount}</span>}
                    {accessCount > 0 && (
                      <span style={{ fontSize: 11, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "2px 8px", fontWeight: 700 }}>
                        👥 {accessCount} invited
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); setInviteFor({ id: proj.id, name: proj.label }); }}
                      style={{ padding: "4px 11px", fontSize: 11, fontWeight: 700, borderRadius: 7, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}
                    >
                      + Invite Customer
                    </button>
                  </div>
                </div>

                {/* Task list */}
                {isExpanded && (
                  <div>
                    {loadingNotes.has(projKey) && (
                      <div style={{ padding: "12px 18px", fontSize: 12, color: C.textSub }}>Loading…</div>
                    )}

                    {/* Portal access strip */}
                    {projAccess.length > 0 && (
                      <div style={{ padding: "8px 18px", background: C.greenBg, borderBottom: `1px solid ${C.greenBd}`, fontSize: 12, color: C.green, display: "flex", alignItems: "center", gap: 6 }}>
                        👥 <strong>Customer access:</strong>
                        {projAccess.map(a => (
                          <span key={a.customer_ns_id} style={{ background: "#fff", border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: "1px 8px" }}>
                            {a.project_name} — {a.customer_portal_users?.email ?? a.customer_ns_id}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Column header */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 80px 80px 80px 32px", padding: "6px 18px", background: C.alt, borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", gap: 8 }}>
                      <div>Task</div>
                      <div>Status</div>
                      <div>Assignee</div>
                      <div style={{ textAlign: "right" }}>Due</div>
                      <div style={{ textAlign: "right" }}>Est</div>
                      <div style={{ textAlign: "right" }}>Logged</div>
                      <div />
                    </div>

                    {proj.tasks.length === 0 && (
                      <div style={{ padding: "20px 18px", fontSize: 12, color: C.textSub }}>No tasks found.</div>
                    )}

                    {proj.tasks.map((task, ti) => {
                      const ss          = statusStyle(task.status.status);
                      const isTaskOpen  = expandedTasks.has(task.id);
                      const taskNotes   = projNotes.filter(n => n.clickup_task_id === task.id);
                      const isApproved  = projApprovals.some(a => a.clickup_task_id === task.id);
                      const isOverdue   = !!task.due_date && parseInt(task.due_date) < Date.now() && !["done","complete","supplied"].includes(task.status.status.toLowerCase());
                      const isBlocked   = task.status.status.toLowerCase() === "on hold" || task.status.status.toLowerCase() === "blocked" || task.tags.some(t => t.name.toLowerCase() === "blocked");
                      const isClient    = task.status.status.toLowerCase() === "awaiting confirmation" || task.tags.some(t => t.name.toLowerCase() === "client");

                      return (
                        <div key={task.id} style={{ borderBottom: ti < proj.tasks.length - 1 ? `1px solid ${C.border}` : "none" }}>
                          <div
                            onClick={() => toggleTask(task.id)}
                            style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 80px 80px 80px 32px", padding: "9px 18px", alignItems: "center", gap: 8, background: isTaskOpen ? "#F0F7FF" : ti % 2 === 0 ? C.surface : C.alt, cursor: "pointer", transition: "background 0.08s" }}
                          >
                            {/* Task name + badges */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                              <span style={{ color: C.textSub, fontSize: 11 }}>{isTaskOpen ? "▼" : "▶"}</span>
                              <div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {task.name}
                              </div>
                              {isBlocked && <span style={{ fontSize: 10, fontWeight: 700, background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, borderRadius: 6, padding: "1px 5px", flexShrink: 0 }}>⚠ Blocked</span>}
                              {isClient  && <span style={{ fontSize: 10, fontWeight: 700, background: C.orangeBg, color: C.orange, border: `1px solid ${C.orangeBd}`, borderRadius: 6, padding: "1px 5px", flexShrink: 0 }}>👤 Client</span>}
                              {isApproved && <span style={{ fontSize: 10, fontWeight: 700, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBd}`, borderRadius: 6, padding: "1px 5px", flexShrink: 0 }}>✅</span>}
                              {taskNotes.length > 0 && (
                                <span style={{ fontSize: 10, color: C.textSub, flexShrink: 0 }}>
                                  💬{taskNotes.length}
                                  {taskNotes.some(n => n.is_internal) && "🔒"}
                                </span>
                              )}
                            </div>

                            {/* Status */}
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: ss.bg, color: ss.color, border: `1px solid ${ss.bd}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {ss.label ?? task.status.status}
                            </span>

                            {/* Assignees */}
                            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                              {task.assignees.slice(0, 2).map(a => (
                                <span key={a.id} style={{ fontSize: 10, background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 9, padding: "1px 6px" }}>{a.username}</span>
                              ))}
                            </div>

                            {/* Due */}
                            <div style={{ textAlign: "right", fontSize: 11, fontFamily: C.mono, color: isOverdue ? C.red : C.textSub, whiteSpace: "nowrap" }}>
                              {fmtDue(task.due_date) ?? "—"}
                            </div>

                            {/* Est */}
                            <div style={{ textAlign: "right", fontSize: 11, fontFamily: C.mono, color: C.textSub }}>
                              {fmtHours(task.time_estimate) ?? "—"}
                            </div>

                            {/* Logged */}
                            <div style={{ textAlign: "right", fontSize: 11, fontFamily: C.mono, color: C.textMid }}>
                              {fmtHours(task.time_spent) ?? "—"}
                            </div>

                            {/* Link */}
                            <a
                              href={task.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ color: C.blue, fontSize: 13, textDecoration: "none", textAlign: "center" }}
                              title="Open in ClickUp"
                            >↗</a>
                          </div>

                          {/* Note panel */}
                          {isTaskOpen && (
                            <NotePanel
                              taskId={task.id}
                              projectNsId={projKey}
                              notes={projNotes}
                              approvals={projApprovals}
                              onNoteAdded={note => addNote(projKey, note)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Kanban View ───────────────────────────────────────────────────────── */}
      {viewMode === "kanban" && (
        <div>
          {filtered.map(proj => (
            <div key={proj.id} style={{ marginBottom: 32 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 12 }}>{proj.label}</div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${KANBAN_COLS.length}, 1fr)`, gap: 10, overflowX: "auto" }}>
                {KANBAN_COLS.map(col => {
                  const colTasks = proj.tasks.filter(t => t.status.status.toLowerCase() === col || (col === "done" && ["done","complete","supplied"].includes(t.status.status.toLowerCase())));
                  const ss = statusStyle(col);
                  return (
                    <div key={col}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: ss.color, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                        {ss.label ?? col}
                        <span style={{ background: ss.bg, border: `1px solid ${ss.bd}`, borderRadius: 9, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>{colTasks.length}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {colTasks.map(task => {
                          const projNotes = notes[String(proj.id)] ?? [];
                          const taskNoteCount = projNotes.filter(n => n.clickup_task_id === task.id).length;
                          const isApproved = (approvals[String(proj.id)] ?? []).some(a => a.clickup_task_id === task.id);
                          const isOverdue  = !!task.due_date && parseInt(task.due_date) < Date.now() && col !== "done";
                          return (
                            <div key={task.id}
                              onClick={() => { toggleProject(proj.id); setViewMode("list"); toggleTask(task.id); }}
                              style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", boxShadow: C.sh, cursor: "pointer", transition: "box-shadow 0.1s" }}
                              onMouseEnter={e => (e.currentTarget.style.boxShadow = C.shMd)}
                              onMouseLeave={e => (e.currentTarget.style.boxShadow = C.sh)}
                            >
                              <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 6 }}>{task.name}</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {task.assignees.slice(0,2).map(a => (
                                  <span key={a.id} style={{ fontSize: 9, background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 8, padding: "1px 5px" }}>{a.username}</span>
                                ))}
                                {isOverdue && <span style={{ fontSize: 9, background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "1px 5px", fontWeight: 700 }}>⚠ Overdue</span>}
                                {isApproved && <span style={{ fontSize: 9, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "1px 5px", fontWeight: 700 }}>✅</span>}
                                {taskNoteCount > 0 && <span style={{ fontSize: 9, color: C.textSub }}>💬{taskNoteCount}</span>}
                              </div>
                              {task.due_date && (
                                <div style={{ fontSize: 10, color: isOverdue ? C.red : C.textSub, marginTop: 5, fontFamily: C.mono }}>{fmtDue(task.due_date)}</div>
                              )}
                            </div>
                          );
                        })}
                        {colTasks.length === 0 && (
                          <div style={{ fontSize: 11, color: C.textSub, padding: "10px 0", textAlign: "center" }}>—</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite modal */}
      {inviteFor && (
        <InviteModal
          projectId={inviteFor.id}
          projectName={inviteFor.name}
          onClose={() => setInviteFor(null)}
          onInvited={() => {
            const key = String(inviteFor.id);
            setAccess(prev => ({ ...prev, [key]: [] }));
            loadProjectData(inviteFor.id);
          }}
        />
      )}
    </div>
  );
}
