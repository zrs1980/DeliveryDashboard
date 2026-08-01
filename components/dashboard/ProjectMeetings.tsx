"use client";
// ─── Meetings recorded against one project ────────────────────────────────────
// Sourced from meeting_processing / meeting_docs, i.e. meetings the Process
// wizard actually filed against this project — not a live Fireflies match.

import { useCallback, useEffect, useMemo, useState } from "react";
import { C, MEETING_TYPES } from "@/lib/constants";

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

  // ── Filters ──
  const [search, setSearch] = useState("");
  const [type, setType]     = useState("all");
  const [from, setFrom]     = useState("");
  const [to, setTo]         = useState("");
  const [needDoc, setNeedDoc]     = useState(false);
  const [needSlack, setNeedSlack] = useState(false);
  const [needTasks, setNeedTasks] = useState(false);

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

  // Only offer types this project actually has, plus the canonical list as a
  // fallback so an older row with a retired type still filters.
  const typeOptions = useMemo(() => {
    const present = new Set(meetings.map(m => m.meetingType).filter(Boolean) as string[]);
    return [...present].sort((a, b) => {
      const ai = MEETING_TYPES.indexOf(a as typeof MEETING_TYPES[number]);
      const bi = MEETING_TYPES.indexOf(b as typeof MEETING_TYPES[number]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [meetings]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    // Date inputs are local calendar days; compare against the meeting's local day
    // so a meeting on the boundary date isn't excluded by a timezone shift.
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs   = to   ? new Date(`${to}T23:59:59.999`).getTime() : null;

    return meetings.filter(m => {
      if (type !== "all" && m.meetingType !== type) return false;
      if (needDoc   && !m.docUrl) return false;
      if (needSlack && !m.slackChannel) return false;
      if (needTasks && m.taskCount === 0) return false;
      if (fromMs !== null || toMs !== null) {
        const t = m.date ? Date.parse(m.date) : NaN;
        if (isNaN(t)) return false;                 // undated can't satisfy a range
        if (fromMs !== null && t < fromMs) return false;
        if (toMs   !== null && t > toMs)   return false;
      }
      if (q && !(
        (m.title ?? "").toLowerCase().includes(q) ||
        (m.meetingType ?? "").toLowerCase().includes(q) ||
        (m.processedBy ?? "").toLowerCase().includes(q) ||
        m.tasks.some(t => t.name.toLowerCase().includes(q))
      )) return false;
      return true;
    });
  }, [meetings, search, type, from, to, needDoc, needSlack, needTasks]);

  const anyFilter = !!search || type !== "all" || !!from || !!to || needDoc || needSlack || needTasks;
  const clearAll = () => {
    setSearch(""); setType("all"); setFrom(""); setTo("");
    setNeedDoc(false); setNeedSlack(false); setNeedTasks(false);
  };

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
    fontSize: 12, fontFamily: C.font, color: C.text, background: C.surface, outline: "none",
  };
  const toggleStyle = (on: boolean, fg: string, bg: string, bd: string): React.CSSProperties => ({
    ...inputStyle, cursor: "pointer", fontWeight: on ? 700 : 600, whiteSpace: "nowrap",
    color: on ? fg : C.textMid, background: on ? bg : C.surface, border: `1px solid ${on ? bd : C.border}`,
  });

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

      {/* Filters */}
      {meetings.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Search title, type, person or action item…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 210 }}
          />
          <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="all">All types</option>
            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} aria-label="From date" title="From date" />
          <span style={{ fontSize: 12, color: C.textSub }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} aria-label="To date" title="To date" />

          <button onClick={() => setNeedDoc(v => !v)}   style={toggleStyle(needDoc, C.green, C.greenBg, C.greenBd)}   title="Only meetings with a filed transcript">📄 Transcript</button>
          <button onClick={() => setNeedSlack(v => !v)} style={toggleStyle(needSlack, C.teal, C.tealBg, C.tealBd)}    title="Only meetings posted to Slack">✓ Slack</button>
          <button onClick={() => setNeedTasks(v => !v)} style={toggleStyle(needTasks, C.blue, C.blueBg, C.blueBd)}    title="Only meetings that produced ClickUp tasks">✅ Has tasks</button>

          {anyFilter && (
            <button onClick={clearAll} style={{ ...inputStyle, cursor: "pointer", color: C.textSub }}>Clear filters</button>
          )}

          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
            {filtered.length} of {meetings.length}
          </span>
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
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "34px 0", color: C.textSub, fontSize: 13 }}>
          No meetings match these filters.
          {anyFilter && <> <button onClick={clearAll} style={{ background: "none", border: "none", color: C.blue, cursor: "pointer", fontSize: 13, fontFamily: C.font, padding: 0, textDecoration: "underline" }}>Clear them</button></>}
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.sh, overflow: "hidden" }}>
          {filtered.map((m, i) => {
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
