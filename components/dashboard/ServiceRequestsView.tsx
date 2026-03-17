"use client";
import { useState, useEffect, useMemo } from "react";
import { C } from "@/lib/constants";
import type { ServiceRequest } from "@/app/api/service-requests/route";

// ── helpers ─────────────────────────────────────────────────────────────────
const fmt$ = (n: number) =>
  n === 0 ? "—" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
};

const isOverdue = (s: string | null) => {
  if (!s) return false;
  return new Date(s) < new Date();
};

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

// ── component ────────────────────────────────────────────────────────────────
export function ServiceRequestsView() {
  const [requests, setRequests]   = useState<ServiceRequest[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // filters
  const [filterClient, setFilterClient]   = useState("all");
  const [filterTier, setFilterTier]       = useState("all");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [search, setSearch]               = useState("");

  // sort
  const [sortKey, setSortKey] = useState<SortKey>("expectedCloseDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ── fetch ──────────────────────────────────────────────────────────────────
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

  // ── derived data ───────────────────────────────────────────────────────────
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

    // sort
    list = [...list].sort((a, b) => {
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

    return list;
  }, [requests, filterClient, filterTier, filterOverdue, search, sortKey, sortDir]);

  // KPI aggregates
  const totalPipeline   = filtered.reduce((s, r) => s + r.projectedTotal, 0);
  const totalWeighted   = filtered.reduce((s, r) => s + r.weightedTotal, 0);
  const overdueCount    = filtered.filter(r => isOverdue(r.expectedCloseDate)).length;
  const hotCount        = filtered.filter(r => probTier(r.probability) === "hot").length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: C.font }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Service Requests</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 3 }}>
            Open opportunities from NetSuite — track, filter, and prioritise incoming service work.
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: loading ? C.alt : C.blueBg, color: C.blue,
            border: `1px solid ${C.blueBd}`, borderRadius: 8,
            padding: "7px 16px", fontSize: 12, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer", fontFamily: C.font,
          }}
        >
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: C.red, fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Open Opportunities", value: filtered.length, sub: `of ${requests.length} total`, color: C.blue, bg: C.blueBg, bd: C.blueBd },
          { label: "Total Pipeline", value: fmt$(totalPipeline), sub: "projected value", color: C.text, bg: "#F7F9FC", bd: C.border },
          { label: "Weighted Pipeline", value: fmt$(totalWeighted), sub: "probability-adjusted", color: C.text, bg: "#F7F9FC", bd: C.border },
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
          style={{
            padding: "6px 12px", borderRadius: 7, border: `1px solid ${C.border}`,
            fontSize: 13, fontFamily: C.font, background: "#fff", outline: "none", width: 220,
          }}
        />

        <select
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, background: "#fff", cursor: "pointer" }}
        >
          {clients.map(c => (
            <option key={c} value={c}>{c === "all" ? "All Clients" : c}</option>
          ))}
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
          <input
            type="checkbox"
            checked={filterOverdue}
            onChange={e => setFilterOverdue(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Overdue only
        </label>

        <div style={{ marginLeft: "auto", fontSize: 13, color: C.textSub }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        {loading ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>⏳</div>
            Loading opportunities from NetSuite…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>📭</div>
            No open opportunities match your filters.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.alt, borderBottom: `1px solid ${C.border}` }}>
                  {([
                    ["tranId",           "#"],
                    ["title",            "Opportunity"],
                    ["client",           "Client"],
                    ["probability",      "Probability"],
                    ["projectedTotal",   "Projected Value"],
                    ["weightedTotal",    "Weighted"],
                    ["expectedCloseDate","Expected Close"],
                    ["daysOpen",         "Days Open"],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      style={{
                        padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700,
                        color: sortKey === key ? C.blue : C.textSub,
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
                      }}
                    >
                      {label}{SortIcon({ k: key })}
                    </th>
                  ))}
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Link
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const tier     = probTier(r.probability);
                  const ts       = TIER_STYLES[tier];
                  const overdue  = isOverdue(r.expectedCloseDate);
                  const rowBg    = i % 2 === 0 ? "#fff" : C.alt;

                  return (
                    <tr
                      key={r.id}
                      style={{ background: rowBg, borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.blueBg)}
                      onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                    >
                      {/* # */}
                      <td style={{ padding: "10px 14px", fontSize: 12, color: C.textSub, fontFamily: C.mono, whiteSpace: "nowrap" }}>
                        {r.tranId}
                      </td>

                      {/* Title */}
                      <td style={{ padding: "10px 14px", minWidth: 200 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.title}</div>
                        {r.memo && (
                          <div style={{ fontSize: 11, color: C.textSub, marginTop: 2, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.memo}
                          </div>
                        )}
                        {r.actionItem && (
                          <div style={{ fontSize: 11, color: C.orange, marginTop: 2, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            → {r.actionItem}
                          </div>
                        )}
                      </td>

                      {/* Client */}
                      <td style={{ padding: "10px 14px", fontSize: 13, color: C.text, whiteSpace: "nowrap" }}>
                        {r.client}
                      </td>

                      {/* Probability */}
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                            background: ts.bg, color: ts.color, border: `1px solid ${ts.bd}`,
                          }}>
                            {ts.label}
                          </span>
                          <span style={{ fontSize: 12, fontFamily: C.mono, color: C.textMid }}>
                            {Math.round(r.probability * 100)}%
                          </span>
                        </div>
                        {/* Probability bar */}
                        <div style={{ marginTop: 4, height: 3, background: C.border, borderRadius: 2, width: 80 }}>
                          <div style={{ height: "100%", borderRadius: 2, width: `${r.probability * 100}%`, background: ts.color }} />
                        </div>
                      </td>

                      {/* Projected Value */}
                      <td style={{ padding: "10px 14px", fontSize: 13, fontFamily: C.mono, color: C.text, whiteSpace: "nowrap" }}>
                        {fmt$(r.projectedTotal)}
                      </td>

                      {/* Weighted */}
                      <td style={{ padding: "10px 14px", fontSize: 13, fontFamily: C.mono, color: C.textMid, whiteSpace: "nowrap" }}>
                        {fmt$(r.weightedTotal)}
                      </td>

                      {/* Expected Close */}
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 13, fontFamily: C.mono, color: overdue ? C.red : C.text, fontWeight: overdue ? 700 : 400 }}>
                          {fmtDate(r.expectedCloseDate)}
                        </div>
                        {overdue && r.expectedCloseDate && (
                          <div style={{ fontSize: 11, color: C.red, marginTop: 1 }}>Overdue</div>
                        )}
                      </td>

                      {/* Days Open */}
                      <td style={{ padding: "10px 14px", fontSize: 13, fontFamily: C.mono, color: r.daysOpen > 60 ? C.red : r.daysOpen > 30 ? C.yellow : C.textMid, whiteSpace: "nowrap" }}>
                        {r.daysOpen}d
                      </td>

                      {/* Link */}
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <a
                          href={r.nsUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6,
                            background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}`,
                            textDecoration: "none", display: "inline-block",
                          }}
                        >
                          ↗ NetSuite
                        </a>
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
