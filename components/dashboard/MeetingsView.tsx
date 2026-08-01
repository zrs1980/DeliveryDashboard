"use client";
// ─── Meetings ─────────────────────────────────────────────────────────────────
// Past Zoom meetings for the account, from /api/meetings (Zoom Server-to-Server
// OAuth → report/users/{id}/meetings per host).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C } from "@/lib/constants";
import { MeetingPanel, type MeetingTarget } from "./MeetingPanel";

interface Meeting {
  uuid:             string;
  meetingId:        number;
  topic:            string;
  hostId:           string;
  hostName:         string;
  hostEmail:        string;
  startTime:        string;
  endTime:          string | null;
  durationMinutes:  number;
  participantCount: number;
}

interface Summary {
  count: number; totalMinutes: number; totalHours: number;
  avgMinutes: number; participants: number; avgParticipants: number;
}

interface Host { id: string; name: string; email: string }

interface Participant { name: string; email: string; internal: boolean; minutes: number }
interface MeetingParticipants {
  uuid: string;
  external: Participant[];
  internalCount: number;
  total: number;
  unknownCount: number;
  error?: string;
}

const DEFAULT_FROM = "2026-07-01";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtDateTime = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const fmtDayHeading = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "unknown" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtDuration = (mins: number) => {
  if (!mins) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

type SortKey = "start" | "duration" | "participants" | "host" | "topic";

export function MeetingsView() {
  const [from, setFrom]       = useState(DEFAULT_FROM);
  const [to, setTo]           = useState(todayISO);
  const [meetings, setM]      = useState<Meeting[]>([]);
  const [hosts, setHosts]     = useState<Host[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [warnings, setWarn]   = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [needsSetup, setNS]   = useState(false);
  const [updatedAt, setUpd]   = useState<string | null>(null);

  const [openMeeting, setOpenMeeting] = useState<MeetingTarget | null>(null);
  const [hostFilter, setHostFilter] = useState("all");
  const [search, setSearch]         = useState("");
  const [sort, setSort]             = useState<SortKey>("start");
  const [asc, setAsc]               = useState(false);
  const [grouped, setGrouped]       = useState(true);

  // Attendees are one Zoom call per meeting on a rate-limited endpoint, so they're
  // fetched in chunks for the rows actually being shown and cached by uuid.
  const [attendees, setAttendees]       = useState<Record<string, MeetingParticipants>>({});
  const [loadingAtt, setLoadingAtt]     = useState<Set<string>>(new Set());
  const [attProgress, setAttProgress]   = useState<{ done: number; total: number } | null>(null);
  const [externalOnly, setExternalOnly] = useState(false);
  const attRunRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNS(false);
    try {
      const res  = await fetch(`/api/meetings?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok) {
        setNS(!!data.needsSetup);
        throw new Error(data.error ?? "Failed to load meetings");
      }
      setM(data.meetings ?? []);
      setHosts(data.hosts ?? []);
      setSummary(data.summary ?? null);
      setWarn(data.warnings ?? []);
      setUpd(data.updatedAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setM([]); setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /**
   * Fetch attendees for the given meetings in chunks, updating as each lands.
   * `runId` guards against a stale run continuing to write after the date range or
   * host filter changed underneath it.
   */
  const loadAttendees = useCallback(async (uuids: string[]) => {
    const pending = uuids.filter(u => !attendees[u] && !loadingAtt.has(u));
    if (pending.length === 0) return;

    const runId = ++attRunRef.current;
    setLoadingAtt(prev => { const n = new Set(prev); pending.forEach(u => n.add(u)); return n; });
    setAttProgress({ done: 0, total: pending.length });

    const CHUNK = 25;   // matches MAX_PER_REQUEST on the route
    let done = 0;

    for (let i = 0; i < pending.length; i += CHUNK) {
      if (attRunRef.current !== runId) break;   // superseded
      const chunk = pending.slice(i, i + CHUNK);
      try {
        const res  = await fetch("/api/meetings/participants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uuids: chunk }),
        });
        const data = await res.json();
        if (attRunRef.current !== runId) break;
        if (res.ok && data.participants) {
          setAttendees(prev => ({ ...prev, ...data.participants }));
        }
      } catch { /* leave these uuids unresolved; the cell shows a retry affordance */ }
      finally {
        setLoadingAtt(prev => { const n = new Set(prev); chunk.forEach(u => n.delete(u)); return n; });
        done += chunk.length;
        if (attRunRef.current === runId) setAttProgress({ done, total: pending.length });
      }
    }
    if (attRunRef.current === runId) setAttProgress(null);
  }, [attendees, loadingAtt]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const rows = meetings.filter(m =>
      (hostFilter === "all" || m.hostId === hostFilter) &&
      // Only applied once a meeting's attendees are known, so rows don't vanish
      // mid-load; unresolved rows stay visible.
      (!externalOnly || !attendees[m.uuid] || attendees[m.uuid].external.length > 0) &&
      (!q || m.topic.toLowerCase().includes(q) || m.hostName.toLowerCase().includes(q) || m.hostEmail.toLowerCase().includes(q)),
    );
    const dir = asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sort) {
        case "duration":     return (a.durationMinutes - b.durationMinutes) * dir;
        case "participants": return (a.participantCount - b.participantCount) * dir;
        case "host":         return a.hostName.localeCompare(b.hostName) * dir;
        case "topic":        return a.topic.localeCompare(b.topic) * dir;
        default:             return (a.startTime ?? "").localeCompare(b.startTime ?? "") * dir;
      }
    });
  }, [meetings, hostFilter, search, sort, asc, externalOnly, attendees]);

  // Kick off attendee loading for whatever is currently in view. Keyed on the row
  // set so changing host/search/date range fetches only what's newly needed.
  const filteredKey = filtered.map(m => m.uuid).join(",");
  useEffect(() => {
    if (filtered.length > 0) loadAttendees(filtered.map(m => m.uuid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredKey]);

  // Reset the cache when the date range changes — different meetings entirely.
  useEffect(() => {
    setAttendees({});
    setLoadingAtt(new Set());
    attRunRef.current++;
  }, [from, to]);

  // Filtered totals — the API summary covers the whole range, not the current filter.
  const view = useMemo(() => {
    const mins = filtered.reduce((s, m) => s + (m.durationMinutes || 0), 0);
    const ppl  = filtered.reduce((s, m) => s + (m.participantCount || 0), 0);
    return {
      count: filtered.length,
      hours: Math.round((mins / 60) * 10) / 10,
      avg:   filtered.length ? Math.round(mins / filtered.length) : 0,
      ppl,
    };
  }, [filtered]);

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of filtered) {
      const k = dayKey(m.startTime);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return [...map.entries()].sort((a, b) => (asc ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])));
  }, [filtered, asc]);

  const perHost = useMemo(() => {
    const map = new Map<string, { name: string; count: number; minutes: number }>();
    for (const m of filtered) {
      if (!map.has(m.hostId)) map.set(m.hostId, { name: m.hostName, count: 0, minutes: 0 });
      const e = map.get(m.hostId)!;
      e.count++; e.minutes += m.durationMinutes || 0;
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes);
  }, [filtered]);

  const th = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th
      onClick={() => { if (sort === key) setAsc(a => !a); else { setSort(key); setAsc(false); } }}
      style={{
        padding: "8px 12px", fontSize: 10, fontWeight: 700, color: sort === key ? C.blue : C.textSub,
        textTransform: "uppercase", letterSpacing: "0.05em", textAlign: align, cursor: "pointer",
        borderBottom: `1px solid ${C.border}`, background: C.alt, whiteSpace: "nowrap", userSelect: "none",
      }}
    >
      {label}{sort === key ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
    fontSize: 12, fontFamily: C.font, color: C.text, background: C.surface, outline: "none",
  };

  return (
    <div style={{ fontFamily: C.font }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>Meetings</h2>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.textSub }}>
            Past Zoom meetings hosted by the Loop Services account
            {updatedAt && <> · updated {new Date(updatedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}</>}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} aria-label="From date" />
          <span style={{ fontSize: 12, color: C.textSub }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} aria-label="To date" />
          <button
            onClick={load}
            disabled={loading || !from || !to}
            style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: loading ? "wait" : "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Setup / error */}
      {error && (
        <div style={{ background: needsSetup ? C.blueBg : C.redBg, border: `1px solid ${needsSetup ? C.blueBd : C.redBd}`, borderRadius: 8, padding: "14px 18px", marginBottom: 16, color: needsSetup ? C.blue : C.red, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          <div style={{ fontWeight: 700, marginBottom: needsSetup ? 8 : 0 }}>
            {needsSetup ? "Zoom isn't connected yet" : "⚠ Could not load meetings"}
          </div>
          {error}
          {needsSetup && (
            <>
            <ol style={{ margin: "10px 0 0", paddingLeft: 20, color: C.textMid }}>
              <li>At <strong>marketplace.zoom.us</strong> → Develop → Build App, create a <strong>Server-to-Server OAuth</strong> app.</li>
              <li>Under Scopes, add a <strong>User</strong> read scope and a <strong>Report</strong> read scope for meetings, then activate the app.</li>
              <li>Copy Account ID, Client ID and Client Secret into Vercel as <code>ZOOM_ACCOUNT_ID</code>, <code>ZOOM_CLIENT_ID</code>, <code>ZOOM_CLIENT_SECRET</code>.</li>
              <li>Redeploy — Vercel does not pick up new env vars on an existing deployment.</li>
            </ol>
            <div style={{ marginTop: 10, fontSize: 12, color: C.textMid }}>
              If Report scopes aren&apos;t listed at all, the Zoom role of whoever created the app is missing the
              <strong> Usage Reports</strong> permission — Zoom hides scopes the creator&apos;s role doesn&apos;t grant.
              Enable it under Admin → User Management → Roles → (role) → Usage Reports.
            </div>
            </>
          )}
        </div>
      )}

      {/* Per-host warnings */}
      {warnings.length > 0 && (
        <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.yellow, fontSize: 12, lineHeight: 1.6 }}>
          <strong>Some hosts could not be read ({warnings.length}):</strong>
          <ul style={{ margin: "5px 0 0", paddingLeft: 18 }}>
            {warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          {warnings.length > 4 && <div style={{ marginTop: 4 }}>+{warnings.length - 4} more</div>}
        </div>
      )}

      {/* KPI cards */}
      {summary && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {[
            { label: "Meetings",        value: String(view.count),        sub: view.count !== summary.count ? `of ${summary.count} in range` : "in range",       color: C.blue },
            { label: "Total Hours",     value: `${view.hours}h`,          sub: "time in meetings",                                                              color: C.purple },
            { label: "Avg Duration",    value: fmtDuration(view.avg),     sub: "per meeting",                                                                   color: C.teal },
            { label: "Participants",    value: String(view.ppl),          sub: "attendee slots",                                                                color: C.textMid },
            { label: "Hosts",           value: String(perHost.length),    sub: "with meetings",                                                                 color: C.orange },
          ].map(k => (
            <div key={k.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "13px 18px", boxShadow: C.sh, flex: "1 1 0", minWidth: 130 }}>
              <div style={{ fontFamily: C.mono, fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginTop: 5 }}>{k.label}</div>
              <div style={{ fontSize: 10.5, color: C.textSub, marginTop: 1 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {meetings.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 300 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.textSub, fontSize: 13, pointerEvents: "none" }}>🔍</span>
            <input
              placeholder="Search topic or host…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, width: "100%", paddingLeft: 31, boxSizing: "border-box" }}
            />
          </div>
          <select value={hostFilter} onChange={e => setHostFilter(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="all">All hosts ({hosts.length})</option>
            {hosts.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <button
            onClick={() => setExternalOnly(v => !v)}
            title="Show only meetings with at least one attendee outside Loop Services / Loop ERP / CEBA"
            style={{ ...inputStyle, cursor: "pointer", fontWeight: 600, color: externalOnly ? C.orange : C.textMid, borderColor: externalOnly ? C.orangeBd : C.border, background: externalOnly ? C.orangeBg : C.surface }}
          >
            {externalOnly ? "🤝 Client meetings only" : "🤝 All meetings"}
          </button>
          <button
            onClick={() => setGrouped(g => !g)}
            style={{ ...inputStyle, cursor: "pointer", fontWeight: 600, color: grouped ? C.blue : C.textMid, borderColor: grouped ? C.blueBd : C.border, background: grouped ? C.blueBg : C.surface }}
          >
            {grouped ? "📅 Grouped by day" : "☰ Flat list"}
          </button>
          {(search || hostFilter !== "all" || externalOnly) && (
            <button
              onClick={() => { setSearch(""); setHostFilter("all"); setExternalOnly(false); }}
              style={{ ...inputStyle, cursor: "pointer", color: C.textSub }}
            >
              Clear filters
            </button>
          )}
          {attProgress && (
            <span style={{ fontSize: 11, color: C.textSub, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-block", width: 60, height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${Math.round((attProgress.done / Math.max(1, attProgress.total)) * 100)}%`, background: C.blue, transition: "width 0.3s" }} />
              </span>
              attendees {attProgress.done}/{attProgress.total}
            </span>
          )}
        </div>
      )}

      {/* Per-host summary */}
      {perHost.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {perHost.map(h => (
            <span key={h.name} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: C.alt, border: `1px solid ${C.border}`, color: C.textMid }}>
              {h.name} <strong style={{ fontFamily: C.mono, color: C.text }}>{h.count}</strong>
              <span style={{ color: C.textSub }}> · {fmtDuration(h.minutes)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      {loading && meetings.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.textSub, fontSize: 13 }}>
          Loading meetings from Zoom…
        </div>
      ) : !error && filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.textSub }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>
            {meetings.length === 0 ? "No meetings in this range" : "No meetings match the filters"}
          </div>
          <div style={{ fontSize: 12.5 }}>
            {meetings.length === 0
              ? "Zoom only reports meetings that actually started. Try widening the date range."
              : "Try clearing the search or host filter."}
          </div>
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.sh, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {th("topic", "Meeting")}
                <th style={{ padding: "8px 12px", fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", borderBottom: `1px solid ${C.border}`, background: C.alt, whiteSpace: "nowrap", minWidth: 200 }}
                    title="External attendees only — Loop Services / Loop ERP / CEBA addresses are excluded">
                  External Attendees
                </th>
                {th("host", "Host")}
                {th("start", "Started")}
                {th("duration", "Duration", "right")}
                {th("participants", "Total", "right")}
                <th style={{ padding: "8px 12px", background: C.alt, borderBottom: `1px solid ${C.border}`, width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {grouped
                ? byDay.flatMap(([key, rows]) => {
                    const mins = rows.reduce((s, m) => s + (m.durationMinutes || 0), 0);
                    return [
                      <tr key={`d-${key}`}>
                        <td colSpan={7} style={{ padding: "6px 12px", background: C.alt, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textMid }}>
                          {fmtDayHeading(rows[0]?.startTime ?? "")}
                          <span style={{ marginLeft: 8, fontFamily: C.mono, fontWeight: 500, color: C.textSub }}>
                            {rows.length} meeting{rows.length !== 1 ? "s" : ""} · {fmtDuration(mins)}
                          </span>
                        </td>
                      </tr>,
                      ...rows.map((m, i) => <MeetingRow key={m.uuid} m={m} zebra={i % 2 === 1} onOpen={setOpenMeeting} att={attendees[m.uuid]} attLoading={loadingAtt.has(m.uuid)} />),
                    ];
                  })
                : filtered.map((m, i) => <MeetingRow key={m.uuid} m={m} zebra={i % 2 === 1} onOpen={setOpenMeeting} att={attendees[m.uuid]} attLoading={loadingAtt.has(m.uuid)} />)}
            </tbody>
          </table>
        </div>
      )}

      {openMeeting && (
        <MeetingPanel target={openMeeting} onClose={() => setOpenMeeting(null)} />
      )}
    </div>
  );
}

/** Domain from an email, for grouping external attendees by company. */
const domainOf = (email: string) => {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
};

function ExternalAttendeesCell({ att, loading }: { att?: MeetingParticipants; loading: boolean }) {
  if (loading || !att) {
    return <span style={{ fontSize: 11, color: C.mid }}>{loading ? "loading…" : "—"}</span>;
  }
  if (att.error) {
    return <span style={{ fontSize: 11, color: C.orange }} title={att.error}>unavailable</span>;
  }
  if (att.external.length === 0) {
    return (
      <span style={{ fontSize: 11, color: C.textSub }} title={`${att.internalCount} internal attendee(s)`}>
        Internal only
      </span>
    );
  }

  // Group by domain so a client's people read as one company rather than five chips.
  const byDomain = new Map<string, Participant[]>();
  for (const p of att.external) {
    const d = domainOf(p.email) || "no email";
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(p);
  }

  const MAX = 4;
  const shown = att.external.slice(0, MAX);

  return (
    <div title={att.external.map(p => `${p.name}${p.email ? ` <${p.email}>` : ""} · ${p.minutes}m`).join("\n")}>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {shown.map((p, i) => (
          <span
            key={`${p.email || p.name}-${i}`}
            style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 999, background: C.orangeBg, color: C.orange, border: `1px solid ${C.orangeBd}`, whiteSpace: "nowrap", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {p.name || p.email}
          </span>
        ))}
        {att.external.length > MAX && (
          <span style={{ fontSize: 10.5, color: C.textSub, padding: "1px 4px" }}>
            +{att.external.length - MAX}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>
        {[...byDomain.keys()].filter(d => d !== "no email").join(" · ") || "no email on file"}
        {att.internalCount > 0 && <span style={{ color: C.mid }}> · +{att.internalCount} internal</span>}
      </div>
    </div>
  );
}

function MeetingRow({
  m, zebra, onOpen, att, attLoading,
}: { m: Meeting; zebra: boolean; onOpen: (t: MeetingTarget) => void; att?: MeetingParticipants; attLoading: boolean }) {
  const open = () => onOpen({ uuid: m.uuid, topic: m.topic, hostName: m.hostName, startTime: m.startTime });
  return (
    <tr
      style={{ background: zebra ? C.alt : C.surface, cursor: "pointer" }}
      onClick={open}
      title="View meeting notes and transcript"
    >
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, maxWidth: 420 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.topic}>
          {m.topic}
        </div>
        <div style={{ fontSize: 10.5, color: C.textSub, fontFamily: C.mono, marginTop: 2 }}>ID {m.meetingId}</div>
      </td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, verticalAlign: "top" }}>
        <ExternalAttendeesCell att={att} loading={attLoading} />
      </td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 12, color: C.text }}>{m.hostName}</div>
        <div style={{ fontSize: 10.5, color: C.textSub }}>{m.hostEmail}</div>
      </td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textMid, fontFamily: C.mono, whiteSpace: "nowrap" }}>
        {fmtDateTime(m.startTime)}
      </td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text, fontFamily: C.mono, textAlign: "right", whiteSpace: "nowrap" }}>
        {fmtDuration(m.durationMinutes)}
      </td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textMid, fontFamily: C.mono, textAlign: "right" }}>
        {m.participantCount || "—"}
      </td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right", whiteSpace: "nowrap" }}>
        <button
          onClick={e => { e.stopPropagation(); open(); }}
          style={{ padding: "4px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, fontFamily: C.font }}
        >
          📝 Notes
        </button>
      </td>
    </tr>
  );
}
