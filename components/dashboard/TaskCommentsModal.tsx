"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { C } from "@/lib/constants";
import type { CUComment } from "@/lib/clickup";

interface Props {
  taskId:   string;
  taskName: string;
  taskUrl:  string;
  onClose:  () => void;
}

function formatWhen(ms: string | null): string {
  if (!ms) return "";
  const n = parseInt(ms);
  if (isNaN(n)) return "";
  return new Date(n).toLocaleString("en-AU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function TaskCommentsModal({ taskId, taskName, taskUrl, onClose }: Props) {
  const [comments, setComments] = useState<CUComment[] | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [warning,  setWarning]  = useState<string | null>(null);
  const [draft,    setDraft]    = useState("");
  const [posting,  setPosting]  = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/clickup/comments?taskId=${encodeURIComponent(taskId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setComments(data.comments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load comments.");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // Esc closes — but never mid-post, or the PM loses a comment that may or may
  // not have landed and has no way to tell which.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !posting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, posting]);

  // Pin to the newest comment whenever the thread changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [comments]);

  async function post() {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true); setError(null); setWarning(null);
    try {
      const res = await fetch("/api/clickup/comments", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ taskId, comment: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);

      // Only clear the box once the post is confirmed. Clearing optimistically
      // discards the PM's text on the one path where they'd want it back.
      setDraft("");
      if (data.comments) setComments(data.comments);
      else { setWarning(data.warning ?? null); await load(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post the comment.");
    } finally {
      setPosting(false);
    }
  }

  const notice = (text: string, kind: "error" | "warn") => (
    <div style={{
      margin: "0 18px 10px",
      padding: "8px 11px",
      borderRadius: 6,
      fontSize: 12,
      background: kind === "error" ? C.redBg : C.yellowBg,
      border: `1px solid ${kind === "error" ? C.redBd : C.yellowBd}`,
      color: kind === "error" ? C.red : C.yellow,
    }}>
      {text}
    </div>
  );

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !posting) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{
        background: C.surface,
        borderRadius: 12,
        boxShadow: C.shMd,
        width: "100%", maxWidth: 620,
        maxHeight: "82vh",
        display: "flex", flexDirection: "column",
        fontFamily: C.font,
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>
              ClickUp Comments
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.35 }}>
              {taskName}
            </div>
          </div>
          <a
            href={taskUrl} target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: 11, fontWeight: 600, color: C.blue, background: C.blueBg,
              border: `1px solid ${C.blueBd}`, borderRadius: 5, padding: "3px 8px",
              textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            ↗ Open
          </a>
          <button
            onClick={onClose}
            disabled={posting}
            style={{
              background: "none", border: "none", fontSize: 20, lineHeight: 1,
              color: C.textSub, cursor: posting ? "not-allowed" : "pointer",
              padding: 0, flexShrink: 0, opacity: posting ? 0.4 : 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Thread */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {loading && (
            <div style={{ color: C.textSub, fontSize: 13, padding: "24px 0", textAlign: "center" }}>
              Loading comments…
            </div>
          )}

          {!loading && comments?.length === 0 && (
            <div style={{ color: C.textSub, fontSize: 13, padding: "24px 0", textAlign: "center" }}>
              No comments on this task yet.
            </div>
          )}

          {!loading && (comments ?? []).map(c => (
            <div key={c.id} style={{
              marginBottom: 10,
              padding: "9px 12px",
              background: C.alt,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{c.user}</span>
                <span style={{ fontSize: 11, color: C.textSub }}>{formatWhen(c.date)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {c.text}
              </div>
            </div>
          ))}
        </div>

        {error   && notice(error, "error")}
        {warning && notice(warning, "warn")}

        {/* Composer */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 18px 14px" }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }}
            placeholder="Write a comment…"
            rows={3}
            disabled={posting}
            style={{
              width: "100%", resize: "vertical",
              fontFamily: C.font, fontSize: 12.5, lineHeight: 1.5,
              color: C.text, background: posting ? C.alt : C.surface,
              border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "9px 11px", outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9 }}>
            <span style={{ fontSize: 11, color: C.textSub }}>
              Posts to ClickUp under your name. ⌘/Ctrl + Enter to send.
            </span>
            <button
              onClick={post}
              disabled={posting || !draft.trim()}
              style={{
                marginLeft: "auto",
                padding: "6px 16px", fontSize: 12.5, fontWeight: 700,
                borderRadius: 7, border: "none",
                background: posting || !draft.trim() ? C.mid : C.blue,
                color: "#fff",
                cursor: posting || !draft.trim() ? "not-allowed" : "pointer",
                fontFamily: C.font,
              }}
            >
              {posting ? "Posting…" : "Comment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
