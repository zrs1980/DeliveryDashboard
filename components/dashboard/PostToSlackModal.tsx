"use client";
import { useState, useMemo, useEffect } from "react";
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
  /** Selected project, whose channel gets the "posted to the canvas" notice. Null for All Projects. */
  projectId: number | null;
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

export function PostToSlackModal({ rows, tabLabel, projectLabel, canvasId, projectId, onClose }: Props) {
  const [posting, setPosting] = useState(false);
  const [result,  setResult]  = useState<{
    ok: boolean; error?: string; noticeChannel?: string | null; noticeError?: string | null;
  } | null>(null);
  // The project's Slack channel (custentity_slack_channel), which Project doesn't
  // carry — same lookup DeliverablesReportModal uses. undefined = still loading.
  const [channel, setChannel] = useState<string | null | undefined>(projectId ? undefined : null);

  // Only notify when writing to the project's own canvas. Without one the post
  // falls back to the workspace default, and "posted in the channel's canva"
  // would send the channel looking for something that isn't there.
  const notifyChannel = canvasId ? channel ?? null : null;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch("/api/projects/folders")
      .then(r => r.json())
      // The route passes the SuiteQL id through as a string — compare as numbers.
      .then((d: { projects?: Array<{ id: number | string; slackChannel: string | null }> }) => {
        if (!cancelled) setChannel(d.projects?.find(p => Number(p.id) === projectId)?.slackChannel ?? null);
      })
      .catch(() => { if (!cancelled) setChannel(null); });
    return () => { cancelled = true; };
  }, [projectId]);

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
        body:    JSON.stringify({ markdown, canvasId, channel: notifyChannel }),
      });
      const data = await res.json() as {
        ok?: boolean; error?: string; noticeChannel?: string | null; noticeError?: string | null;
      };
      setResult(data.ok
        ? { ok: true, noticeChannel: data.noticeChannel ?? null, noticeError: data.noticeError ?? null }
        : { ok: false, error: data.error ?? "Unknown error" });
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
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Post Open Deliverables to Slack</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: C.textSub }}>
              Weekly Deliverables{notifyChannel ? ` · ${notifyChannel}` : ""}
            </span>
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
          <div style={{ marginTop: 8, fontSize: 11, color: C.textSub }}>
            {channel === undefined
              ? "Looking up the project's Slack channel…"
              : notifyChannel
                ? `Then notifies ${notifyChannel}: "@channel the weekly deliverables have been posted in the channel's canva"`
                : !projectId
                  ? "No channel notice — select a project to notify its channel."
                  : !canvasId
                    ? "No channel notice — this project has no Slack Canvas ID, so this goes to the default canvas."
                    : "No channel notice — this project has no Slack channel (custentity_slack_channel)."}
          </div>
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
            {!result.ok
              ? result.error
              : result.noticeChannel
                ? `✓ Posted to the canvas and notified ${result.noticeChannel}`
                : result.noticeError
                  ? `✓ Posted to the canvas — but the channel notice failed:\n${result.noticeError}`
                  : "✓ Posted to Weekly Deliverables"}
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
              disabled={posting || channel === undefined}
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
