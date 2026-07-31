"use client";
// ─── Meeting transcript drawer ────────────────────────────────────────────────
// Opens from the Meetings tab. Pulls the Zoom cloud-recording transcript (VTT)
// for one meeting instance and renders it with search, speaker filter and
// speaker talk-time.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C } from "@/lib/constants";

interface Cue {
  index: number; start: string; end: string; seconds: number; speaker: string; text: string;
}
interface SpeakerStat { speaker: string; seconds: number; lines: number }

interface TranscriptResponse {
  available:  boolean;
  reason?:    string;
  topic?:     string;
  startTime?: string;
  duration?:  number;
  shareUrl?:  string;
  cues:       Cue[];
  vtt?:       string;
  otherFiles: Array<{ fileType: string; fileExtension: string; fileSize: number }>;
  speakers:   SpeakerStat[];
  wordCount:  number;
  error?:     string;
}

export interface TranscriptTarget {
  uuid:      string;
  topic:     string;
  hostName:  string;
  startTime: string;
}

const fmtClock = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${m}:${String(ss).padStart(2, "0")}`;
};

const fmtTalk = (secs: number) => {
  const m = Math.round(secs / 60);
  return m >= 1 ? `${m}m` : `${Math.round(secs)}s`;
};

const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

/** Case-insensitive highlight of the search term inside a cue line. */
function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term.trim()) return <>{text}</>;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: "#FEF08A", color: C.text, padding: "0 1px", borderRadius: 2 }}>
        {text.slice(i, i + term.length)}
      </mark>
      <Highlighted text={text.slice(i + term.length)} term={term} />
    </>
  );
}

export function TranscriptPanel({ target, onClose }: { target: TranscriptTarget; onClose: () => void }) {
  const [data, setData]       = useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState("");
  const [speaker, setSpeaker] = useState("all");
  const [copied, setCopied]   = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/meetings/transcript?uuid=${encodeURIComponent(target.uuid)}`);
      const json = await res.json() as TranscriptResponse;
      if (!res.ok) throw new Error(json.error ?? "Failed to load transcript");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [target.uuid]);

  useEffect(() => { load(); }, [load]);

  // Esc to close, matching the other drawers in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cues = data?.cues ?? [];

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return cues.filter(c =>
      (speaker === "all" || (c.speaker || "Unattributed") === speaker) &&
      (!q || c.text.toLowerCase().includes(q) || c.speaker.toLowerCase().includes(q)),
    );
  }, [cues, search, speaker]);

  const plainText = useMemo(
    () => cues.map(c => `[${c.start}] ${c.speaker ? c.speaker + ": " : ""}${c.text}`).join("\n"),
    [cues],
  );

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the download button still works */ }
  }

  function downloadVtt() {
    if (!data?.vtt) return;
    const safe = (data.topic || target.topic || "meeting").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const url  = URL.createObjectURL(new Blob([data.vtt], { type: "text/vtt" }));
    const a    = document.createElement("a");
    a.href = url;
    a.download = `${safe}-transcript.vtt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const btn: React.CSSProperties = {
    padding: "6px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
    background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font,
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 1200 }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(660px, 100vw)", background: C.surface, borderLeft: `1px solid ${C.border}`, boxShadow: "-4px 0 28px rgba(0,0,0,0.14)", zIndex: 1201, display: "flex", flexDirection: "column", fontFamily: C.font }}>

        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, letterSpacing: "0.06em", textTransform: "uppercase" }}>Transcript</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={data?.topic || target.topic}>
                {data?.topic || target.topic}
              </div>
              <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 2 }}>
                {target.hostName}
                {target.startTime && <> · {new Date(target.startTime).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
                {data?.available && <> · {cues.length} lines · {data.wordCount.toLocaleString()} words</>}
              </div>
            </div>
            <button onClick={onClose} title="Close (Esc)" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: C.textSub, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
          </div>

          {data?.available && (
            <>
              <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
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
                  <select value={speaker} onChange={e => setSpeaker(e.target.value)} style={{ ...btn, cursor: "pointer", background: C.surface }}>
                    <option value="all">All speakers</option>
                    {data.speakers.map(s => <option key={s.speaker} value={s.speaker}>{s.speaker}</option>)}
                  </select>
                )}
                <button onClick={copyAll} style={btn}>{copied ? "✓ Copied" : "Copy"}</button>
                {data.vtt && <button onClick={downloadVtt} style={btn}>↓ .vtt</button>}
                {data.shareUrl && (
                  <a href={data.shareUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: "none", background: C.blueBg, color: C.blue, borderColor: C.blueBd }}>
                    ↗ Zoom
                  </a>
                )}
              </div>

              {/* Speaker talk-time */}
              {data.speakers.length > 0 && (
                <div style={{ display: "flex", gap: 5, marginTop: 9, flexWrap: "wrap" }}>
                  {data.speakers.map(s => (
                    <span
                      key={s.speaker}
                      onClick={() => setSpeaker(sp => sp === s.speaker ? "all" : s.speaker)}
                      title={`${s.lines} lines · click to filter`}
                      style={{ fontSize: 10.5, padding: "2px 9px", borderRadius: 999, cursor: "pointer", background: speaker === s.speaker ? C.blueBg : C.alt, color: speaker === s.speaker ? C.blue : C.textMid, border: `1px solid ${speaker === s.speaker ? C.blueBd : C.border}` }}
                    >
                      {s.speaker} <strong style={{ fontFamily: C.mono }}>{fmtTalk(s.seconds)}</strong>
                    </span>
                  ))}
                </div>
              )}

              {search && (
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 7 }}>
                  {filtered.length} of {cues.length} lines match
                </div>
              )}
            </>
          )}
        </div>

        {/* Body */}
        <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", padding: "14px 20px", minHeight: 0 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.textSub, fontSize: 13 }}>
              Fetching the transcript from Zoom…
            </div>
          ) : error ? (
            <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "12px 15px", color: C.red, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Could not load the transcript</div>
              {error}
              <button onClick={load} style={{ ...btn, marginTop: 10, background: C.surface }}>Try again</button>
            </div>
          ) : !data?.available ? (
            <div style={{ textAlign: "center", padding: "34px 10px", color: C.textSub }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>🗒️</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.textMid, marginBottom: 8 }}>No transcript available</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.65, maxWidth: 420, margin: "0 auto" }}>{data?.reason}</div>
              {(data?.otherFiles?.length ?? 0) > 0 && (
                <div style={{ marginTop: 14, fontSize: 11.5, color: C.textSub }}>
                  Recording assets present: {data!.otherFiles.map(f => `${f.fileType}${f.fileSize ? ` (${fmtBytes(f.fileSize)})` : ""}`).join(" · ")}
                </div>
              )}
              {data?.shareUrl && (
                <a href={data.shareUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, display: "inline-block", marginTop: 14, textDecoration: "none", background: C.blueBg, color: C.blue, borderColor: C.blueBd }}>
                  ↗ Open recording in Zoom
                </a>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "34px 0", color: C.textSub, fontSize: 12.5 }}>
              Nothing matches “{search}”.
            </div>
          ) : (
            <div>
              {filtered.map((c, i) => {
                const prev = filtered[i - 1];
                const newSpeaker = !prev || prev.speaker !== c.speaker;
                return (
                  <div key={`${c.index}-${c.start}`} style={{ marginBottom: newSpeaker ? 10 : 3 }}>
                    {newSpeaker && c.speaker && (
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.blue, marginBottom: 3 }}>{c.speaker}</div>
                    )}
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textSub, flexShrink: 0, width: 46, textAlign: "right" }}>
                        {fmtClock(c.seconds)}
                      </span>
                      <span style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                        <Highlighted text={c.text} term={search} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
