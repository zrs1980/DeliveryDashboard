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
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
};

const timeAgo = (s: string | null): string | null => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
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

type SortKey = "tranId" | "title" | "client" | "assignedTo" | "probability" | "projectedTotal" | "weightedTotal" | "expectedCloseDate" | "lastActivityDate" | "daysOpen";
type SortDir = "asc" | "desc";
type Tone    = "professional" | "formal" | "friendly" | "urgent";

// ── avatar helper ─────────────────────────────────────────────────────────────
function Avatar({ name, size = 26 }: { name: string | null; size?: number }) {
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
const SLACK_TEMPLATES = [
  {
    id:    "checkin",
    emoji: "👀",
    label: "Check-in",
    build: (r: ServiceRequest) => ({
      text: `👀 *Follow-up needed:* ${r.title}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `👀 *Follow-up needed:* <${r.nsUrl}|${r.title}>\n*Client:* ${r.client}  |  *Value:* ${fmt$(r.projectedTotal)}  |  *Probability:* ${Math.round(r.probability * 100)}%` } },
        { type: "section", text: { type: "mrkdwn", text: `Can someone update on the current status of this opportunity? Expected close: *${fmtDate(r.expectedCloseDate)}*${r.assignedTo ? `  |  Owner: *${r.assignedTo}*` : ""}` } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "↗ View in NetSuite" }, url: r.nsUrl, action_id: "view_ns" }] },
      ],
    }),
  },
  {
    id:    "urgent",
    emoji: "🔴",
    label: "Urgent — Needs Attention",
    build: (r: ServiceRequest) => ({
      text: `🔴 Urgent: ${r.title} needs immediate attention`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `🔴 *Urgent — Action Required:* <${r.nsUrl}|${r.title}>\n*Client:* ${r.client}  |  *Value:* ${fmt$(r.projectedTotal)}` } },
        { type: "section", text: { type: "mrkdwn", text: `This opportunity is${isOverdue(r.expectedCloseDate) ? " *overdue*" : ` closing *${fmtDate(r.expectedCloseDate)}*`} and has been open for *${r.daysOpen} days*. Immediate follow-up required.${r.actionItem ? `\n*Action item:* ${r.actionItem}` : ""}` } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "↗ View in NetSuite" }, url: r.nsUrl, action_id: "view_ns", style: "danger" }] },
      ],
    }),
  },
  {
    id:    "assign",
    emoji: "🙋",
    label: "Assign Owner",
    build: (r: ServiceRequest) => ({
      text: `🙋 Who should own: ${r.title}?`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `🙋 *Ownership needed:* <${r.nsUrl}|${r.title}>\n*Client:* ${r.client}  |  *Value:* ${fmt$(r.projectedTotal)}  |  *Close date:* ${fmtDate(r.expectedCloseDate)}` } },
        { type: "section", text: { type: "mrkdwn", text: `This opportunity needs an assigned owner. Please reply with who should take this forward or if you can cover it.` } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "↗ View in NetSuite" }, url: r.nsUrl, action_id: "view_ns" }] },
      ],
    }),
  },
  {
    id:    "close",
    emoji: "🏆",
    label: "Push to Close",
    build: (r: ServiceRequest) => ({
      text: `🏆 Close push: ${r.title} — ${fmt$(r.projectedTotal)} opportunity`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `🏆 *Let's close this one:* <${r.nsUrl}|${r.title}>\n*Client:* ${r.client}  |  *Value:* ${fmt$(r.projectedTotal)}  |  *Probability:* ${Math.round(r.probability * 100)}%` } },
        { type: "section", text: { type: "mrkdwn", text: `Expected close: *${fmtDate(r.expectedCloseDate)}* — this is a strong opportunity. What do we need to get this over the line?${r.assignedTo ? `  Owner: *${r.assignedTo}*` : ""}` } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "↗ View in NetSuite" }, url: r.nsUrl, action_id: "view_ns", style: "primary" }] },
      ],
    }),
  },
];

// ── Slack modal ───────────────────────────────────────────────────────────────
function SlackModal({ opp, onClose }: { opp: ServiceRequest; onClose: () => void }) {
  const [templateId, setTemplateId] = useState(isOverdue(opp.expectedCloseDate) ? "urgent" : opp.assignedTo == null ? "assign" : "checkin");
  const [channel, setChannel]       = useState("#general");
  const [sending, setSending]       = useState(false);
  const [sent, setSent]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [preview, setPreview]       = useState<{ text: string; blocks: any[] } | null>(null);

  useEffect(() => {
    const tpl = SLACK_TEMPLATES.find(t => t.id === templateId);
    if (tpl) setPreview(tpl.build(opp));
  }, [templateId, opp]);

  const send = async () => {
    if (!preview) return;
    setSending(true);
    setError(null);
    try {
      const res  = await fetch("/api/slack/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, message: preview.text, blocks: preview.blocks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setSent(true);
      setTimeout(onClose, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSending(false);
    }
  };

  // Render a human-readable preview of the Slack message
  const renderPreview = () => {
    if (!preview) return null;
    return (
      <div style={{ background: "#1A1D21", borderRadius: 10, padding: "16px 18px", fontFamily: "inherit" }}>
        {preview.blocks?.map((b: any, i: number) => {
          if (b.type === "section" && b.text?.text) {
            const lines = b.text.text
              .replace(/\*/g, "")
              .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
              .split("\n");
            return (
              <div key={i} style={{ marginBottom: i < preview.blocks.length - 1 ? 10 : 0 }}>
                {lines.map((line: string, li: number) => (
                  <div key={li} style={{ fontSize: 13, color: li === 0 ? "#E8EAED" : "#9AA0A6", lineHeight: 1.5 }}>{line}</div>
                ))}
              </div>
            );
          }
          if (b.type === "actions") {
            return (
              <div key={i} style={{ marginTop: 10 }}>
                {b.elements?.map((el: any, ei: number) => (
                  <span key={ei} style={{ fontSize: 12, background: el.style === "primary" ? "#1A56DB" : el.style === "danger" ? "#C0392B" : "#2C2F33", color: "#fff", padding: "4px 12px", borderRadius: 4, display: "inline-block" }}>
                    {el.text?.text}
                  </span>
                ))}
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 560, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "92vh" }}>

        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>💬</span> Send Slack Message
            </div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 3 }}>{opp.title} · {opp.client}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textSub, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Template picker */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Message Type</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {SLACK_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  style={{
                    padding: "10px 12px", borderRadius: 8, textAlign: "left", cursor: "pointer", fontFamily: C.font,
                    background: templateId === t.id ? C.blueBg : C.alt,
                    border:     `1.5px solid ${templateId === t.id ? C.blue : C.border}`,
                    color:      templateId === t.id ? C.blue : C.textMid,
                  }}
                >
                  <div style={{ fontSize: 16, marginBottom: 2 }}>{t.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{t.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Channel input */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Channel</label>
            <input
              value={channel}
              onChange={e => setChannel(e.target.value)}
              placeholder="#general or channel ID"
              style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text }}
            />
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>Enter a channel name (e.g. #sales) or Slack channel ID. Configure default via SLACK_DEFAULT_CHANNEL env var.</div>
          </div>

          {/* Preview */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Preview</div>
            {renderPreview()}
          </div>

          {error && (
            <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "8px 14px", color: C.red, fontSize: 13 }}>⚠ {error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, flexShrink: 0 }}>
          <button
            onClick={send}
            disabled={sending || sent}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: sending || sent ? "not-allowed" : "pointer", fontFamily: C.font, border: "none",
              background: sent ? C.greenBg : sending ? C.alt : "#4A154B",
              color:      sent ? C.green   : sending ? C.textSub : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              boxShadow: sending || sent ? "none" : "0 2px 8px rgba(74,21,75,0.3)",
            }}
          >
            {sent ? (
              "✓ Sent!"
            ) : sending ? (
              <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(0,0,0,0.2)", borderTopColor: C.textMid, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> Sending…</>
            ) : (
              <>💬 Send to Slack</>
            )}
          </button>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font, background: "none", color: C.textSub, border: `1px solid ${C.border}` }}>
            Cancel
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Email modal ───────────────────────────────────────────────────────────────
function EmailModal({ opp, onClose }: { opp: ServiceRequest; onClose: () => void }) {
  const [tone, setTone]       = useState<Tone>("professional");
  const [subject, setSubject] = useState("");
  const [body, setBody]       = useState("");
  const [toEmail, setToEmail] = useState(opp.email ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);
  const generated             = useRef(false);

  const generate = async (t: Tone = tone) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/service-requests/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opportunity: opp, tone: t }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate");
      setSubject(data.subject);
      setBody(data.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (!generated.current) { generated.current = true; generate(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mailtoLink = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const copyAll = async () => {
    await navigator.clipboard.writeText(`To: ${toEmail}\nSubject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 620, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "92vh" }}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>✉ Draft Follow-up Email</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 3 }}>{opp.title} · {opp.client}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textSub, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>Tone:</span>
          {(["professional","formal","friendly","urgent"] as Tone[]).map(t => (
            <button key={t} onClick={() => { setTone(t); generate(t); }} disabled={loading} style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font, background: tone === t ? C.blueBg : C.alt, color: tone === t ? C.blue : C.textMid, border: `1px solid ${tone === t ? C.blueBd : C.border}`, textTransform: "capitalize" }}>{t}</button>
          ))}
          <button onClick={() => generate()} disabled={loading} style={{ marginLeft: "auto", padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font, background: loading ? C.alt : C.purpleBg, color: loading ? C.textSub : C.purple, border: `1px solid ${loading ? C.border : C.purpleBd}`, display: "flex", alignItems: "center", gap: 6 }}>
            {loading ? <><span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${C.purpleBd}`, borderTopColor: C.purple, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> Generating…</> : "↺ Regenerate"}
          </button>
        </div>
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {error && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "8px 14px", color: C.red, fontSize: 13 }}>⚠ {error}</div>}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>To</label>
            <input value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="recipient@company.com" style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={loading ? "Generating…" : "Subject line"} style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Message</label>
            {loading && !body ? (
              <div style={{ background: C.alt, borderRadius: 7, border: `1px solid ${C.border}`, padding: "20px 14px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>✨</div>Drafting your email with Claude…
              </div>
            ) : (
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={10} style={{ width: "100%", padding: "9px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text, resize: "vertical", lineHeight: 1.65 }} />
            )}
          </div>
        </div>
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <a href={subject && body ? mailtoLink : "#"} onClick={e => { if (!subject || !body) e.preventDefault(); }} style={{ flex: 1, padding: "9px 0", borderRadius: 8, textAlign: "center", fontSize: 13, fontWeight: 700, textDecoration: "none", background: subject && body ? "linear-gradient(135deg, #1A56DB, #2563EB)" : C.alt, color: subject && body ? "#fff" : C.textSub, pointerEvents: subject && body ? "auto" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: subject && body ? "0 2px 8px rgba(26,86,219,0.35)" : "none" }}>✉ Open in Mail Client</a>
          <button onClick={copyAll} disabled={!subject || !body} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: C.font, background: copied ? C.greenBg : C.alt, color: copied ? C.green : C.textMid, border: `1px solid ${copied ? C.greenBd : C.border}` }}>{copied ? "✓ Copied!" : "⎘ Copy"}</button>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font, background: "none", color: C.textSub, border: `1px solid ${C.border}` }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ServiceRequestsView() {
  const [requests, setRequests]   = useState<ServiceRequest[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [emailOpp, setEmailOpp]   = useState<ServiceRequest | null>(null);
  const [slackOpp, setSlackOpp]   = useState<ServiceRequest | null>(null);

  const [filterClient, setFilterClient]   = useState("all");
  const [filterTier, setFilterTier]       = useState("all");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [search, setSearch]               = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("expectedCloseDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  useEffect(() => { load(); }, []);

  const clients = useMemo(() => ["all", ...Array.from(new Set(requests.map(r => r.client))).sort()], [requests]);
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
      if (av == null) return 1;
      if (bv == null) return -1;
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
  const SortArrow = (k: SortKey) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const COLS: [SortKey, string][] = [
    ["tranId",           "#"],
    ["title",            "Opportunity"],
    ["client",           "Client"],
    ["assignedTo",       "Assigned To"],
    ["probability",      "Probability"],
    ["projectedTotal",   "Projected"],
    ["weightedTotal",    "Weighted"],
    ["expectedCloseDate","Close Date"],
    ["lastActivityDate", "Last Activity"],
    ["daysOpen",         "Days Open"],
  ];

  return (
    <div style={{ fontFamily: C.font }}>

      {emailOpp && <EmailModal opp={emailOpp} onClose={() => setEmailOpp(null)} />}
      {slackOpp && <SlackModal opp={slackOpp} onClose={() => setSlackOpp(null)} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Service Requests</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 3 }}>Open opportunities from NetSuite — track, assign, and follow up.</div>
        </div>
        <button onClick={load} disabled={loading} style={{ background: loading ? C.alt : C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font }}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.red, fontSize: 13 }}>⚠ {error}</div>}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Open Opportunities",  value: filtered.length,    sub: `of ${requests.length} total`,  color: C.blue,                                              bg: C.blueBg,                                                bd: C.blueBd  },
          { label: "Total Pipeline",      value: fmt$(totalPipeline), sub: "projected value",              color: C.text,                                              bg: "#F7F9FC",                                               bd: C.border  },
          { label: "Weighted Pipeline",   value: fmt$(totalWeighted), sub: "probability-adjusted",         color: C.text,                                              bg: "#F7F9FC",                                               bd: C.border  },
          { label: overdueCount > 0 ? "⚠ Overdue" : "Overdue", value: overdueCount, sub: overdueCount > 0 ? "past expected close" : "all on track", color: overdueCount > 0 ? C.red : C.green, bg: overdueCount > 0 ? C.redBg : C.greenBg, bd: overdueCount > 0 ? C.redBd : C.greenBd },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.bd}`, borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: k.color, fontFamily: C.mono, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 5 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", outline: "none", width: 180 }} />
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}>
          {clients.map(c => <option key={c} value={c}>{c === "all" ? "All Clients" : c}</option>)}
        </select>
        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}>
          {assignees.map(a => <option key={a} value={a}>{a === "all" ? "All Assignees" : a}</option>)}
        </select>
        <select value={filterTier} onChange={e => setFilterTier(e.target.value)} style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}>
          <option value="all">All Tiers</option>
          <option value="hot">🔥 Hot (≥50%)</option>
          <option value="warm">🌡 Warm (20–49%)</option>
          <option value="cold">🧊 Cold (&lt;20%)</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={filterOverdue} onChange={e => setFilterOverdue(e.target.checked)} style={{ cursor: "pointer" }} /> Overdue only
        </label>
        <div style={{ marginLeft: "auto", fontSize: 13, color: C.textSub }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</div>
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        {loading ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}><div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>Loading from NetSuite…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}><div style={{ fontSize: 24, marginBottom: 12 }}>📭</div>No open opportunities match your filters.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.alt, borderBottom: `1px solid ${C.border}` }}>
                  {COLS.map(([key, label]) => (
                    <th key={key} onClick={() => handleSort(key)} style={{ padding: "10px 13px", textAlign: "left", fontSize: 11, fontWeight: 700, color: sortKey === key ? C.blue : C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                      {label}{SortArrow(key)}
                    </th>
                  ))}
                  <th style={{ padding: "10px 13px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>Activity</th>
                  <th style={{ padding: "10px 13px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const tier    = probTier(r.probability);
                  const ts      = TIER_STYLES[tier];
                  const overdue = isOverdue(r.expectedCloseDate);
                  const rowBg   = i % 2 === 0 ? "#fff" : C.alt;
                  const actAgo  = timeAgo(r.lastActivityDate);

                  return (
                    <tr key={r.id} style={{ background: rowBg, borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }} onMouseEnter={e => (e.currentTarget.style.background = C.blueBg)} onMouseLeave={e => (e.currentTarget.style.background = rowBg)}>

                      {/* # */}
                      <td style={{ padding: "10px 13px", fontSize: 12, color: C.textSub, fontFamily: C.mono, whiteSpace: "nowrap" }}>{r.tranId}</td>

                      {/* Title */}
                      <td style={{ padding: "10px 13px", minWidth: 160 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.title}</div>
                        {r.actionItem && <div style={{ fontSize: 11, color: C.orange, marginTop: 2, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ {r.actionItem}</div>}
                      </td>

                      {/* Client */}
                      <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 13, color: C.text }}>{r.client}</div>
                        {r.email && <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>{r.email}</div>}
                      </td>

                      {/* Assigned To */}
                      <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                        {r.assignedTo ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            {Avatar({ name: r.assignedTo })}
                            <span style={{ fontSize: 13, color: C.text }}>{r.assignedTo}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: C.textSub, fontStyle: "italic" }}>Unassigned</span>
                        )}
                      </td>

                      {/* Probability */}
                      <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: ts.bg, color: ts.color, border: `1px solid ${ts.bd}` }}>{ts.label}</span>
                          <span style={{ fontSize: 12, fontFamily: C.mono, color: C.textMid }}>{Math.round(r.probability * 100)}%</span>
                        </div>
                        <div style={{ marginTop: 4, height: 3, background: C.border, borderRadius: 2, width: 76 }}>
                          <div style={{ height: "100%", borderRadius: 2, width: `${r.probability * 100}%`, background: ts.color }} />
                        </div>
                      </td>

                      {/* Projected */}
                      <td style={{ padding: "10px 13px", fontSize: 13, fontFamily: C.mono, color: C.text, whiteSpace: "nowrap" }}>{fmt$(r.projectedTotal)}</td>

                      {/* Weighted */}
                      <td style={{ padding: "10px 13px", fontSize: 13, fontFamily: C.mono, color: C.textMid, whiteSpace: "nowrap" }}>{fmt$(r.weightedTotal)}</td>

                      {/* Close Date */}
                      <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 13, fontFamily: C.mono, color: overdue ? C.red : C.text, fontWeight: overdue ? 700 : 400 }}>{fmtDate(r.expectedCloseDate)}</div>
                        {overdue && <div style={{ fontSize: 11, color: C.red, marginTop: 1 }}>Overdue</div>}
                      </td>

                      {/* Last Activity */}
                      <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                        {actAgo ? (
                          <div>
                            <div style={{ fontSize: 13, color: C.text }}>{actAgo}</div>
                            <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>{fmtDate(r.lastActivityDate)}</div>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: C.textSub, fontStyle: "italic" }}>—</span>
                        )}
                      </td>

                      {/* Days Open */}
                      <td style={{ padding: "10px 13px", fontSize: 13, fontFamily: C.mono, color: r.daysOpen > 60 ? C.red : r.daysOpen > 30 ? C.yellow : C.textMid, whiteSpace: "nowrap" }}>
                        {r.daysOpen}d
                      </td>

                      {/* Activity */}
                      <td style={{ padding: "10px 13px", minWidth: 130 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {r.noteCount > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 9, background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}`, display: "inline-block", alignSelf: "flex-start" }}>
                              {r.noteCount} note{r.noteCount !== 1 ? "s" : ""}
                            </span>
                          )}
                          {r.memo && <div style={{ fontSize: 11, color: C.textMid, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.memo}>{r.memo}</div>}
                          {r.noteCount === 0 && !r.memo && <span style={{ fontSize: 11, color: C.textSub, fontStyle: "italic" }}>No activity</span>}
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <button onClick={() => setSlackOpp(r)} title="Send Slack message" style={{ padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: C.font, background: "#F4F0FF", color: "#4A154B", border: "1px solid #C4B5FD", display: "flex", alignItems: "center", gap: 3 }}>
                            💬
                          </button>
                          <button onClick={() => setEmailOpp(r)} title="Draft email" style={{ padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: C.font, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, display: "flex", alignItems: "center", gap: 3 }}>
                            ✉
                          </button>
                          <a href={r.nsUrl} target="_blank" rel="noreferrer" style={{ padding: "4px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: "none", background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}` }}>↗</a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      {filtered.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 16, fontSize: 12, color: C.textSub }}>
          <span>🔥 Hot: <strong style={{ color: C.text }}>{hotCount}</strong></span>
          <span>💰 Pipeline: <strong style={{ color: C.text, fontFamily: C.mono }}>{fmt$(totalPipeline)}</strong></span>
          <span>⚖ Weighted: <strong style={{ color: C.text, fontFamily: C.mono }}>{fmt$(totalWeighted)}</strong></span>
          {overdueCount > 0 && <span style={{ color: C.red }}>⚠ {overdueCount} overdue</span>}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
