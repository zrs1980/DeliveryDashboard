"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { C } from "@/lib/constants";

// ─── Pipeline board ─────────────────────────────────────────────────────────
//
// Columns are NetSuite's own stages, seeded from its `entitystatus` table with
// each stage's probability. Stages nobody currently sits in are still shown —
// a board needs the column to exist before a deal reaches it.
//
// ⚠ VALUE IS `projected_total`, NOT `total`. Across the same 295 opportunities
// those sum to $7.79M and $927k, because `total` only fills once a deal
// transacts. The headline figure counts OPEN deals only; including won and lost
// would make it meaningless and it would only ever climb.
//
// ON COLOUR: won and lost are factual terminal states, not health judgments, so
// they get green and muted grey. Open stages stay neutral — a deal at
// "Estimating" is not amber, it is just at Estimating.

interface Stage {
  id: string; name: string; probability: number | null;
  sort_order: number; is_won: boolean; is_lost: boolean; is_open: boolean;
}
interface Opp {
  id: string; ns_opportunity_id: string | null; ns_tranid: string | null;
  customer_ns_id: string; customer_name: string | null;
  title: string; stage_id: string | null; stage_name: string | null;
  status: string | null; opportunity_type: string | null;
  projected_total: number | null; probability: number | null;
  expected_close: string | null; owner_name: string | null;
  source: string;
}

const money = (n: number | null) => {
  if (n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
};
const fullMoney = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function CrmPipeline({ onOpenCustomer }: { onOpenCustomer?: (id: string, name: string) => void }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [opps, setOpps]     = useState<Opp[]>([]);
  const [summary, setSummary] = useState<{ open: number; pipelineValue: number; weightedValue: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/crm/opportunities${openOnly ? "?open=1" : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setStages(json.stages ?? []);
      setOpps(json.opportunities ?? []);
      setSummary(json.summary ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, [openOnly]);

  useEffect(() => { load(); }, [load]);

  async function move(opp: Opp, stageId: string) {
    setMoving(opp.id); setError(null);
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: opp.id, stageId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      if (json.warning) setError(json.warning);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setMoving(null); }
  }

  // Only columns that hold something, plus every open stage — otherwise a board
  // of 30 NetSuite statuses is mostly empty columns nobody can scan past.
  const columns = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of opps) if (o.stage_id) counts[o.stage_id] = (counts[o.stage_id] ?? 0) + 1;
    return stages
      .filter(s => s.is_open || counts[s.id])
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [stages, opps]);

  const byStage = useMemo(() => {
    const m: Record<string, Opp[]> = {};
    for (const o of opps) {
      const k = o.stage_id ?? "unstaged";
      (m[k] ??= []).push(o);
    }
    return m;
  }, [opps]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        {summary && (
          <>
            <Tile value={String(summary.open)} label="open deals" />
            <Tile value={fullMoney(summary.pipelineValue)} label="pipeline" />
            <Tile value={fullMoney(summary.weightedValue)} label="weighted" />
          </>
        )}
        <label style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center",
                        fontSize: 12, color: C.textMid }}>
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} />
          Open deals only
        </label>
        <button onClick={load} disabled={loading} style={btn(C.blue, true)}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, color: C.yellow,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {!loading && opps.length === 0 && (
        <div style={{ padding: "32px 0", textAlign: "center", color: C.textSub, fontSize: 13, lineHeight: 1.7 }}>
          No opportunities yet.<br />
          Run <span style={{ fontFamily: C.mono }}>Sync from NetSuite</span> to pull in the 295 that exist there.
        </div>
      )}

      {/* The board. Horizontal scroll is the right answer for a pipeline —
          stacking stages vertically loses the left-to-right progression that
          makes a board readable at all. */}
      {opps.length > 0 && (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 10 }}>
          {columns.map(s => {
            const items = byStage[s.id] ?? [];
            const value = items.reduce((n, o) => n + (o.projected_total ?? 0), 0);
            return (
              <div key={s.id} style={{ minWidth: 260, maxWidth: 260, flex: "0 0 auto" }}>
                <div style={{
                  padding: "8px 11px", borderRadius: "8px 8px 0 0",
                  background: s.is_won ? C.greenBg : s.is_lost ? C.alt : C.blueBg,
                  border: `1px solid ${s.is_won ? C.greenBd : s.is_lost ? C.border : C.blueBd}`,
                  borderBottom: "none",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700,
                                   color: s.is_won ? C.green : s.is_lost ? C.textMid : C.blue }}>
                      {s.name}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub }}>{items.length}</span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub, marginTop: 2 }}>
                    {money(value)}{s.probability !== null ? ` · ${s.probability}%` : ""}
                  </div>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: "0 0 8px 8px",
                              background: C.alt, padding: 8, minHeight: 90 }}>
                  {items.length === 0 && (
                    <div style={{ fontSize: 11, color: C.textSub, textAlign: "center", padding: "14px 0" }}>—</div>
                  )}
                  {items.map(o => (
                    <div key={o.id} style={{
                      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7,
                      padding: "9px 11px", marginBottom: 7, opacity: moving === o.id ? 0.5 : 1,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.35 }}>
                        {o.title}
                      </div>
                      <button
                        onClick={() => o.customer_name && onOpenCustomer?.(o.customer_ns_id, o.customer_name)}
                        style={{ background: "none", border: "none", padding: 0, marginTop: 3,
                                 fontSize: 11, color: C.blue, cursor: onOpenCustomer ? "pointer" : "default",
                                 fontFamily: C.font, textAlign: "left" }}
                      >
                        {o.customer_name ?? o.customer_ns_id}
                      </button>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 5, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: C.mono, color: C.text }}>
                          {money(o.projected_total)}
                        </span>
                        {o.expected_close && (
                          <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub }}>
                            {o.expected_close}
                          </span>
                        )}
                        {o.source === "manual" && (
                          <span style={{ fontSize: 9, color: C.purple, background: C.purpleBg,
                                         border: `1px solid ${C.purpleBd}`, borderRadius: 3, padding: "0 4px" }}>
                            local
                          </span>
                        )}
                      </div>
                      {o.opportunity_type && (
                        <div style={{ fontSize: 10, color: C.textSub, marginTop: 3 }}>{o.opportunity_type}</div>
                      )}

                      <select
                        value={o.stage_id ?? ""}
                        disabled={moving === o.id}
                        onChange={e => e.target.value && move(o, e.target.value)}
                        style={{ width: "100%", marginTop: 7, padding: "3px 6px", fontSize: 11,
                                 border: `1px solid ${C.border}`, borderRadius: 5,
                                 fontFamily: C.font, color: C.textMid, background: C.alt }}
                      >
                        <option value="">Move to…</option>
                        {stages.filter(x => !x.id.startsWith("__")).map(x => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 11, color: C.textSub, marginTop: 10, lineHeight: 1.6 }}>
        Value is NetSuite&apos;s projected total on open deals only. Moving a deal to a won or
        lost column closes it. Opportunities mirrored from NetSuite can be moved here, but the
        next sync will restore NetSuite&apos;s stage — change it there to make it stick.
      </p>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: "9px 14px", boxShadow: C.sh }}>
      <div style={{ fontSize: 19, fontWeight: 700, fontFamily: C.mono, color: C.text, lineHeight: 1.15 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: C.textSub, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  );
}

const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
