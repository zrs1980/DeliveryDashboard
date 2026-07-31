"use client";
// ─── Meeting detail drawer ────────────────────────────────────────────────────
// Two tabs for one Zoom meeting instance:
//   Notes      — AI Companion summary (overview, key points, next steps)
//   Transcript — cloud-recording VTT with search, speaker filter, talk time
//
// Notes loads on open; the transcript loads only when its tab is first opened,
// so we don't download a large VTT nobody asked for.

import { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Cue { index: number; start: string; end: string; seconds: number; speaker: string; text: string }
interface SpeakerStat { speaker: string; seconds: number; lines: number }

interface TranscriptResponse {
  available: boolean; reason?: string; topic?: string; shareUrl?: string;
  cues: Cue[]; vtt?: string;
  otherFiles: Array<{ fileType: string; fileExtension: string; fileSize: number }>;
  speakers: SpeakerStat[]; wordCount: number; error?: string;
}

interface SummaryResponse {
  available: boolean; reason?: string;
  title?: string; overview?: string;
  sections: Array<{ label: string; summary: string }>;
  nextSteps: string[];
  edited: boolean;
  createdAt?: string; lastModifiedAt?: string;
  topic?: string; startTime?: string; endTime?: string; hostEmail?: string;
  error?: string;
}

export interface MeetingTarget {
  uuid: string; topic: string; hostName: string; startTime: string;
}

type PanelTab = "notes" | "transcript";

// ─── Formatting ───────────────────────────────────────────────────────────────

const fmtClock = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
};
const fmtTalk  = (secs: number) => (secs >= 60 ? `${Math.round(secs / 60)}m` : `${Math.round(secs)}s`);
const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

const btn: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
  background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font,
};

/** Case-insensitive highlight of a search term. */
function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term.trim()) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: "#FEF08A", color: C.text, padding: "0 1px", borderRadius: 2 }}>{text.slice(i, i + term.length)}</mark>
      <Highlighted text={text.slice(i + term.length)} term={term} />
    </>
  );
}

function Empty({ icon, title, body, children }: { icon: string; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "34px 10px", color: C.textSub }}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textMid, marginBottom: 8 }}>{title}</div>
      {body && <div style={{ fontSize: 12.5, lineHeight: 1.65, maxWidth: 430, margin: "0 auto" }}>{body}</div>}
      {children}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "12px 15px", color: C.red, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Could not load</div>
      {message}
      <div><button onClick={onRetry} style={{ ...btn, marginTop: 10, background: C.surface }}>Try again</button></div>
    </div>
  );
}

async function copy(text: string, done: (ok: boolean) => void) {
  try { await navigator.clipboard.writeText(text); done(true); }
  catch { done(false); }
}

// ─── Notes tab ────────────────────────────────────────────────────────────────

function NotesTab({ uuid, target }: { uuid: string; target: MeetingTarget }) {
  const [data, setData]   = useState<SummaryResponse | null>(null);
  const [loading, setL]   = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setL(true); setError(null);
    try {
      const res  = await fetch(`/api/meetings/summary?uuid=${encodeURIComponent(uuid)}`);
      const json = await res.json() as SummaryResponse;
      if (!res.ok) throw new Error(json.error ?? "Failed to load notes");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setL(false); }
  }, [uuid]);

  useEffect(() => { load(); }, [load]);

  const asText = useMemo(() => {
    if (!data?.available) return "";
    const lines: string[] = [];
    lines.push(data.title || data.topic || target.topic);
    if (data.overview) lines.push("", data.overview);
    for (const s of data.sections) {
      lines.push("", s.label ? `## ${s.label}` : "## Notes", s.summary);
    }
    if (data.nextSteps.length) {
      lines.push("", "## Next steps", ...data.nextSteps.map(n => `- ${n}`));
    }
    return lines.join("\n");
  }, [data, target.topic]);

  if (loading) return <div style={{ textAlign: "center", padding: "40px 0", color: C.textSub, fontSize: 13 }}>Fetching the meeting notes from Zoom…</div>;
  if (error)   return <ErrorBox message={error} onRetry={load} />;

  if (!data?.available) {
    return <Empty icon="📝" title="No meeting notes" body={data?.reason} />;
  }

  return (
    <div>
      {/* Actions */}
      <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => copy(asText, ok => { setCopied(ok); setTimeout(() => setCopied(false), 1800); })} style={btn}>
          {copied ? "✓ Copied" : "Copy notes"}
        </button>
        {data.edited && (
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}` }}
                title="Someone edited Zoom's generated summary — the edited version is shown">
            ✎ Edited by a person
          </span>
        )}
        {data.lastModifiedAt && (
          <span style={{ fontSize: 11, color: C.textSub }}>
            updated {new Date(data.lastModifiedAt).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {data.title && data.title !== (data.topic ?? "") && (
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 10 }}>{data.title}</div>
      )}

      {/* Overview */}
      {data.overview && (
        <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 8, padding: "12px 15px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.blue, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>Overview</div>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{data.overview}</div>
        </div>
      )}

      {/* Next steps first — it's the actionable part */}
      {data.nextSteps.length > 0 && (
        <div style={{ background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "12px 15px", marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.green, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
            Next steps · {data.nextSteps.length}
          </div>
          {data.nextSteps.map((n, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: i === data.nextSteps.length - 1 ? 0 : 6 }}>
              <span style={{ color: C.green, fontSize: 12, lineHeight: 1.6, flexShrink: 0 }}>▸</span>
              <span style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sectioned key points */}
      {data.sections.map((s, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          {s.label && (
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 5, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
              {s.label}
            </div>
          )}
          <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{s.summary}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Transcript tab ───────────────────────────────────────────────────────────

function TranscriptTab({ uuid, target }: { uuid: string; target: MeetingTarget }) {
  const [data, setData]     = useState<TranscriptResponse | null>(null);
  const [loading, setL]     = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [speaker, setSpk]   = useState("all");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setL(true); setError(null);
    try {
      const res  = await fetch(`/api/meetings/transcript?uuid=${encodeURIComponent(uuid)}`);
      const json = await res.json() as TranscriptResponse;
      if (!res.ok) throw new Error(json.error ?? "Failed to load transcript");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setL(false); }
  }, [uuid]);

  useEffect(() => { load(); }, [load]);

  const cues = data?.cues ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return cues.filter(c =>
      (speaker === "all" || (c.speaker || "Unattributed") === speaker) &&
      (!q || c.text.toLowerCase().includes(q) || c.speaker.toLowerCase().includes(q)),
    );
  }, [cues, search, speaker]);

  const plain = useMemo(
    () => cues.map(c => `[${c.start}] ${c.speaker ? c.speaker + ": " : ""}${c.text}`).join("\n"),
    [cues],
  );

  function downloadVtt() {
    if (!data?.vtt) return;
    const safe = (data.topic || target.topic || "meeting").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const url  = URL.createObjectURL(new Blob([data.vtt], { type: "text/vtt" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${safe}-transcript.vtt`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div style={{ textAlign: "center", padding: "40px 0", color: C.textSub, fontSize: 13 }}>Fetching the transcript from Zoom…</div>;
  if (error)   return <ErrorBox message={error} onRetry={load} />;

  if (!data?.available) {
    return (
      <Empty icon="🗒️" title="No transcript available" body={data?.reason}>
        {(data?.otherFiles?.length ?? 0) > 0 && (
          <div style={{ marginTop: 14, fontSize: 11.5, color: C.textSub }}>
            Recording assets present: {data!.otherFiles.map(f => `${f.fileType}${f.fileSize ? ` (${fmtBytes(f.fileSize)})` : ""}`).join(" · ")}
          </div>
        )}
        {data?.shareUrl && (
          <div>
            <a href={data.shareUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, display: "inline-block", marginTop: 14, textDecoration: "none", background: C.blueBg, color: C.blue, borderColor: C.blueBd }}>
              ↗ Open recording in Zoom
            </a>
          </div>
        )}
      </Empty>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 7, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 170 }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: C.textSub, fontSize: 12, pointerEvents: "none" }}>🔍</span>
          <input
            placeholder="Search transcript…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "6px 10px 6px 28px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: C.font, outline: "none", boxSizing: "border-box" }}
          />
        </div>
        {data.speakers.length > 1 && (
          <select value={speaker} onChange={e => setSpk(e.target.value)} style={{ ...btn, cursor: "pointer", background: C.surface }}>
            <option value="all">All speakers</option>
            {data.speakers.map(s => <option key={s.speaker} value={s.speaker}>{s.speaker}</option>)}
          </select>
        )}
        <button onClick={() => copy(plain, ok => { setCopied(ok); setTimeout(() => setCopied(false), 1800); })} style={btn}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
        {data.vtt && <button onClick={downloadVtt} style={btn}>↓ .vtt</button>}
        {data.shareUrl && (
          <a href={data.shareUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: "none", background: C.blueBg, color: C.blue, borderColor: C.blueBd }}>↗ Zoom</a>
        )}
      </div>

      {/* Talk time */}
      {data.speakers.length > 0 && (
        <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
          {data.speakers.map(s => (
            <span
              key={s.speaker}
              onClick={() => setSpk(sp => sp === s.speaker ? "all" : s.speaker)}
              title={`${s.lines} lines · click to filter`}
              style={{ fontSize: 10.5, padding: "2px 9px", borderRadius: 999, cursor: "pointer", background: speaker === s.speaker ? C.blueBg : C.alt, color: speaker === s.speaker ? C.blue : C.textMid, border: `1px solid ${speaker === s.speaker ? C.blueBd : C.border}` }}
            >
              {s.speaker} <strong style={{ fontFamily: C.mono }}>{fmtTalk(s.seconds)}</strong>
            </span>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: C.textSub, marginBottom: 12 }}>
        {search ? `${filtered.length} of ${cues.length} lines match` : `${cues.length} lines · ${data.wordCount.toLocaleString()} words`}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "30px 0", color: C.textSub, fontSize: 12.5 }}>Nothing matches “{search}”.</div>
      ) : (
        filtered.map((c, i) => {
          const prev = filtered[i - 1];
          const newSpeaker = !prev || prev.speaker !== c.speaker;
          return (
            <div key={`${c.index}-${c.start}`} style={{ marginBottom: newSpeaker ? 10 : 3 }}>
              {newSpeaker && c.speaker && (
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.blue, marginBottom: 3 }}>{c.speaker}</div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textSub, flexShrink: 0, width: 46, textAlign: "right" }}>{fmtClock(c.seconds)}</span>
                <span style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}><Highlighted text={c.text} term={search} /></span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export function MeetingPanel({
  target, initialTab = "notes", onClose,
}: { target: MeetingTarget; initialTab?: PanelTab; onClose: () => void }) {
  const [tab, setTab] = useState<PanelTab>(initialTab);
  // Mounted lazily and then kept mounted, so switching back doesn't refetch.
  const [seen, setSeen] = useState<Set<PanelTab>>(() => new Set([initialTab]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const select = (t: PanelTab) => { setTab(t); setSeen(s => new Set(s).add(t)); };

  const TABS: Array<{ id: PanelTab; label: string }> = [
    { id: "notes",      label: "📝 Notes" },
    { id: "transcript", label: "🗒️ Transcript" },
  ];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 1200 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(680px, 100vw)", background: C.surface, borderLeft: `1px solid ${C.border}`, boxShadow: "-4px 0 28px rgba(0,0,0,0.14)", zIndex: 1201, display: "flex", flexDirection: "column", fontFamily: C.font }}>

        {/* Header */}
        <div style={{ padding: "14px 20px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={target.topic}>
                {target.topic}
              </div>
              <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 2 }}>
                {target.hostName}
                {target.startTime && <> · {new Date(target.startTime).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
              </div>
            </div>
            <button onClick={onClose} title="Close (Esc)" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textSub, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
          </div>

          <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => select(t.id)}
                style={{
                  padding: "7px 14px", fontSize: 12.5, fontWeight: tab === t.id ? 700 : 600,
                  cursor: "pointer", background: "none", border: "none", fontFamily: C.font,
                  color: tab === t.id ? C.blue : C.textSub,
                  borderBottom: `2px solid ${tab === t.id ? C.blue : "transparent"}`,
                  marginBottom: -1,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body — both tabs stay mounted once opened; hidden rather than unmounted */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", minHeight: 0 }}>
          {seen.has("notes") && (
            <div style={{ display: tab === "notes" ? "block" : "none" }}>
              <NotesTab uuid={target.uuid} target={target} />
            </div>
          )}
          {seen.has("transcript") && (
            <div style={{ display: tab === "transcript" ? "block" : "none" }}>
              <TranscriptTab uuid={target.uuid} target={target} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
