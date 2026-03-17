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

const timeAgo = (s: string | null) => {
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

const probTier = (p: number): "hot" | "warm" | "cold" => {
  if (p >= 0.5) return "hot";
  if (p >= 0.2) return "warm";
  return "cold";
};

const TIER_STYLES = {
  hot:  { bg: "#E6F7F0", color: "#0C6E44", bd: "#A7E3C4", label: "Hot" },
  warm: { bg: "#FFF8E6", color: "#92600A", bd: "#F5D990", label: "Warm" },
  cold: { bg: "#F7F9FC", color: "#4A5568", bd: "#C9CDD4", label: "Cold" },
};

type SortKey = "tranId" | "title" | "client" | "probability" | "projectedTotal" | "weightedTotal" | "expectedCloseDate" | "daysOpen";
type SortDir = "asc" | "desc";
type Tone    = "professional" | "formal" | "friendly" | "urgent";

// ── Email modal ──────────────────────────────────────────────────────────────
interface EmailModalProps {
  opp: ServiceRequest;
  onClose: () => void;
}

function EmailModal({ opp, onClose }: EmailModalProps) {
  const [tone, setTone]         = useState<Tone>("professional");
  const [subject, setSubject]   = useState("");
  const [body, setBody]         = useState("");
  const [toEmail, setToEmail]   = useState(opp.email ?? "");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const generated = useRef(false);

  const generate = async (t: Tone = tone) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/service-requests/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity: opp, tone: t }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate email");
      setSubject(data.subject);
      setBody(data.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!generated.current) {
      generated.current = true;
      generate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTone = (t: Tone) => {
    setTone(t);
    generate(t);
  };

  const mailtoLink = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const copyAll = async () => {
    await navigator.clipboard.writeText(`To: ${toEmail}\nSubject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 620, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "92vh" }}>

        {/* Modal header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>✉ Draft Follow-up Email</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 3 }}>{opp.title} · {opp.client}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textSub, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        {/* Tone selector */}
        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>Tone:</span>
          {(["professional", "formal", "friendly", "urgent"] as Tone[]).map(t => (
            <button
              key={t}
              onClick={() => handleTone(t)}
              disabled={loading}
              style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
                fontFamily: C.font,
                background: tone === t ? C.blueBg : C.alt,
                color:      tone === t ? C.blue   : C.textMid,
                border:     `1px solid ${tone === t ? C.blueBd : C.border}`,
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
          <button
            onClick={() => generate()}
            disabled={loading}
            style={{
              marginLeft: "auto", padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font,
              background: loading ? C.alt : C.purpleBg, color: loading ? C.textSub : C.purple,
              border: `1px solid ${loading ? C.border : C.purpleBd}`,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {loading
              ? <><span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${C.purpleBd}`, borderTopColor: C.purple, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> Generating…</>
              : "↺ Regenerate"
            }
          </button>
        </div>

        {/* Email form */}
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {error && (
            <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "8px 14px", color: C.red, fontSize: 13 }}>⚠ {error}</div>
          )}

          {/* To */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>To</label>
            <input
              value={toEmail}
              onChange={e => setToEmail(e.target.value)}
              placeholder="recipient@company.com"
              style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text }}
            />
          </div>

          {/* Subject */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={loading ? "Generating…" : "Subject line"}
              style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text }}
            />
          </div>

          {/* Body */}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 4 }}>Message</label>
            {loading && !body ? (
              <div style={{ background: C.alt, borderRadius: 7, border: `1px solid ${C.border}`, padding: "20px 14px", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>✨</div>
                Drafting your email with Claude…
              </div>
            ) : (
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={10}
                style={{ width: "100%", padding: "9px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, outline: "none", color: C.text, resize: "vertical", lineHeight: 1.65 }}
              />
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <a
            href={subject && body ? mailtoLink : "#"}
            onClick={e => { if (!subject || !body) e.preventDefault(); }}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 8, textAlign: "center",
              fontSize: 13, fontWeight: 700, textDecoration: "none",
              background: subject && body ? "linear-gradient(135deg, #1A56DB, #2563EB)" : C.alt,
              color: subject && body ? "#fff" : C.textSub,
              pointerEvents: subject && body ? "auto" : "none",
              boxShadow: subject && body ? "0 2px 8px rgba(26,86,219,0.35)" : "none",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            ✉ Open in Mail Client
          </a>
          <button
            onClick={copyAll}
            disabled={!subject || !body}
            style={{
              padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
              fontFamily: C.font,
              background: copied ? C.greenBg : C.alt,
              color:      copied ? C.green   : C.textMid,
              border:     `1px solid ${copied ? C.greenBd : C.border}`,
            }}
          >
            {copied ? "✓ Copied!" : "⎘ Copy"}
          </button>
          <button
            onClick={onClose}
            style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: C.font, background: "none", color: C.textSub, border: `1px solid ${C.border}` }}
          >
            Close
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ServiceRequestsView() {
  const [requests, setRequests]   = useState<ServiceRequest[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [emailOpp, setEmailOpp]   = useState<ServiceRequest | null>(null);

  // filters
  const [filterClient, setFilterClient]   = useState("all");
  const [filterTier, setFilterTier]       = useState("all");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [search, setSearch]               = useState("");

  // sort
  const [sortKey, setSortKey] = useState<SortKey>("expectedCloseDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/service-requests");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setRequests(data.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const clients = useMemo(() => {
    const s = new Set(requests.map(r => r.client));
    return ["all", ...Array.from(s).sort()];
  }, [requests]);

  const filtered = useMemo(() => {
    let list = requests;
    if (filterClient !== "all") list = list.filter(r => r.client === filterClient);
    if (filterTier   !== "all") list = list.filter(r => probTier(r.probability) === filterTier);
    if (filterOverdue)          list = list.filter(r => isOverdue(r.expectedCloseDate));
    if (search.trim())          list = list.filter(r =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.client.toLowerCase().includes(search.toLowerCase())
    );
    return [...list].sort((a, b) => {
      let av: any = a[sortKey];
      let bv: any = b[sortKey];
      if (sortKey === "expectedCloseDate") {
        av = av ? new Date(av).getTime() : Infinity;
        bv = bv ? new Date(bv).getTime() : Infinity;
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [requests, filterClient, filterTier, filterOverdue, search, sortKey, sortDir]);

  const totalPipeline = filtered.reduce((s, r) => s + r.projectedTotal, 0);
  const totalWeighted = filtered.reduce((s, r) => s + r.weightedTotal, 0);
  const overdueCount  = filtered.filter(r => isOverdue(r.expectedCloseDate)).length;
  const hotCount      = filtered.filter(r => probTier(r.probability) === "hot").length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortArrow = (k: SortKey) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div style={{ fontFamily: C.font }}>

      {emailOpp && <EmailModal opp={emailOpp} onClose={() => setEmailOpp(null)} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Service Requests</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 3 }}>
            Open opportunities from NetSuite — track, filter, and send follow-up emails.
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ background: loading ? C.alt : C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font }}
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.red, fontSize: 13 }}>⚠ {error}</div>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Open Opportunities",  value: filtered.length,    sub: `of ${requests.length} total`,       color: C.blue,                bg: C.blueBg,                bd: C.blueBd  },
          { label: "Total Pipeline",      value: fmt$(totalPipeline), sub: "projected value",                   color: C.text,                bg: "#F7F9FC",               bd: C.border  },
          { label: "Weighted Pipeline",   value: fmt$(totalWeighted), sub: "probability-adjusted",              color: C.text,                bg: "#F7F9FC",               bd: C.border  },
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
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search title or client…"
          style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", outline: "none", width: 220 }}
        />
        <select
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}
        >
          {clients.map(c => <option key={c} value={c}>{c === "all" ? "All Clients" : c}</option>)}
        </select>
        <select
          value={filterTier}
          onChange={e => setFilterTier(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}
        >
          <option value="all">All Tiers</option>
          <option value="hot">🔥 Hot (≥50%)</option>
          <option value="warm">🌡 Warm (20–49%)</option>
          <option value="cold">🧊 Cold (&lt;20%)</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textMid, cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={filterOverdue} onChange={e => setFilterOverdue(e.target.checked)} style={{ cursor: "pointer" }} />
          Overdue only
        </label>
        <div style={{ marginLeft: "auto", fontSize: 13, color: C.textSub }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</div>
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        {loading ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>Loading from NetSuite…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>📭</div>No open opportunities match your filters.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.alt, borderBottom: `1px solid ${C.border}` }}>
                  {([ ["tranId","#"], ["title","Opportunity"], ["client","Client"], ["probability","Probability"], ["projectedTotal","Projected"], ["weightedTotal","Weighted"], ["expectedCloseDate","Close Date"], ["daysOpen","Days Open"] ] as [SortKey, string][]).map(([key, label]) => (
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

                  return (
                    <tr
                      key={r.id}
                      style={{ background: rowBg, borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.blueBg)}
                      onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                    >
                      {/* # */}
                      <td style={{ padding: "10px 13px", fontSize: 12, color: C.textSub, fontFamily: C.mono, whiteSpace: "nowrap" }}>{r.tranId}</td>

                      {/* Title */}
                      <td style={{ padding: "10px 13px", minWidth: 180 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.title}</div>
                        {r.actionItem && (
                          <div style={{ fontSize: 11, color: C.orange, marginTop: 2, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ {r.actionItem}</div>
                        )}
                      </td>

                      {/* Client */}
                      <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 13, color: C.text }}>{r.client}</div>
                        {r.email && <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>{r.email}</div>}
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

                      {/* Days Open */}
                      <td style={{ padding: "10px 13px", fontSize: 13, fontFamily: C.mono, color: r.daysOpen > 60 ? C.red : r.daysOpen > 30 ? C.yellow : C.textMid, whiteSpace: "nowrap" }}>
                        {r.daysOpen}d
                      </td>

                      {/* Activity */}
                      <td style={{ padding: "10px 13px", minWidth: 160 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {r.noteCount > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 9, background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}` }}>
                                {r.noteCount} note{r.noteCount !== 1 ? "s" : ""}
                              </span>
                            </div>
                          )}
                          {r.lastModifiedDate && (
                            <div style={{ fontSize: 11, color: C.textSub }}>
                              Updated {timeAgo(r.lastModifiedDate)}
                            </div>
                          )}
                          {r.memo && (
                            <div style={{ fontSize: 11, color: C.textMid, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.memo}>
                              {r.memo}
                            </div>
                          )}
                          {r.noteCount === 0 && !r.memo && (
                            <span style={{ fontSize: 11, color: C.textSub, fontStyle: "italic" }}>No activity yet</span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "10px 13px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <button
                            onClick={() => setEmailOpp(r)}
                            title={r.email ? `Email ${r.email}` : "Draft email"}
                            style={{
                              padding: "4px 11px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                              cursor: "pointer", fontFamily: C.font,
                              background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`,
                              display: "flex", alignItems: "center", gap: 4,
                            }}
                          >
                            ✉ Email
                          </button>
                          <a
                            href={r.nsUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ padding: "4px 11px", borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: "none", background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}` }}
                          >
                            ↗ NS
                          </a>
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

      {/* Summary footer */}
      {filtered.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 16, fontSize: 12, color: C.textSub }}>
          <span>🔥 Hot: <strong style={{ color: C.text }}>{hotCount}</strong></span>
          <span>💰 Pipeline: <strong style={{ color: C.text, fontFamily: C.mono }}>{fmt$(totalPipeline)}</strong></span>
          <span>⚖ Weighted: <strong style={{ color: C.text, fontFamily: C.mono }}>{fmt$(totalWeighted)}</strong></span>
          {overdueCount > 0 && <span style={{ color: C.red }}>⚠ {overdueCount} overdue</span>}
        </div>
      )}
    </div>
  );
}
