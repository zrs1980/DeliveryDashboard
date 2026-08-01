"use client";
// ─── Fireflies Meetings ───────────────────────────────────────────────────────
// Same layout as the Zoom Meetings tab, sourced from Fireflies.ai. One GraphQL
// query returns meetings, attendees and summaries together, so the external-
// attendee column is populated immediately — no progressive fetch needed.

import { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/constants";
import { FileToDriveModal } from "./FileToDriveModal";

interface Attendee { name: string; email: string; internal: boolean }
interface Summary {
  overview?: string; shortSummary?: string;
  actionItems: string[]; keywords: string[]; bulletGist: string[];
}
interface Meeting {
  id: string; title: string; date: string; durationMinutes: number;
  organizerEmail: string; meetingLink: string | null; transcriptUrl: string | null;
  attendees: Attendee[]; external: Attendee[]; internalCount: number;
  summary: Summary | null; hasSummary: boolean;
}
interface Organiser { id: string; name: string; email: string }
interface Totals {
  count: number; totalMinutes: number; totalHours: number;
  avgMinutes: number; withSummary: number; withExternal: number;
}

const DEFAULT_FROM = "2026-07-01";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const fmtDayHeading = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "Unknown date" : d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "unknown" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDuration = (mins: number) => {
  if (!mins) return "0m";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const domainOf = (email: string) => {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
};

type SortKey = "start" | "duration" | "attendees" | "organiser" | "title";

export function FirefliesMeetingsView() {
  const [from, setFrom]     = useState(DEFAULT_FROM);
  const [to, setTo]         = useState(todayISO);
  const [meetings, setM]    = useState<Meeting[]>([]);
  const [organisers, setOrg] = useState<Organiser[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [notes, setNotes]   = useState<string[]>([]);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [needsSetup, setNS] = useState(false);
  const [updatedAt, setUpd] = useState<string | null>(null);

  const [orgFilter, setOrgFilter]       = useState("all");
  const [search, setSearch]             = useState("");
  const [sort, setSort]                 = useState<SortKey>("start");
  const [asc, setAsc]                   = useState(false);
  const [grouped, setGrouped]           = useState(true);
  const [externalOnly, setExternalOnly] = useState(false);
  const [openId, setOpenId]             = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoad(true); setError(null); setNS(false);
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const res  = await fetch(`/api/fireflies/meetings?from=${from}&to=${to}&tzOffset=${tzOffset}`);
      const data = await res.json();
      if (!res.ok) { setNS(!!data.needsSetup); throw new Error(data.error ?? "Failed to load"); }
      setM(data.meetings ?? []);
      setOrg(data.organisers ?? []);
      setTotals(data.summary ?? null);
      setNotes(data.notes ?? []);
      setUpd(data.updatedAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setM([]); setTotals(null);
    } finally { setLoad(false); }
  }, [from, to]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const rows = meetings.filter(m =>
      (orgFilter === "all" || m.organizerEmail === orgFilter) &&
      (!externalOnly || m.external.length > 0) &&
      (!q || m.title.toLowerCase().includes(q) ||
             m.organizerEmail.includes(q) ||
             m.attendees.some(a => a.name.toLowerCase().includes(q) || a.email.includes(q)) ||
             (m.summary?.overview ?? "").toLowerCase().includes(q)),
    );
    const dir = asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sort) {
        case "duration":  return (a.durationMinutes - b.durationMinutes) * dir;
        case "attendees": return (a.attendees.length - b.attendees.length) * dir;
        case "organiser": return a.organizerEmail.localeCompare(b.organizerEmail) * dir;
        case "title":     return a.title.localeCompare(b.title) * dir;
        default:          return (a.date ?? "").localeCompare(b.date ?? "") * dir;
      }
    });
  }, [meetings, orgFilter, search, sort, asc, externalOnly]);

  const view = useMemo(() => {
    const mins = filtered.reduce((s, m) => s + (m.durationMinutes || 0), 0);
    return {
      count: filtered.length,
      hours: Math.round((mins / 60) * 10) / 10,
      avg:   filtered.length ? Math.round(mins / filtered.length) : 0,
      withSummary: filtered.filter(m => m.hasSummary).length,
      withExternal: filtered.filter(m => m.external.length > 0).length,
    };
  }, [filtered]);

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of filtered) {
      const k = dayKey(m.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return [...map.entries()].sort((a, b) => (asc ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])));
  }, [filtered, asc]);

  const th = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th
      onClick={() => { if (sort === key) setAsc(a => !a); else { setSort(key); setAsc(false); } }}
      style={{ padding: "8px 12px", fontSize: 10, fontWeight: 700, color: sort === key ? C.blue : C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: align, cursor: "pointer", borderBottom: `1px solid ${C.border}`, background: C.alt, whiteSpace: "nowrap", userSelect: "none" }}
    >
      {label}{sort === key ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
    fontSize: 12, fontFamily: C.font, color: C.text, background: C.surface, outline: "none",
  };

  const openMeeting = meetings.find(m => m.id === openId) ?? null;

  return (
    <div style={{ fontFamily: C.font }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>Fireflies Meetings</h2>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.textSub }}>
            Meetings the Fireflies notetaker attended — includes calls hosted by clients
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
            {needsSetup ? "Fireflies isn't connected yet" : "⚠ Could not load meetings"}
          </div>
          {error}
          {needsSetup && (
            <ol style={{ margin: "10px 0 0", paddingLeft: 20, color: C.textMid }}>
              <li>In Fireflies, go to <strong>Settings → Developer Settings</strong> and copy your <strong>API key</strong>.</li>
              <li>Add it in Vercel as <code>FIREFLIES_API_KEY</code>.</li>
              <li>Redeploy — Vercel does not pick up new env vars on an existing deployment.</li>
            </ol>
          )}
        </div>
      )}

      {notes.length > 0 && (
        <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.yellow, fontSize: 12, lineHeight: 1.6 }}>
          {notes.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      )}

      {/* KPI cards */}
      {totals && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {[
            { label: "Meetings",     value: String(view.count),        sub: view.count !== totals.count ? `of ${totals.count} in range` : "in range", color: C.blue },
            { label: "Total Hours",  value: `${view.hours}h`,          sub: "recorded time",     color: C.purple },
            { label: "Avg Duration", value: fmtDuration(view.avg),     sub: "per meeting",       color: C.teal },
            { label: "With Notes",   value: String(view.withSummary),  sub: "AI summary present", color: C.green },
            { label: "Client Calls", value: String(view.withExternal), sub: "external attendee",  color: C.orange },
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
          <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.textSub, fontSize: 13, pointerEvents: "none" }}>🔍</span>
            <input
              placeholder="Search title, attendee or summary…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, width: "100%", paddingLeft: 31, boxSizing: "border-box" }}
            />
          </div>
          <select value={orgFilter} onChange={e => setOrgFilter(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="all">All organisers ({organisers.length})</option>
            {organisers.map(o => <option key={o.id} value={o.id}>{o.email}</option>)}
          </select>
          <button
            onClick={() => setExternalOnly(v => !v)}
            title="Only meetings with an attendee outside Loop Services / Loop ERP / CEBA"
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
          {(search || orgFilter !== "all" || externalOnly) && (
            <button onClick={() => { setSearch(""); setOrgFilter("all"); setExternalOnly(false); }} style={{ ...inputStyle, cursor: "pointer", color: C.textSub }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {loading && meetings.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.textSub, fontSize: 13 }}>Loading meetings from Fireflies…</div>
      ) : !error && filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.textSub }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🪰</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textMid, marginBottom: 6 }}>
            {meetings.length === 0 ? "No Fireflies meetings in this range" : "No meetings match the filters"}
          </div>
          <div style={{ fontSize: 12.5 }}>
            {meetings.length === 0
              ? "Fireflies only has meetings its notetaker joined. Check your Fireflies calendar connection and auto-join settings."
              : "Try clearing the search or organiser filter."}
          </div>
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.sh, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {th("title", "Meeting")}
                <th style={{ padding: "8px 12px", fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", borderBottom: `1px solid ${C.border}`, background: C.alt, minWidth: 200 }}
                    title="External attendees only — Loop Services / Loop ERP / CEBA addresses excluded">
                  External Attendees
                </th>
                {th("organiser", "Organiser")}
                {th("start", "Started")}
                {th("duration", "Duration", "right")}
                {th("attendees", "Total", "right")}
                <th style={{ padding: "8px 12px", background: C.alt, borderBottom: `1px solid ${C.border}`, width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {grouped
                ? byDay.flatMap(([key, rows]) => {
                    const mins = rows.reduce((s, m) => s + (m.durationMinutes || 0), 0);
                    return [
                      <tr key={`d-${key}`}>
                        <td colSpan={7} style={{ padding: "6px 12px", background: C.alt, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textMid }}>
                          {fmtDayHeading(rows[0]?.date ?? "")}
                          <span style={{ marginLeft: 8, fontFamily: C.mono, fontWeight: 500, color: C.textSub }}>
                            {rows.length} meeting{rows.length !== 1 ? "s" : ""} · {fmtDuration(mins)}
                          </span>
                        </td>
                      </tr>,
                      ...rows.map((m, i) => <Row key={m.id} m={m} zebra={i % 2 === 1} onOpen={setOpenId} />),
                    ];
                  })
                : filtered.map((m, i) => <Row key={m.id} m={m} zebra={i % 2 === 1} onOpen={setOpenId} />)}
            </tbody>
          </table>
        </div>
      )}

      {openMeeting && <FirefliesPanel m={openMeeting} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function ExternalCell({ m }: { m: Meeting }) {
  if (m.external.length === 0) {
    return <span style={{ fontSize: 11, color: C.textSub }} title={`${m.internalCount} internal attendee(s)`}>Internal only</span>;
  }
  const domains = [...new Set(m.external.map(a => domainOf(a.email)).filter(Boolean))];
  const MAX = 4;
  return (
    <div title={m.external.map(a => `${a.name}${a.email ? ` <${a.email}>` : ""}`).join("\n")}>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {m.external.slice(0, MAX).map((a, i) => (
          <span key={`${a.email}-${i}`} style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 999, background: C.orangeBg, color: C.orange, border: `1px solid ${C.orangeBd}`, whiteSpace: "nowrap", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
            {a.name || a.email}
          </span>
        ))}
        {m.external.length > MAX && <span style={{ fontSize: 10.5, color: C.textSub, padding: "1px 4px" }}>+{m.external.length - MAX}</span>}
      </div>
      {domains.length > 0 && (
        <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>
          {domains.join(" · ")}
          {m.internalCount > 0 && <span style={{ color: C.mid }}> · +{m.internalCount} internal</span>}
        </div>
      )}
    </div>
  );
}

function Row({ m, zebra, onOpen }: { m: Meeting; zebra: boolean; onOpen: (id: string) => void }) {
  return (
    <tr style={{ background: zebra ? C.alt : C.surface, cursor: "pointer" }} onClick={() => onOpen(m.id)} title="View notes and transcript">
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, maxWidth: 380 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.title}>
          {m.title}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 3, alignItems: "center" }}>
          {m.hasSummary
            ? <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBd}` }}>📝 Notes</span>
            : <span style={{ fontSize: 9.5, color: C.mid }}>no summary</span>}
          {(m.summary?.actionItems.length ?? 0) > 0 && (
            <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}` }}>
              {m.summary!.actionItems.length} action{m.summary!.actionItems.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, verticalAlign: "top" }}>
        <ExternalCell m={m} />
      </td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textMid, whiteSpace: "nowrap" }}>{m.organizerEmail || "—"}</td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textMid, fontFamily: C.mono, whiteSpace: "nowrap" }}>{fmtDateTime(m.date)}</td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text, fontFamily: C.mono, textAlign: "right", whiteSpace: "nowrap" }}>{fmtDuration(m.durationMinutes)}</td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textMid, fontFamily: C.mono, textAlign: "right" }}>{m.attendees.length || "—"}</td>
      <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.border}`, textAlign: "right", whiteSpace: "nowrap" }}>
        <button
          onClick={e => { e.stopPropagation(); onOpen(m.id); }}
          style={{ padding: "4px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, fontFamily: C.font }}
        >
          📝 Open
        </button>
      </td>
    </tr>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

interface Sentence { index: number; text: string; speaker: string }

function FirefliesPanel({ m, onClose }: { m: Meeting; onClose: () => void }) {
  const [tab, setTab]             = useState<"notes" | "transcript">("notes");
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [loading, setLoading]     = useState(false);
  const [tErr, setTErr]           = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [copied, setCopied]       = useState(false);
  const [filing, setFiling]       = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadTranscript = useCallback(async () => {
    if (sentences || loading) return;
    setLoading(true); setTErr(null);
    try {
      const res  = await fetch(`/api/fireflies/transcript?id=${encodeURIComponent(m.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load transcript");
      setSentences(data.sentences ?? []);
    } catch (e) {
      setTErr(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, [m.id, sentences, loading]);

  const notesText = useMemo(() => {
    const s = m.summary;
    if (!s) return "";
    const out = [m.title];
    if (s.overview)     out.push("", s.overview);
    if (s.bulletGist.length) out.push("", "## Key points", ...s.bulletGist.map(b => `- ${b}`));
    if (s.actionItems.length) out.push("", "## Action items", ...s.actionItems.map(a => `- ${a}`));
    return out.join("\n");
  }, [m]);

  const filteredSentences = useMemo(() => {
    if (!sentences) return [];
    const q = search.toLowerCase().trim();
    return q ? sentences.filter(s => s.text.toLowerCase().includes(q) || s.speaker.toLowerCase().includes(q)) : sentences;
  }, [sentences, search]);

  const btn: React.CSSProperties = {
    padding: "6px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
    background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font,
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 1200 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(680px, 100vw)", background: C.surface, borderLeft: `1px solid ${C.border}`, boxShadow: "-4px 0 28px rgba(0,0,0,0.14)", zIndex: 1201, display: "flex", flexDirection: "column", fontFamily: C.font }}>
        {/* Header */}
        <div style={{ padding: "14px 20px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.title}>{m.title}</div>
              <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 2 }}>
                {m.organizerEmail} · {fmtDateTime(m.date)} · {fmtDuration(m.durationMinutes)}
                {m.external.length > 0 && <> · {m.external.length} external</>}
              </div>
            </div>
            <button onClick={onClose} title="Close (Esc)" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textSub, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
            {([["notes", "📝 Notes"], ["transcript", "🗒️ Transcript"]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setTab(id); if (id === "transcript") loadTranscript(); }}
                style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: tab === id ? 700 : 600, cursor: "pointer", background: "none", border: "none", fontFamily: C.font, color: tab === id ? C.blue : C.textSub, borderBottom: `2px solid ${tab === id ? C.blue : "transparent"}`, marginBottom: -1 }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", minHeight: 0 }}>
          {tab === "notes" ? (
            !m.summary ? (
              <div style={{ textAlign: "center", padding: "34px 10px", color: C.textSub }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>📝</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.textMid, marginBottom: 8 }}>No summary for this meeting</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.65, maxWidth: 400, margin: "0 auto" }}>
                  Fireflies recorded it but hasn&apos;t produced a summary — it may still be processing, or the
                  meeting was too short.
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" }}>
                  <button onClick={async () => { try { await navigator.clipboard.writeText(notesText); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} }} style={btn}>
                    {copied ? "✓ Copied" : "Copy notes"}
                  </button>
                  <button
                    onClick={() => setFiling(true)}
                    title="Create a Google Doc with these notes and the transcript in the customer's project folder"
                    style={{ ...btn, background: C.greenBg, color: C.green, borderColor: C.greenBd, fontWeight: 700 }}
                  >
                    → File to Drive
                  </button>
                  {m.transcriptUrl && (
                    <a href={m.transcriptUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: "none", background: C.blueBg, color: C.blue, borderColor: C.blueBd }}>↗ Fireflies</a>
                  )}
                  {m.meetingLink && (
                    <a href={m.meetingLink} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: "none" }}>↗ Meeting link</a>
                  )}
                </div>

                {m.summary.overview && (
                  <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 8, padding: "12px 15px", marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.blue, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>Overview</div>
                    <div style={{ fontSize: 13, color: C.text, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{m.summary.overview}</div>
                  </div>
                )}

                {m.summary.actionItems.length > 0 && (
                  <div style={{ background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "12px 15px", marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.green, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                      Action items · {m.summary.actionItems.length}
                    </div>
                    {m.summary.actionItems.map((a, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                        <span style={{ color: C.green, fontSize: 12, lineHeight: 1.6, flexShrink: 0 }}>▸</span>
                        <span style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{a}</span>
                      </div>
                    ))}
                  </div>
                )}

                {m.summary.bulletGist.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>Key points</div>
                    {m.summary.bulletGist.map((b, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5 }}>
                        <span style={{ color: C.textSub, fontSize: 12, flexShrink: 0 }}>•</span>
                        <span style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6 }}>{b}</span>
                      </div>
                    ))}
                  </div>
                )}

                {m.summary.keywords.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 14 }}>
                    {m.summary.keywords.map(k => (
                      <span key={k} style={{ fontSize: 10.5, padding: "2px 9px", borderRadius: 999, background: C.alt, color: C.textMid, border: `1px solid ${C.border}` }}>{k}</span>
                    ))}
                  </div>
                )}

                {m.attendees.length > 0 && (
                  <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>Attendees</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {m.attendees.map((a, i) => (
                        <span key={`${a.email}-${i}`} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, background: a.internal ? C.alt : C.orangeBg, color: a.internal ? C.textMid : C.orange, border: `1px solid ${a.internal ? C.border : C.orangeBd}` }} title={a.email}>
                          {a.name || a.email}{a.internal ? "" : " ·  external"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            <div>
              {loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: C.textSub, fontSize: 13 }}>Fetching the transcript from Fireflies…</div>
              ) : tErr ? (
                <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "12px 15px", color: C.red, fontSize: 12.5, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Could not load the transcript</div>
                  {tErr}
                  <div><button onClick={() => { setSentences(null); setTErr(null); loadTranscript(); }} style={{ ...btn, marginTop: 10, background: C.surface }}>Try again</button></div>
                </div>
              ) : !sentences || sentences.length === 0 ? (
                <div style={{ textAlign: "center", padding: "34px 0", color: C.textSub, fontSize: 12.5 }}>No transcript text available for this meeting.</div>
              ) : (
                <div>
                  <input
                    placeholder="Search transcript…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: C.font, outline: "none", boxSizing: "border-box", marginBottom: 10 }}
                  />
                  <div style={{ fontSize: 11, color: C.textSub, marginBottom: 12 }}>
                    {search ? `${filteredSentences.length} of ${sentences.length} lines match` : `${sentences.length} lines`}
                  </div>
                  {filteredSentences.map((s, i) => {
                    const prev = filteredSentences[i - 1];
                    const newSpeaker = !prev || prev.speaker !== s.speaker;
                    return (
                      <div key={`${s.index}-${i}`} style={{ marginBottom: newSpeaker ? 10 : 3 }}>
                        {newSpeaker && s.speaker && (
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.blue, marginBottom: 3 }}>{s.speaker}</div>
                        )}
                        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{s.text}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {filing && <FileToDriveModal meeting={m} onClose={() => setFiling(false)} />}
    </>
  );
}
