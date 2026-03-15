"use client";
import { useEffect, useState } from "react";
import { C, STATUS_STYLES } from "@/lib/constants";
import { isDone } from "@/lib/clickup";
import type { CUTask } from "@/lib/types";

interface LastComment {
  text: string;
  author: string;
  date: string;
}

interface Props {
  title: string;
  tasks: CUTask[];
  onClose: () => void;
}

export function TaskModal({ title, tasks, onClose }: Props) {
  const [comments, setComments] = useState<Record<string, LastComment | null>>({});
  const [loadingComments, setLoadingComments] = useState(true);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch last comment for each task
  useEffect(() => {
    if (tasks.length === 0) { setLoadingComments(false); return; }
    const ids = tasks.map(t => t.id).join(",");
    fetch(`/api/task-comments?taskIds=${ids}`)
      .then(r => r.json())
      .then(data => setComments(data.comments ?? {}))
      .catch(() => {/* silently fail — comments are best-effort */})
      .finally(() => setLoadingComments(false));
  }, [tasks]);

  function fmtDue(ms: string | null): { label: string; color: string } {
    if (!ms) return { label: "No due date", color: C.textSub };
    const diff = parseInt(ms) - Date.now();
    const days = Math.round(diff / 86400000);
    if (days < 0)  return { label: `${Math.abs(days)}d overdue`, color: C.red };
    if (days === 0) return { label: "Due today",               color: C.orange };
    if (days <= 7)  return { label: `Due in ${days}d`,         color: C.yellow };
    return {
      label: new Date(parseInt(ms)).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" }),
      color: C.textMid,
    };
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "fixed", top: "50%", left: "50%", zIndex: 201,
        transform: "translate(-50%, -50%)",
        width: "min(760px, 95vw)", maxHeight: "80vh",
        background: "#fff", borderRadius: 14,
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "column",
        fontFamily: C.font,
        overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.alt, flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{title}</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} · click a task name to open in ClickUp
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: `1px solid ${C.border}`, borderRadius: 7,
              padding: "4px 10px", fontSize: 13, cursor: "pointer",
              color: C.textMid, fontFamily: C.font, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Task list */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {tasks.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
              No tasks found.
            </div>
          ) : (
            tasks.map((task, i) => {
              const st      = task.status.status.toLowerCase();
              const style   = STATUS_STYLES[st] ?? { bg: C.alt, color: C.textMid, bd: C.border, label: task.status.status };
              const due     = fmtDue(task.due_date);
              const comment = comments[task.id];
              const loading = loadingComments;

              return (
                <div
                  key={task.id}
                  style={{
                    padding: "14px 20px",
                    borderBottom: i < tasks.length - 1 ? `1px solid ${C.border}` : "none",
                    background: i % 2 === 0 ? "#fff" : C.alt,
                  }}
                >
                  {/* Row 1: status + name + due */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 7px",
                      background: style.bg, color: style.color, border: `1px solid ${style.bd}`,
                      whiteSpace: "nowrap", flexShrink: 0, marginTop: 1,
                    }}>
                      {style.label}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: C.text, flex: 1, lineHeight: 1.4 }}>
                      {task.name}
                    </span>
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
                        padding: "2px 8px", borderRadius: 5, textDecoration: "none",
                        background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`,
                      }}
                    >
                      ↗ ClickUp
                    </a>
                    <span style={{
                      fontSize: 11, fontFamily: C.mono, fontWeight: 600,
                      color: due.color, whiteSpace: "nowrap", flexShrink: 0,
                    }}>
                      {due.label}
                    </span>
                  </div>

                  {/* Row 2: assignees + list */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: comment || loading ? 8 : 0 }}>
                    {task.assignees.length > 0 ? (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {task.assignees.map(a => (
                          <span key={a.id} style={{
                            fontSize: 11, fontWeight: 600, borderRadius: 10, padding: "2px 8px",
                            background: "#E2E8F0", color: C.textMid,
                          }}>
                            {a.username}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: C.textSub, fontStyle: "italic" }}>Unassigned</span>
                    )}
                    <span style={{ fontSize: 11, color: C.textSub, marginLeft: "auto" }}>
                      {task.list.name}
                    </span>
                  </div>

                  {/* Row 3: last comment */}
                  {loading ? (
                    <div style={{ fontSize: 11, color: C.textSub, fontStyle: "italic" }}>Loading last comment…</div>
                  ) : comment ? (
                    <div style={{
                      background: "#F8FAFC", border: `1px solid ${C.border}`,
                      borderRadius: 6, padding: "8px 12px",
                    }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: C.blue,
                          background: C.blueBg, border: `1px solid ${C.blueBd}`,
                          borderRadius: 4, padding: "1px 6px",
                        }}>
                          {comment.author}
                        </span>
                        <span style={{ fontSize: 10, color: C.textSub }}>{comment.date}</span>
                        <span style={{ fontSize: 10, color: C.textSub, marginLeft: "auto" }}>Last comment</span>
                      </div>
                      <p style={{
                        margin: 0, fontSize: 12, color: C.text, lineHeight: 1.5,
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                        maxHeight: 80, overflow: "hidden",
                      }}>
                        {comment.text}
                      </p>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: C.textSub, fontStyle: "italic" }}>No comments</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
