"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { C } from "@/lib/constants";
import type { ServiceRequest } from "@/app/api/service-requests/route";

// ── helpers ──────────────────────────────────────────────────────────────────
const fmt$ = (n: number) =>
  n === 0 ? "—" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", yyyy: "numeric" } as any);
};

const fmtDateShort = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "2-digit" } as any);
};

const timeAgo = (s: string | null): string | null => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

const isOverdue = (s: string | null) => !!s && new Date(s) < new Date();

const probTier = (p: number): "hot" | "warm" | "cold" =>
  p >= 0.5 ? "hot" : p >= 0.2 ? "warm" : "cold";

const TIER_STYLES = {
  hot:  { bg: "#E6F7F0", color: "#0C6E44", bd: "#A7E3C4", label: "Hot" },
  warm: { bg: "#FFF8E6", color: "#92600A", bd: "#F5D990", label: "Warm" },
  cold: { bg: "#F7F9FC", color: "#4A5568", bd: "#C9CDD4", label: "Cold" },
};

type SortKey = "title" | "client" | "assignedTo" | "probability" | "projectedTotal" | "expectedCloseDate" | "lastActivityDate" | "daysOpen";
type SortDir = "asc" | "desc";
type Tone    = "professional" | "formal" | "friendly" | "urgent";

interface NsEmployee { id: number; name: string; }

// Slack handle map — add real Slack user IDs here if known
const SLACK_HANDLES: Record<string, string> = {
  "Shai Aradais":     "@Shai",
  "Alecia Gilmore":   "@Alecia",
  "Kathy Bacero":     "@Kathy",
  "Sam Balido":       "@Sam",
  "Jason Tutanes":    "@Jason",
  "Piero Loza Palma": "@Piero",
  "Carlos Roman":     "@Carlos",
};

// ── avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, size = 24 }: { name: string | null; size?: number }) {
  if (!name) return null;
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const colors   = ["#1A56DB","#0C6E44","#6B21A8","#B45309","#0D6E6E","#C0392B"];
  const bg       = colors[name.charCodeAt(0) % colors.length];
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, color: "#fff", fontSize: size * 0.38, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {initials}
    </div>
  );
}

// ── Slack templates ───────────────────────────────────────────────────────────
const buildSlackTemplates = (r: ServiceRequest) => {
  const handle = r.assignedTo ? (SLACK_HANDLES[r.assignedTo] ?? `@${r.assignedTo.split(" ")[0]}`) : "@team";
  return [
    {
      id:    "checkin",
      emoji: "👀",
      label: "Check-in",
      text:  `${handle} 👀 Quick check-in on *${r.title}* — ${r.client}\nValue: ${fmt$(r.projectedTotal)} | Close: ${fmtDateShort(r.expectedCloseDate)} | ${Math.round(r.probability * 100)}% probability\nCan you share the latest status and any blockers? NetSuite: ${r.nsUrl}`,
    },
    {
      id:    "urgent",
      emoji: "🔴",
      label: "Urgent",
      text:  `${handle} 🔴 *Urgent follow-up needed:* ${r.title} — ${r.client}\nThis opportunity is ${isOverdue(r.expectedCloseDate) ? "overdue" : `closing ${fmtDateShort(r.expectedCloseDate)}`} and has been open ${r.daysOpen} days. Immediate action required.${r.actionItem ? `\n*Next step:* ${r.actionItem}` : ""}\n${r.nsUrl}`,
    },
    {
      id:    "assign",
      emoji: "🙋",
      label: "Assign Owner",
      text:  `@team 🙋 *Owner needed:* ${r.title} — ${r.client}\nValue: ${fmt$(r.projectedTotal)} | Close: ${fmtDateShort(r.expectedCloseDate)}\nThis opportunity doesn't have a clear owner. Who can take this forward? Reply here or update in NetSuite: ${r.nsUrl}`,
    },
    {
      id:    "close",
      emoji: "🏆",
      label: "Push to Close",
      text:  `${handle} 🏆 *Let's close this one:* ${r.title} — ${r.client}\n${fmt$(r.projectedTotal)} opportunity at ${Math.round(r.probability * 100)}% — expected close *${fmtDateShort(r.expectedCloseDate)}*\nWhat do we need to get this over the line? ${r.nsUrl}`,
    },
  ];
};

// ── Slack modal ───────────────────────────────────────────────────────────────
function SlackModal({ opp, onClose }: { opp: ServiceRequest; onClose: () => void }) {
  const templates    = buildSlackTemplates(opp);
  const defaultTpl   = isOverdue(opp.expectedCloseDate) ? "urgent" : !opp.assignedTo ? "assign" : "checkin";
  const [tplId, setTplId]       = useState(defaultTpl);
  const [channel, setChannel]   = useState("#service-request");
  const [message, setMessage]   = useState(() => templates.find(t => t.id === defaultTpl)!.text);
  const [addNote, setAddNote]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const selectTemplate = (id: string) => {
    setTplId(id);
    setMessage(templates.find(t => t.id === id)!.text);
  };

  const send = async () => {
    setSending(true); setError(null);
    try {
      // Send Slack message
      const slackRes  = await fetch("/api/slack/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, message }),
      });
      const slackData = await slackRes.json();
      if (!slackRes.ok) throw new Error(slackData.error ?? "Slack error");

      // Optionally add note to NetSuite
      if (addNote) {
        const noteRes = await fetch("/api/service-requests/note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            opportunityId: opp.id,
            entityId:      opp.entityId,
            title:         `Slack follow-up — ${channel}`,
            noteType:      "note",
            noteText:      `Slack follow-up sent to ${channel}:\n\n${message}`,
          }),
        });
        const noteData = await noteRes.json();
        if (!noteRes.ok) throw new Error(`Slack sent but NS note failed: ${noteData.error}`);
      }

      setSent(true);
      setTimeout(onClose, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 560, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "92vh" }}>

        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.text, display: "flex", alignItems: "center", gap: 7 }}>
              <span>💬</span> Send Slack Message
            </div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>{opp.title} · {opp.client}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textSub, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>

        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Template picker */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Template</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              {templates.map(t => (
                <button key={t.id} onClick={() => selectTemplate(t.id)} style={{ padding: "9px 12px", borderRadius: 8, textAlign: "left", cursor: "pointer", fontFamily: C.font, background: tplId === t.id ? C.blueBg : C.alt, border: `1.5px solid ${tplId === t.id ? C.blue : C.border}`, color: tplId === t.id ? C.blue : C.textMid }}>
                  <span style={{ fontSize: 15 }}>{t.emoji}</span>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{t.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Channel */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Channel</label>
            <input value={channel} onChange={e => setChannel(e.target.value)} placeholder="#service-requests" style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text }} />
          </div>

          {/* Editable message */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Message <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(editable)</span></label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={6}
              style={{ width: "100%", padding: "9px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text, resize: "vertical", lineHeight: 1.6 }}
            />
          </div>

          {/* Add NS note toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textMid, cursor: "pointer", userSelect: "none", background: C.alt, padding: "8px 12px", borderRadius: 7, border: `1px solid ${C.border}` }}>
            <input type="checkbox" checked={addNote} onChange={e => setAddNote(e.target.checked)} style={{ cursor: "pointer", width: 14, height: 14 }} />
            <div>
              <div style={{ fontWeight: 600, color: C.text }}>Log note in NetSuite</div>
              <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>Saves a copy of this message as a note on the opportunity record</div>
            </div>
          </label>

          {error && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "8px 14px", color: C.red, fontSize: 13 }}>⚠ {error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, flexShrink: 0 }}>
          <button onClick={send} disabled={sending || sent || !message.trim()} style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: sending || sent ? "not-allowed" : "pointer", fontFamily: C.font, border: "none", background: sent ? C.greenBg : sending ? C.alt : "#4A154B", color: sent ? C.green : sending ? C.textSub : "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: sending || sent ? "none" : "0 2px 8px rgba(74,21,75,0.3)", transition: "background 0.15s" }}>
            {sent ? "✓ Sent!" : sending
              ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(0,0,0,0.2)", borderTopColor: C.textMid, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> Sending…</>
              : "💬 Send to Slack"
            }
          </button>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font, background: "none", color: C.textSub, border: `1px solid ${C.border}` }}>Cancel</button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Email modal ───────────────────────────────────────────────────────────────
interface AttachmentFile { name: string; mimeType: string; data: string; size: number; }

function EmailModal({ opp, onClose }: { opp: ServiceRequest; onClose: () => void }) {
  const [tone, setTone]               = useState<Tone>("professional");
  const [subject, setSubject]         = useState("");
  const [body, setBody]               = useState("");
  const [toEmail, setToEmail]         = useState(opp.email ?? "");
  const [generating, setGenerating]   = useState(false);
  const [sending, setSending]         = useState(false);
  const [sent, setSent]               = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [notes, setNotes]             = useState<{ id: number; text: string; date: string | null }[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const generated                     = useRef(false);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // Fetch notes context on mount
  useEffect(() => {
    setNotesLoading(true);
    fetch(`/api/service-requests/notes-context?oppId=${opp.id}`)
      .then(r => r.json())
      .then(d => setNotes(d.notes ?? []))
      .catch(() => {})
      .finally(() => setNotesLoading(false));
  }, [opp.id]);

  const generate = async (t: Tone = tone, noteContext = notes) => {
    setGenerating(true); setError(null);
    try {
      const res  = await fetch("/api/service-requests/email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity: opp, tone: t, notes: noteContext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setSubject(data.subject); setBody(data.body);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setGenerating(false); }
  };

  // Auto-generate once notes are loaded
  useEffect(() => {
    if (!generated.current && !notesLoading) {
      generated.current = true;
      generate(tone, notes);
    }
  }, [notesLoading]); // eslint-disable-line

  const sendViaGmail = async () => {
    if (!subject || !body || !toEmail) return;
    setSending(true); setError(null);
    try {
      const res  = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toEmail, subject, body, attachments }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");

      // Log email as a note on the NS opportunity
      await fetch("/api/service-requests/note", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opp.id,
          entityId:      opp.entityId,
          title:         `Email sent: ${subject}`,
          noteType:      "email",
          noteText:      `To: ${toEmail}\nSubject: ${subject}\n\n${body}`,
        }),
      });

      setSent(true);
      setTimeout(onClose, 1800);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setSending(false); }
  };

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string;
        const base64  = dataUrl.split(",")[1];
        setAttachments(prev => [...prev, { name: file.name, mimeType: file.type || "application/octet-stream", data: base64, size: file.size }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const removeAttachment = (i: number) => setAttachments(prev => prev.filter((_, idx) => idx !== i));

  const fmtSize = (bytes: number) => bytes < 1024 ? `${bytes}B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

  const loading = generating || notesLoading;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 660, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "94vh" }}>

        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>✉ Follow-up Email — Gmail</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>{opp.title} · {opp.client}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textSub, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* Tone + Regenerate bar */}
        <div style={{ padding: "9px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 7, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tone:</span>
          {(["professional","formal","friendly","urgent"] as Tone[]).map(t => (
            <button key={t} onClick={() => { setTone(t); generate(t); }} disabled={loading} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font, background: tone === t ? C.blueBg : C.alt, color: tone === t ? C.blue : C.textMid, border: `1px solid ${tone === t ? C.blueBd : C.border}`, textTransform: "capitalize" }}>{t}</button>
          ))}
          <button onClick={() => generate()} disabled={loading} style={{ marginLeft: "auto", padding: "3px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font, background: loading ? C.alt : C.purpleBg, color: loading ? C.textSub : C.purple, border: `1px solid ${loading ? C.border : C.purpleBd}`, display: "flex", alignItems: "center", gap: 5 }}>
            {loading ? <><span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${C.purpleBd}`, borderTopColor: C.purple, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> Generating…</> : "↺ Regenerate"}
          </button>
        </div>

        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Notes context banner */}
          {notes.length > 0 && (
            <div style={{ background: C.purpleBg, border: `1px solid ${C.purpleBd}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                ✨ Based on {notes.length} recent note{notes.length !== 1 ? "s" : ""} from NetSuite
              </div>
              {notes.slice(0, 2).map((n, i) => (
                <div key={i} style={{ fontSize: 12, color: C.textMid, marginTop: i > 0 ? 4 : 0, borderLeft: `2px solid ${C.purpleBd}`, paddingLeft: 8, lineHeight: 1.5 }}>
                  {n.text.slice(0, 120)}{n.text.length > 120 ? "…" : ""}
                </div>
              ))}
            </div>
          )}

          {error && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "8px 14px", color: C.red, fontSize: 13 }}>⚠ {error}</div>}

          {/* To */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>To</label>
            <input value={toEmail} onChange={e => setToEmail(e.target.value)} style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text }} />
          </div>

          {/* Subject */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={loading ? "Generating…" : ""} style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text }} />
          </div>

          {/* Body */}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Message</label>
            {loading && !body ? (
              <div style={{ background: C.alt, borderRadius: 7, border: `1px solid ${C.border}`, padding: "24px 14px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>✨</div>
                {notesLoading ? "Loading notes from NetSuite…" : "Drafting with Claude…"}
              </div>
            ) : (
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={9} style={{ width: "100%", padding: "9px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text, resize: "vertical", lineHeight: 1.65 }} />
            )}
          </div>

          {/* Attachments */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>Attachments</label>
              <button onClick={() => fileInputRef.current?.click()} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontFamily: C.font, background: C.alt, color: C.textMid, border: `1px solid ${C.border}` }}>
                + Add File
              </button>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileAdd} style={{ display: "none" }} />
            </div>
            {attachments.length === 0 ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{ border: `1.5px dashed ${C.border}`, borderRadius: 7, padding: "10px 14px", textAlign: "center", fontSize: 12, color: C.textSub, cursor: "pointer" }}
              >
                Click or drag files here to attach
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {attachments.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: C.alt, borderRadius: 6, padding: "6px 10px", border: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 14 }}>📎</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: C.textSub }}>{fmtSize(a.size)}</div>
                    </div>
                    <button onClick={() => removeAttachment(i)} style={{ background: "none", border: "none", color: C.textSub, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </div>
                ))}
                <button onClick={() => fileInputRef.current?.click()} style={{ fontSize: 11, color: C.blue, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: "2px 0" }}>+ Add another file</button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={sendViaGmail}
            disabled={sending || sent || !subject || !body || !toEmail}
            style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none", cursor: sending || sent || !subject || !body ? "not-allowed" : "pointer", fontFamily: C.font, background: sent ? C.greenBg : sending ? C.alt : "linear-gradient(135deg,#EA4335,#D93025)", color: sent ? C.green : sending ? C.textSub : "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, boxShadow: sending || sent ? "none" : "0 2px 8px rgba(234,67,53,0.35)", transition: "background 0.15s" }}
          >
            {sent ? "✓ Sent!" : sending
              ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(0,0,0,0.15)", borderTopColor: C.textMid, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Sending…</>
              : <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                  Send via Gmail{attachments.length > 0 ? ` (${attachments.length} attachment${attachments.length !== 1 ? "s" : ""})` : ""}
                </>
            }
          </button>
          <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font, background: "none", color: C.textSub, border: `1px solid ${C.border}` }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── AI Brief row panel ────────────────────────────────────────────────────────
interface AiBrief { loading: boolean; summary?: string; nextSteps?: string[]; error?: string; }

// ── Main component ────────────────────────────────────────────────────────────
export function ServiceRequestsView() {
  const [requests, setRequests]   = useState<ServiceRequest[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [emailOpp, setEmailOpp]   = useState<ServiceRequest | null>(null);
  const [slackOpp, setSlackOpp]   = useState<ServiceRequest | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [briefs, setBriefs]         = useState<Record<number, AiBrief>>({});
  const [employees, setEmployees]   = useState<NsEmployee[]>([]);
  const [assigning, setAssigning]   = useState<Record<number, boolean>>({});

  const [filterClient, setFilterClient]     = useState("all");
  const [filterTier, setFilterTier]         = useState("all");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterOverdue, setFilterOverdue]   = useState(false);
  const [search, setSearch]                 = useState("");
  const [sortKey, setSortKey]               = useState<SortKey>("expectedCloseDate");
  const [sortDir, setSortDir]               = useState<SortDir>("asc");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/service-requests");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRequests(data.requests ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    fetch("/api/service-requests/employees")
      .then(r => r.json())
      .then(d => setEmployees(d.employees ?? []))
      .catch(() => {});
  }, []);

  const assignEmployee = async (opp: ServiceRequest, employeeId: number | null) => {
    setAssigning(prev => ({ ...prev, [opp.id]: true }));
    try {
      const res  = await fetch("/api/service-requests/assign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: opp.id, employeeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const emp = employees.find(e => e.id === employeeId);
      setRequests(prev => prev.map(r =>
        r.id === opp.id ? { ...r, assignedTo: emp?.name ?? null, assignedToId: employeeId } : r
      ));
    } catch (e) {
      alert("Failed to update assignee: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setAssigning(prev => ({ ...prev, [opp.id]: false }));
    }
  };

  const toggleExpand = async (r: ServiceRequest) => {
    if (expandedId === r.id) { setExpandedId(null); return; }
    setExpandedId(r.id);
    if (briefs[r.id]) return; // already loaded

    setBriefs(prev => ({ ...prev, [r.id]: { loading: true } }));
    try {
      // Fetch notes first
      const notesRes = await fetch(`/api/service-requests/notes-context?oppId=${r.id}`);
      const notesData = await notesRes.json();
      const notes = notesData.notes ?? [];

      // Generate AI brief
      const briefRes  = await fetch("/api/service-requests/ai-brief", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity: r, notes }),
      });
      const brief = await briefRes.json();
      if (!briefRes.ok) throw new Error(brief.error ?? "Failed");
      setBriefs(prev => ({ ...prev, [r.id]: { loading: false, summary: brief.summary, nextSteps: brief.nextSteps } }));
    } catch (e) {
      setBriefs(prev => ({ ...prev, [r.id]: { loading: false, error: e instanceof Error ? e.message : "Failed" } }));
    }
  };

  const clients   = useMemo(() => ["all", ...Array.from(new Set(requests.map(r => r.client))).sort()], [requests]);
  const assignees = useMemo(() => ["all", ...Array.from(new Set(requests.map(r => r.assignedTo).filter(Boolean) as string[])).sort()], [requests]);

  const filtered = useMemo(() => {
    let list = requests;
    if (filterClient   !== "all") list = list.filter(r => r.client === filterClient);
    if (filterTier     !== "all") list = list.filter(r => probTier(r.probability) === filterTier);
    if (filterAssignee !== "all") list = list.filter(r => r.assignedTo === filterAssignee);
    if (filterOverdue)            list = list.filter(r => isOverdue(r.expectedCloseDate));
    if (search.trim())            list = list.filter(r =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.client.toLowerCase().includes(search.toLowerCase()) ||
      (r.assignedTo ?? "").toLowerCase().includes(search.toLowerCase())
    );
    return [...list].sort((a, b) => {
      let av: any = a[sortKey];
      let bv: any = b[sortKey];
      if (sortKey === "expectedCloseDate" || sortKey === "lastActivityDate") {
        av = av ? new Date(av).getTime() : Infinity;
        bv = bv ? new Date(bv).getTime() : Infinity;
      }
      if (av == null) return 1; if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [requests, filterClient, filterTier, filterAssignee, filterOverdue, search, sortKey, sortDir]);

  const totalPipeline = filtered.reduce((s, r) => s + r.projectedTotal, 0);
  const totalWeighted = filtered.reduce((s, r) => s + r.weightedTotal, 0);
  const overdueCount  = filtered.filter(r => isOverdue(r.expectedCloseDate)).length;
  const hotCount      = filtered.filter(r => probTier(r.probability) === "hot").length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const SA = (k: SortKey) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // Compact columns: 5 logical groups
  const thStyle = (k?: SortKey): React.CSSProperties => ({
    padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 700,
    color: k && sortKey === k ? C.blue : C.textSub,
    textTransform: "uppercase", letterSpacing: "0.05em",
    cursor: k ? "pointer" : "default", whiteSpace: "nowrap", userSelect: "none",
    background: C.alt, borderBottom: `1px solid ${C.border}`,
  });

  return (
    <div style={{ fontFamily: C.font }}>
      {emailOpp && <EmailModal opp={emailOpp} onClose={() => setEmailOpp(null)} />}
      {slackOpp && <SlackModal opp={slackOpp} onClose={() => setSlackOpp(null)} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Service Requests</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 2 }}>Open opportunities from NetSuite — track, assign, and follow up.</div>
        </div>
        <button onClick={load} disabled={loading} style={{ background: loading ? C.alt : C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font }}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 14, color: C.red, fontSize: 13 }}>⚠ {error}</div>}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
        {[
          { label: "Open",      value: filtered.length,    sub: `of ${requests.length} total`,  color: C.blue,  bg: C.blueBg,  bd: C.blueBd  },
          { label: "Pipeline",  value: fmt$(totalPipeline), sub: "projected value",              color: C.text,  bg: "#F7F9FC", bd: C.border  },
          { label: "Weighted",  value: fmt$(totalWeighted), sub: "probability-adjusted",         color: C.text,  bg: "#F7F9FC", bd: C.border  },
          { label: overdueCount > 0 ? "⚠ Overdue" : "Overdue", value: overdueCount, sub: overdueCount > 0 ? "past close date" : "all on track", color: overdueCount > 0 ? C.red : C.green, bg: overdueCount > 0 ? C.redBg : C.greenBg, bd: overdueCount > 0 ? C.redBd : C.greenBd },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.bd}`, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color, fontFamily: C.mono, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ padding: "5px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", outline: "none", width: 160 }} />
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ padding: "5px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}>
          {clients.map(c => <option key={c} value={c}>{c === "all" ? "All Clients" : c}</option>)}
        </select>
        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{ padding: "5px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}>
          {assignees.map(a => <option key={a} value={a}>{a === "all" ? "All Assignees" : a}</option>)}
        </select>
        <select value={filterTier} onChange={e => setFilterTier(e.target.value)} style={{ padding: "5px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}>
          <option value="all">All Tiers</option>
          <option value="hot">🔥 Hot</option>
          <option value="warm">🌡 Warm</option>
          <option value="cold">🧊 Cold</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={filterOverdue} onChange={e => setFilterOverdue(e.target.checked)} /> Overdue
        </label>
        <div style={{ marginLeft: "auto", fontSize: 12, color: C.textSub }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</div>
      </div>

      {/* Condensed table — 5 columns, 2 data lines per cell */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        {loading ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}><div style={{ fontSize: 22, marginBottom: 10 }}>⏳</div>Loading from NetSuite…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}><div style={{ fontSize: 22, marginBottom: 10 }}>📭</div>No open opportunities match your filters.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle(), width: 28 }}></th>
                <th onClick={() => handleSort("title")}   style={thStyle("title")}>Opportunity {SA("title")}</th>
                <th onClick={() => handleSort("assignedTo")} style={thStyle("assignedTo")}>Owner · Activity {SA("assignedTo")}</th>
                <th onClick={() => handleSort("probability")} style={thStyle("probability")}>Deal {SA("probability")}</th>
                <th onClick={() => handleSort("expectedCloseDate")} style={thStyle("expectedCloseDate")}>Timeline {SA("expectedCloseDate")}</th>
                <th style={thStyle()}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const tier     = probTier(r.probability);
                const ts       = TIER_STYLES[tier];
                const overdue  = isOverdue(r.expectedCloseDate);
                const rowBg    = i % 2 === 0 ? "#fff" : C.alt;
                const actAgo   = timeAgo(r.lastActivityDate);
                const isOpen   = expandedId === r.id;
                const brief    = briefs[r.id];

                return (
                  <>
                  <tr key={r.id} style={{ background: isOpen ? C.blueBg : rowBg, borderBottom: isOpen ? "none" : `1px solid ${C.border}`, transition: "background 0.1s" }} onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = C.blueBg; }} onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = rowBg; }}>

                    {/* Expand chevron */}
                    <td style={{ padding: "10px 6px 10px 14px", width: 28 }}>
                      <button onClick={() => toggleExpand(r)} title="AI notes summary" style={{ background: "none", border: "none", cursor: "pointer", color: isOpen ? C.blue : C.textSub, fontSize: 13, padding: 0, lineHeight: 1, transition: "transform 0.15s", display: "block", transform: isOpen ? "rotate(90deg)" : "none" }}>▶</button>
                    </td>

                    {/* Col 1: Opportunity + Client */}
                    <td style={{ padding: "10px 14px", minWidth: 220 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{r.title}</div>
                      <div style={{ fontSize: 12, color: C.textSub, marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
                        {r.client}
                        {r.noteCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: "0px 5px", borderRadius: 8, background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}` }}>{r.noteCount}n</span>}
                      </div>
                      {r.actionItem && <div style={{ fontSize: 11, color: C.orange, marginTop: 2, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ {r.actionItem}</div>}
                    </td>

                    {/* Col 2: Owner + Last Activity */}
                    <td style={{ padding: "10px 14px", minWidth: 160 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {r.assignedTo && Avatar({ name: r.assignedTo, size: 22 })}
                        <div style={{ position: "relative", flex: 1 }}>
                          <select
                            value={r.assignedToId ?? ""}
                            disabled={assigning[r.id]}
                            onChange={e => {
                              const val = e.target.value;
                              assignEmployee(r, val ? parseInt(val) : null);
                            }}
                            style={{ width: "100%", padding: "3px 22px 3px 6px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: C.font, color: r.assignedTo ? C.text : C.textSub, background: assigning[r.id] ? C.alt : "#fff", cursor: assigning[r.id] ? "not-allowed" : "pointer", appearance: "none", WebkitAppearance: "none" }}
                          >
                            <option value="">— Unassigned</option>
                            {employees.map(e => (
                              <option key={e.id} value={e.id}>{e.name}</option>
                            ))}
                          </select>
                          <span style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 9, color: C.textSub }}>▼</span>
                        </div>
                        {assigning[r.id] && <span style={{ width: 12, height: 12, flexShrink: 0, display: "inline-block", border: `2px solid ${C.blueBd}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />}
                      </div>
                      <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>
                        {actAgo ? `Updated ${actAgo}` : "—"}
                      </div>
                    </td>

                    {/* Col 3: Tier + $ */}
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 9, background: ts.bg, color: ts.color, border: `1px solid ${ts.bd}` }}>{ts.label}</span>
                        <span style={{ fontSize: 12, fontFamily: C.mono, color: C.textMid }}>{Math.round(r.probability * 100)}%</span>
                      </div>
                      <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>{fmt$(r.projectedTotal)}</div>
                      <div style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub }}>≈{fmt$(r.weightedTotal)} wtd</div>
                    </td>

                    {/* Col 4: Close date + days open */}
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: 13, fontFamily: C.mono, color: overdue ? C.red : C.text, fontWeight: overdue ? 700 : 400 }}>
                        {fmtDateShort(r.expectedCloseDate)}
                        {overdue && <span style={{ fontSize: 10, marginLeft: 5, background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, padding: "1px 5px", borderRadius: 4, fontWeight: 700 }}>Overdue</span>}
                      </div>
                      <div style={{ fontSize: 11, color: r.daysOpen > 60 ? C.red : r.daysOpen > 30 ? C.yellow : C.textSub, marginTop: 3, fontFamily: C.mono }}>
                        {r.daysOpen}d open
                      </div>
                    </td>

                    {/* Col 5: Actions */}
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button onClick={() => setSlackOpp(r)} title="Send Slack message" style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font, background: "#F4F0FF", color: "#4A154B", border: "1px solid #C4B5FD" }}>💬</button>
                        <button onClick={() => setEmailOpp(r)} title="Draft email" style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.font, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}` }}>✉</button>
                        <a href={r.nsUrl} target="_blank" rel="noreferrer" style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, textDecoration: "none", background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}` }}>↗</a>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded AI brief row */}
                  {isOpen && (
                    <tr key={`${r.id}-brief`} style={{ background: "#F0F7FF", borderBottom: `1px solid ${C.border}` }}>
                      <td colSpan={6} style={{ padding: "0 14px 14px 50px" }}>
                        {!brief || brief.loading ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textSub, fontSize: 12, paddingTop: 10 }}>
                            <span style={{ display: "inline-block", width: 12, height: 12, border: `2px solid ${C.blueBd}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                            Analysing notes with Claude…
                          </div>
                        ) : brief.error ? (
                          <div style={{ color: C.red, fontSize: 12, paddingTop: 10 }}>⚠ {brief.error}</div>
                        ) : (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, paddingTop: 10 }}>
                            {/* Summary */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>✨ Notes Summary</div>
                              <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6 }}>{brief.summary}</div>
                            </div>
                            {/* Next Steps */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>→ Recommended Next Steps</div>
                              <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                                {(brief.nextSteps ?? []).map((step, si) => (
                                  <li key={si} style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>{step}</li>
                                ))}
                              </ol>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer summary */}
      {filtered.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 16, fontSize: 12, color: C.textSub }}>
          <span>🔥 Hot: <strong style={{ color: C.text }}>{hotCount}</strong></span>
          <span>💰 <strong style={{ color: C.text, fontFamily: C.mono }}>{fmt$(totalPipeline)}</strong></span>
          <span>⚖ <strong style={{ color: C.text, fontFamily: C.mono }}>{fmt$(totalWeighted)}</strong> wtd</span>
          {overdueCount > 0 && <span style={{ color: C.red }}>⚠ {overdueCount} overdue</span>}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
