"use client";
import { useState, useMemo } from "react";
import { C } from "@/lib/constants";
import { isDone, taskBucket } from "@/lib/clickup";
import type { CUTask, Project } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskRow {
  task: CUTask;
  project: Project;
}

interface Props {
  rows: TaskRow[];
  tabLabel: string;
  projectLabel: string;   // "All Projects" or specific client name
  canvasId: string | null;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDueDate(ms: string | null): string {
  if (!ms) return "";
  return new Date(parseInt(ms)).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function buildMarkdown(rows: TaskRow[], tabLabel: string, projectLabel: string): string {
  const now = new Date().toLocaleString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const lines: string[] = [
    "---",
    "",
    `## 📋 Task Update — ${tabLabel} · ${now}`,
    `_View: ${projectLabel}_`,
    "",
  ];

  if (rows.length === 0) {
    lines.push("_No tasks in this view._");
  } else {
    for (const { task, project } of rows) {
      const assignees = task.assignees.map(a => a.username.split(" ")[0]).join(", ") || "Unassigned";
      const due       = task.due_date ? ` · Due ${formatDueDate(task.due_date)}` : "";
      const done      = isDone(task);
      const overdue   = taskBucket(task) === "overdue" && !done;
      const prefix    = overdue ? "🔴 " : "";
      lines.push(`- ${prefix}**[${task.name}](${task.url})** · ${project.client} · ${assignees}${due}`);
    }
  }

  lines.push("");
  lines.push(`_${rows.length} task${rows.length !== 1 ? "s" : ""}_`);

  return lines.join("\n");
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function PostToSlackModal({ rows, tabLabel, projectLabel, canvasId, onClose }: Props) {
  const [posting, setPosting] = useState(false);
  const [result,  setResult]  = useState<{ ok: boolean; error?: string } | null>(null);

  const markdown = useMemo(
    () => buildMarkdown(rows, tabLabel, projectLabel),
    [rows, tabLabel, projectLabel]
  );

  async function handlePost() {
    setPosting(true);
    setResult(null);
    try {
      const res  = await fetch("/api/slack/canvas", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ markdown, canvasId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setResult(data.ok ? { ok: true } : { ok: false, error: data.error ?? "Unknown error" });
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Network error" });
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: 999,
        }}
      />

      {/* Modal */}
      <div style={{
        position:    "fixed",
        top:         "50%",
        left:        "50%",
        transform:   "translate(-50%, -50%)",
        zIndex:      1000,
        width:       580,
        maxWidth:    "calc(100vw - 32px)",
        background:  C.surface,
        borderRadius: 10,
        boxShadow:   "0 8px 40px rgba(0,0,0,0.18)",
        fontFamily:  C.font,
        overflow:    "hidden",
      }}>

        {/* Header */}
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "14px 18px",
          borderBottom:   `1px solid ${C.border}`,
          background:     C.alt,
        }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Post to Slack</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: C.textSub }}>Weekly Deliverables · #oxide</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: C.textSub, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Preview */}
        <div style={{ padding: "14px 18px" }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.textSub,
            textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8,
          }}>
            Preview — will be prepended to canvas
          </div>
          <pre style={{
            fontFamily:   C.mono,
            fontSize:     11,
            lineHeight:   1.6,
            background:   C.alt,
            border:       `1px solid ${C.border}`,
            borderRadius: 6,
            padding:      "10px 12px",
            maxHeight:    300,
            overflowY:    "auto",
            whiteSpace:   "pre-wrap",
            wordBreak:    "break-word",
            color:        C.text,
            margin:       0,
          }}>
            {markdown}
          </pre>
        </div>

        {/* Result */}
        {result && (
          <div style={{
            margin:       "0 18px",
            marginBottom: 8,
            padding:      "8px 12px",
            borderRadius: 6,
            fontSize:     12,
            fontWeight:   600,
            background:   result.ok ? C.greenBg : C.redBg,
            color:        result.ok ? C.green    : C.red,
            border:       `1px solid ${result.ok ? C.greenBd : C.redBd}`,
            // Canvas errors carry an actionable explanation plus the raw Slack code
            // on a second line — preserve the breaks rather than running it together.
            whiteSpace:   "pre-wrap",
            lineHeight:   1.5,
          }}>
            {result.ok
              ? "✓ Posted to Weekly Deliverables"
              : result.error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display:        "flex",
          justifyContent: "flex-end",
          gap:            8,
          padding:        "12px 18px",
          borderTop:      `1px solid ${C.border}`,
        }}>
          <button
            onClick={onClose}
            style={{
              padding:      "6px 16px",
              fontSize:     13,
              fontWeight:   600,
              borderRadius: 5,
              border:       `1px solid ${C.border}`,
              background:   C.surface,
              color:        C.textMid,
              cursor:       "pointer",
              fontFamily:   C.font,
            }}
          >
            {result?.ok ? "Close" : "Cancel"}
          </button>

          {!result?.ok && (
            <button
              onClick={handlePost}
              disabled={posting}
              style={{
                padding:      "6px 16px",
                fontSize:     13,
                fontWeight:   700,
                borderRadius: 5,
                border:       "none",
                background:   posting ? C.textSub : "#3CB371",  // Slack green-ish
                color:        "#fff",
                cursor:       posting ? "not-allowed" : "pointer",
                fontFamily:   C.font,
                opacity:      posting ? 0.7 : 1,
              }}
            >
              {posting ? "Posting…" : "↗ Post to Slack"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
