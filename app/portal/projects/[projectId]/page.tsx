"use client";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { getSupabasePortalClient } from "@/lib/supabase-portal";
import { STATUS_STYLES, C } from "@/lib/constants";

interface PortalNote {
  id: string;
  clickup_task_id: string;
  body: string;
  author_name: string;
  author_type: "staff" | "customer";
  created_at: string;
}

interface PortalApproval {
  clickup_task_id: string;
  approved_by_name: string;
  approved_at: string;
}

interface PortalTask {
  id: string;
  name: string;
  status: string;
  statusColor: string;
  dueDate: string | null;
  isOverdue: boolean;
  assignees: string[];
  tags: string[];
  timeEstimate: number | null;
  timeSpent: number | null;
  isAwaitingConfirmation: boolean;
  isMilestone: boolean;
  isApproved: boolean;
  approval: PortalApproval | null;
  notes: PortalNote[];
  url: string;
}

export default function PortalProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();

  const [tasks,       setTasks]       = useState<PortalTask[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [token,       setToken]       = useState<string | null>(null);
  const [customerNsId, setCustomerNsId] = useState<string | null>(null);
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [noteBody,    setNoteBody]    = useState<Record<string, string>>({});
  const [submitting,  setSubmitting]  = useState<Record<string, boolean>>({});
  const [approving,   setApproving]   = useState<Record<string, boolean>>({});

  useEffect(() => {
    const supabase = getSupabasePortalClient();

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Session expired. Please request a new invite link.");
        setLoading(false);
        return;
      }
      setToken(session.access_token);

      // Resolve customer_ns_id from portal user record
      const { data: pu } = await supabase
        .from("customer_portal_users")
        .select("customer_ns_id")
        .eq("id", session.user.id)
        .single();
      setCustomerNsId(pu?.customer_ns_id ?? null);

      const res = await fetch(`/api/portal/projects/${projectId}/tasks`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to load tasks"); setLoading(false); return; }
      setTasks(data.tasks ?? []);
      setLoading(false);
    }

    load();
  }, [projectId]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submitNote(taskId: string) {
    const body = noteBody[taskId]?.trim();
    if (!body || !token) return;
    setSubmitting(p => ({ ...p, [taskId]: true }));
    try {
      const res = await fetch(`/api/portal/tasks/${taskId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body, projectNsId: projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const note: PortalNote = data.note;
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes: [...t.notes, note] } : t
      ));
      setNoteBody(p => ({ ...p, [taskId]: "" }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add comment");
    } finally {
      setSubmitting(p => ({ ...p, [taskId]: false }));
    }
  }

  async function approveTask(taskId: string) {
    if (!token) return;
    setApproving(p => ({ ...p, [taskId]: true }));
    try {
      const res = await fetch(`/api/portal/tasks/${taskId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectNsId: projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, isApproved: true, approval: data.approval }
          : t
      ));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to approve task");
    } finally {
      setApproving(p => ({ ...p, [taskId]: false }));
    }
  }

  function fmtDate(ms: string | null) {
    if (!ms) return "—";
    return new Date(parseInt(ms)).toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
  }

  function fmtNoteDate(s: string) {
    return new Date(s).toLocaleDateString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  const statusStyle = (s: string) => {
    const key = s.toLowerCase();
    return STATUS_STYLES[key] ?? { bg: "#F7F9FC", color: "#4A5568", bd: "#E2E5EA", label: s };
  };

  const grouped: Record<string, PortalTask[]> = {
    "Awaiting Your Approval": tasks.filter(t => t.isAwaitingConfirmation && !t.isApproved),
    "In Progress":             tasks.filter(t => !t.isAwaitingConfirmation && !["done","complete","supplied"].includes(t.status.toLowerCase())),
    "Completed":               tasks.filter(t => ["done","complete","supplied"].includes(t.status.toLowerCase()) || t.isApproved),
  };

  return (
    <div style={{ minHeight: "100vh", background: "#EEF1F5", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>

      {/* Header */}
      <header style={{ background: "linear-gradient(135deg,#0A0F1E,#0D1B35)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "0 28px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/ceba-logo.webp" alt="CEBA Solutions" style={{ height: 30, objectFit: "contain" }} />
            <span style={{ color: "#64748B", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Client Portal</span>
          </div>
          <button onClick={() => router.back()} style={{ background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#94A3B8", cursor: "pointer" }}>
            ← Back
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 28px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#8A95A3", fontSize: 14 }}>Loading tasks…</div>
        )}

        {error && (
          <div style={{ background: "#FEF0EF", border: "1px solid #F5B8B5", borderRadius: 10, padding: "16px 20px", color: "#C0392B", fontSize: 14 }}>
            ⚠ {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {Object.entries(grouped).map(([groupLabel, groupTasks]) => {
              if (!groupTasks.length) return null;
              const isApprovalGroup = groupLabel === "Awaiting Your Approval";
              return (
                <div key={groupLabel} style={{ marginBottom: 32 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#0D1117" }}>{groupLabel}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, background: isApprovalGroup ? "#FEF0EF" : "#EBF5FF", color: isApprovalGroup ? "#C0392B" : "#1A56DB", border: `1px solid ${isApprovalGroup ? "#F5B8B5" : "#93C5FD"}`, borderRadius: 10, padding: "1px 7px" }}>
                      {groupTasks.length}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {groupTasks.map(task => {
                      const ss = statusStyle(task.status);
                      const isOpen = expanded.has(task.id);
                      return (
                        <div key={task.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                          {/* Task row */}
                          <div
                            onClick={() => toggleExpand(task.id)}
                            style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
                          >
                            {/* Status badge */}
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: ss.bg, color: ss.color, border: `1px solid ${ss.bd}`, whiteSpace: "nowrap", flexShrink: 0 }}>
                              {ss.label ?? task.status}
                            </span>

                            {/* Name */}
                            <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "#0D1117" }}>
                              {task.isMilestone && <span style={{ marginRight: 5 }}>★</span>}
                              {task.name}
                            </div>

                            {/* Assignees */}
                            {task.assignees.length > 0 && (
                              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                {task.assignees.map(a => (
                                  <span key={a} style={{ fontSize: 10, background: "#F7F9FC", color: "#4A5568", border: "1px solid #E2E5EA", borderRadius: 9, padding: "1px 7px" }}>{a}</span>
                                ))}
                              </div>
                            )}

                            {/* Due date */}
                            {task.dueDate && (
                              <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: task.isOverdue ? "#C0392B" : "#8A95A3", flexShrink: 0 }}>
                                {task.isOverdue ? "⚠ " : ""}{fmtDate(task.dueDate)}
                              </span>
                            )}

                            {/* Approved badge */}
                            {task.isApproved && (
                              <span style={{ fontSize: 10, fontWeight: 700, background: "#E6F7F0", color: "#0C6E44", border: "1px solid #A7E3C4", borderRadius: 8, padding: "2px 7px", flexShrink: 0 }}>
                                ✅ Approved
                              </span>
                            )}

                            {/* Hours */}
                            {task.timeEstimate !== null && (
                              <span style={{ fontSize: 11, color: "#8A95A3", fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
                                {task.timeSpent !== null ? `${task.timeSpent}h / ` : ""}{task.timeEstimate}h
                              </span>
                            )}

                            <span style={{ color: "#8A95A3", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                          </div>

                          {/* Expanded: notes + approve */}
                          {isOpen && (
                            <div style={{ borderTop: "1px solid #E2E5EA", padding: "16px 16px" }}>

                              {/* Approve button */}
                              {task.isAwaitingConfirmation && !task.isApproved && (
                                <div style={{ marginBottom: 16, padding: "12px 16px", background: "#FFF8E6", border: "1px solid #F5D990", borderRadius: 8 }}>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: "#92600A", marginBottom: 8 }}>
                                    ⏳ This task is awaiting your sign-off
                                  </div>
                                  <button
                                    onClick={() => approveTask(task.id)}
                                    disabled={approving[task.id]}
                                    style={{ background: "#0C6E44", color: "#fff", border: "none", borderRadius: 7, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: approving[task.id] ? "not-allowed" : "pointer", opacity: approving[task.id] ? 0.7 : 1, fontFamily: "'DM Sans',sans-serif" }}
                                  >
                                    {approving[task.id] ? "Approving…" : "✓ Approve & Sign Off"}
                                  </button>
                                </div>
                              )}

                              {task.isApproved && task.approval && (
                                <div style={{ marginBottom: 16, padding: "10px 14px", background: "#E6F7F0", border: "1px solid #A7E3C4", borderRadius: 8, fontSize: 12, color: "#0C6E44" }}>
                                  ✅ Approved by <strong>{task.approval.approved_by_name}</strong> on {new Date(task.approval.approved_at).toLocaleDateString("en-AU")}
                                </div>
                              )}

                              {/* Comments */}
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#4A5568", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                                Comments {task.notes.length > 0 && `(${task.notes.length})`}
                              </div>

                              {task.notes.length === 0 && (
                                <div style={{ fontSize: 12, color: "#8A95A3", marginBottom: 12 }}>No comments yet.</div>
                              )}

                              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                                {task.notes.map(note => (
                                  <div key={note.id} style={{ padding: "10px 12px", background: note.author_type === "customer" ? "#EBF5FF" : "#F7F9FC", border: `1px solid ${note.author_type === "customer" ? "#93C5FD" : "#E2E5EA"}`, borderRadius: 8 }}>
                                    <div style={{ fontSize: 11, color: "#4A5568", fontWeight: 600, marginBottom: 4 }}>
                                      {note.author_name} · {fmtNoteDate(note.created_at)}
                                      {note.author_type === "staff" && <span style={{ marginLeft: 6, fontSize: 10, color: "#8A95A3", background: "#F7F9FC", border: "1px solid #E2E5EA", borderRadius: 6, padding: "1px 5px" }}>CEBA</span>}
                                    </div>
                                    <div style={{ fontSize: 13, color: "#0D1117", whiteSpace: "pre-wrap" }}>{note.body}</div>
                                  </div>
                                ))}
                              </div>

                              {/* Add comment */}
                              <div>
                                <textarea
                                  value={noteBody[task.id] ?? ""}
                                  onChange={e => setNoteBody(p => ({ ...p, [task.id]: e.target.value }))}
                                  placeholder="Add a comment…"
                                  rows={2}
                                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #E2E5EA", borderRadius: 7, fontSize: 13, fontFamily: "'DM Sans',sans-serif", resize: "vertical", outline: "none", boxSizing: "border-box" }}
                                />
                                <button
                                  onClick={() => submitNote(task.id)}
                                  disabled={!noteBody[task.id]?.trim() || submitting[task.id]}
                                  style={{ marginTop: 6, background: "#1A56DB", color: "#fff", border: "none", borderRadius: 7, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: (!noteBody[task.id]?.trim() || submitting[task.id]) ? "not-allowed" : "pointer", opacity: (!noteBody[task.id]?.trim() || submitting[task.id]) ? 0.6 : 1, fontFamily: "'DM Sans',sans-serif" }}
                                >
                                  {submitting[task.id] ? "Saving…" : "Post Comment"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
