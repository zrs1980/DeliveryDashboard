"use client";
// ─── Meetings recorded against one project ────────────────────────────────────
// Sourced from meeting_processing / meeting_docs, i.e. meetings the Process
// wizard actually filed against this project — not a live Fireflies match.

import { useCallback, useEffect, useState } from "react";
import { C } from "@/lib/constants";

interface PMMeeting {
  firefliesId:  string;
  title:        string | null;
  date:         string | null;
  meetingType:  string | null;
  docUrl:       string | null;
  docName:      string | null;
  slackChannel: string | null;
  taskCount:    number;
  tasks:        { id: string; name: string; url: string }[];
  processedBy:  string | null;
  processedAt:  string | null;
}

interface Totals { count: number; withDoc: number; withSlack: number; taskCount: number }

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-AU", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
};

export function ProjectMeetings({ projectNsId, projectLabel }: { projectNsId: number | string; projectLabel: string }) {
  const [meetings, setMeetings] = useState<PMMeeting[]>([]);
  const [totals, setTotals]     = useState<Totals | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [warning, setWarning]   = useState<string | null>(null);
  const [openId, setOpenId]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/pm/meetings?projectNsId=${encodeURIComponent(String(projectNsId))}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load meetings");
      setMeetings(data.meetings ?? []);
      setTotals(data.totals ?? null);
      setWarning(data.warning ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, [projectNsId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div style={{ textAlign: "center", padding: "44px 0", color: C.textSub, fontSize: 13, fontFamily: C.font }}>Loading meetings…</div>;
  }

  if (error) {
    return (
      <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: "14px 18px", color: C.red, fontSize: 13, lineHeight: 1.6, fontFamily: C.font }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Could not load meetings</div>
        {error}
        <div><button onClick={load} style={{ marginTop: 10, padding: "6px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: "pointer", background: C.surface, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>Try again</button></div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: C.font }}>
      {warning && (
        <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 14, color: C.yellow, fontSize: 12.5, lineHeight: 1.6 }}>
          {warning}
        </div>
      )}

      {totals && totals.count > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[
            { label: "Meetings",     value: totals.count,     color: C.blue },
            { label: "Transcripts",  value: totals.withDoc,   color: C.green },
            { label: "Posted to Slack", value: totals.withSlack, color: C.purple },
            { label: "Tasks created", value: totals.taskCount, color: C.teal },
          ].map(k => (
            <div key={k.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 16px", boxShadow: C.sh, flex: "1 1 0", minWidth: 120 }}>
              <div style={{ fontFamily: C.mono, fontSize: 19, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, marginTop: 4 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {meetings.length === 0 ? (
        <div style={{ textAlign: "center", padding: "44px 12px", color: C.textSub }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🪰</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>No meetings filed against {projectLabel}</div>
          <div style={{ fontSize: 12.5, maxWidth: 460, margin: "0 auto", lineHeight: 1.6 }}>
            Meetings appear here once they&apos;ve been run through <strong>Process</strong> on the Fireflies Meetings tab
            and tagged to this project. Meetings that were never processed aren&apos;t listed.
          </div>
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.sh, overflow: "hidden" }}>
          {meetings.map((m, i) => {
            const open = openId === m.firefliesId;
            return (
              <div key={m.firefliesId} style={{ borderTop: i === 0 ? "none" : `1px solid ${C.border}` }}>
                <div
                  onClick={() => setOpenId(open ? null : m.firefliesId)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", cursor: m.tasks.length ? "pointer" : "default", background: i % 2 ? C.alt : C.surface }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.title || "(untitled meeting)"}
                    </div>
                    <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
                      {fmtDate(m.date)}
                      {m.processedBy && <> · filed by {m.processedBy}</>}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {m.meetingType && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}`, whiteSpace: "nowrap" }}>
                        {m.meetingType}
                      </span>
                    )}
                    {m.taskCount > 0 && (
                      <span title={m.tasks.map(t => t.name).join("\n")} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, whiteSpace: "nowrap" }}>
                        {m.taskCount} task{m.taskCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {m.slackChannel && (
                      <span title={`Posted to ${m.slackChannel}`} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: C.tealBg, color: C.teal, border: `1px solid ${C.tealBd}`, whiteSpace: "nowrap" }}>
                        ✓ Slack
                      </span>
                    )}
                  </div>

                  {m.docUrl ? (
                    <a
                      href={m.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={m.docName ?? "Open transcript"}
                      onClick={e => e.stopPropagation()}
                      style={{ padding: "4px 11px", borderRadius: 7, fontSize: 11, fontWeight: 700, textDecoration: "none", background: C.greenBg, color: C.green, border: `1px solid ${C.greenBd}`, whiteSpace: "nowrap", flexShrink: 0 }}
                    >
                      ↗ Transcript
                    </a>
                  ) : (
                    <span style={{ fontSize: 10.5, color: C.mid, whiteSpace: "nowrap", flexShrink: 0 }}>not filed</span>
                  )}
                </div>

                {open && m.tasks.length > 0 && (
                  <div style={{ padding: "4px 16px 12px 16px", background: i % 2 ? C.alt : C.surface }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                      Action items created
                    </div>
                    {m.tasks.map(t => (
                      <div key={t.id} style={{ fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: C.textSub }}>· </span>
                        <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, textDecoration: "none" }}>{t.name}</a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
