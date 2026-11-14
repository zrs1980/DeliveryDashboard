"use client";
import { useState, useMemo, useEffect } from "react";
import { C } from "@/lib/constants";
import { isDone } from "@/lib/clickup";
import type { CUTask, Project } from "@/lib/types";

/**
 * "Post Deliverables Week End Report" — posts a status report of the selected
 * project's deliverables for the current week (tasks due Mon–Sun) to the
 * project's Slack channel: done ones first with a ✅, then the rest with a ❌,
 * each group followed by its count.
 *
 * The channel is custentity_slack_channel on the NetSuite job, read through
 * /api/projects/folders (Project doesn't carry it). The text is built here so the
 * preview is exactly what gets posted.
 */

interface Props {
  project: Project;
  onClose: () => void;
}

const PRIORITY_LABEL: Record<string, string> = { "1": "Urgent", "2": "High", "3": "Normal", "4": "Low" };

function priorityLabel(task: CUTask): string {
  return PRIORITY_LABEL[task.priority?.orderindex ?? ""] ?? "No priority";
}

function priorityRank(task: CUTask): number {
  const n = parseInt(task.priority?.orderindex ?? "");
  return isNaN(n) ? 5 : n;
}

/** Monday 00:00 of this week → Monday 00:00 of next, local time. */
function currentWeek(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Slack mrkdwn treats &, < and > as control characters. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function taskLine(task: CUTask, icon: string): string {
  const assignees = task.assignees.map(a => a.username).join(", ") || "Unassigned";
  const name = task.url ? `<${task.url}|${esc(task.name)}>` : esc(task.name);
  return `${icon} ${name}  ·  Priority: ${priorityLabel(task)}  ·  ${esc(assignees)}`;
}

function buildReport(project: Project, sentAt: Date): { text: string; done: number; open: number } {
  const { start, end } = currentWeek();
  const thisWeek = project.tasks.filter(t => {
    if (!t.due_date) return false;
    const due = parseInt(t.due_date);
    return due >= start.getTime() && due < end.getTime();
  });
  const byPriority = (a: CUTask, b: CUTask) =>
    priorityRank(a) - priorityRank(b) || a.name.localeCompare(b.name);
  const done = thisWeek.filter(isDone).sort(byPriority);
  const open = thisWeek.filter(t => !isDone(t)).sort(byPriority);

  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  const sentLabel = sentAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const lines = [
    `*📋 Weekly Deliverables Status Report — ${sentLabel}*`,
    `_${esc(project.label)} · Week of ${fmtDay(start)} – ${fmtDay(lastDay)}_`,
    "",
    "*Completed*",
    ...(done.length ? done.map(t => taskLine(t, "✅")) : ["_None_"]),
    `*Done deliverables: ${done.length}*`,
    "",
    "*Not completed*",
    ...(open.length ? open.map(t => taskLine(t, "❌")) : ["_None_"]),
    `*Pending deliverables: ${open.length}*`,
  ];
  return { text: lines.join("\n"), done: done.length, open: open.length };
}

export function DeliverablesReportModal({ project, onClose }: Props) {
  const [posting, setPosting] = useState(false);
  const [result,  setResult]  = useState<{ ok: boolean; error?: string } | null>(null);
  const [channel, setChannel] = useState<string | null | undefined>(undefined);  // undefined = loading

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects/folders")
      .then(r => r.json())
      .then((d: { projects?: Array<{ id: number; slackChannel: string | null }> }) => {
        if (cancelled) return;
        setChannel(d.projects?.find(p => p.id === project.id)?.slackChannel ?? null);
      })
      .catch(() => { if (!cancelled) setChannel(null); });
    return () => { cancelled = true; };
  }, [project.id]);

  const report = useMemo(() => buildReport(project, new Date()), [project]);

  async function handlePost() {
    if (!channel) return;
    setPosting(true);
    setResult(null);
    try {
      // Rebuilt at send time so the title carries the date it was actually sent.
      const { text } = buildReport(project, new Date());
      const res  = await fetch("/api/slack/deliverables-report", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ channel, text }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      setResult(data.ok ? { ok: true } : { ok: false, error: data.error ?? "Unknown error" });
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Network error" });
    } finally {
      setPosting(false);
    }
  }

  const canPost = !!channel && !posting;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 999 }} />

      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        zIndex: 1000, width: 640, maxWidth: "calc(100vw - 32px)",
        background: C.surface, borderRadius: 10, boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        fontFamily: C.font, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: C.alt,
        }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Post Deliverables Week End Report</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: C.textSub }}>
              {channel === undefined ? "Finding channel…" : channel ?? "No Slack channel"}
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
            Preview — tasks due this week · {report.done} done · {report.open} pending
          </div>
          <pre style={{
            fontFamily: C.mono, fontSize: 11, lineHeight: 1.6,
            background: C.alt, border: `1px solid ${C.border}`, borderRadius: 6,
            padding: "10px 12px", maxHeight: 340, overflowY: "auto",
            whiteSpace: "pre-wrap", wordBreak: "break-word", color: C.text, margin: 0,
          }}>
            {report.text}
          </pre>
        </div>

        {channel === null && (
          <div style={{
            margin: "0 18px 8px", padding: "8px 12px", borderRadius: 6, fontSize: 12,
            background: C.yellowBg, color: C.yellow, border: `1px solid ${C.yellowBd}`,
          }}>
            This project has no Slack channel. Set custentity_slack_channel on the NetSuite project record.
          </div>
        )}

        {result && (
          <div style={{
            margin: "0 18px 8px", padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: result.ok ? C.greenBg : C.redBg,
            color:      result.ok ? C.green   : C.red,
            border:     `1px solid ${result.ok ? C.greenBd : C.redBd}`,
            whiteSpace: "pre-wrap", lineHeight: 1.5,
          }}>
            {result.ok ? `✓ Posted to ${channel}` : result.error}
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          padding: "12px 18px", borderTop: `1px solid ${C.border}`,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "6px 16px", fontSize: 13, fontWeight: 600, borderRadius: 5,
              border: `1px solid ${C.border}`, background: C.surface, color: C.textMid,
              cursor: "pointer", fontFamily: C.font,
            }}
          >
            {result?.ok ? "Close" : "Cancel"}
          </button>

          {!result?.ok && (
            <button
              onClick={handlePost}
              disabled={!canPost}
              style={{
                padding: "6px 16px", fontSize: 13, fontWeight: 700, borderRadius: 5, border: "none",
                background: canPost ? "#3CB371" : C.textSub, color: "#fff",
                cursor: canPost ? "pointer" : "not-allowed", fontFamily: C.font,
                opacity: canPost ? 1 : 0.7,
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
