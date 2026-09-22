"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { C } from "@/lib/constants";

// ─── Releases — ingest, match, curate, generate ─────────────────────────────
//
// The core value of the build: ten customers receive ten different documents.
// The failure mode is ten near-identical ones, so the matching step reports how
// much overlap there is between customers and says so when it is too high.
//
// Curation before generation is deliberate (docs/05-RELEASE-MATCHING.md): the
// matrix is where a person toggles items in or out per customer and fixes the
// reasoning text, because that reasoning appears verbatim in the customer's PDF.

const ReleasePdfPreview = dynamic(
  () => import("@/components/reports/ReleasePdfPreview").then(m => m.ReleasePdfPreview),
  { ssr: false, loading: () => <span style={{ fontSize: 12, color: C.textSub }}>Loading preview…</span> },
);

interface Item {
  id: string; product: string; release_version: string; release_date: string | null;
  title: string; description: string; modules_affected: string[];
  category: string | null;
}
interface Match {
  id: string; release_item_id: string; customer_ns_id: string;
  relevance_score: number; reasoning: string;
  matched_on: { attributes?: string[]; actionRequired?: boolean; category?: string };
  included_in_pdf: boolean;
}
interface MatchRunCustomer { customerNsId: string; customerName: string; matched: number; titles: string[] }

export default function CsReleases() {
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion]   = useState("");
  const [items, setItems]       = useState<Item[]>([]);
  const [matches, setMatches]   = useState<Match[]>([]);
  const [names, setNames]       = useState<Record<string, string>>({});
  const [busy, setBusy]         = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ customers: MatchRunCustomer[]; maxOverlap: number; warnings: string[] } | null>(null);
  const [showIngest, setShowIngest] = useState(false);
  const [form, setForm] = useState({ product: "netsuite", version: "", releaseDate: "", notes: "" });
  const [selected, setSelected] = useState<string | null>(null);

  const loadItems = useCallback(async (v?: string) => {
    setError(null);
    try {
      const res  = await fetch(`/api/cs/releases${v ? `?version=${encodeURIComponent(v)}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setItems(json.items ?? []);
      setVersions(json.versions ?? []);
      if (!v && json.versions?.length) setVersion(json.versions[0]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
  }, []);

  const loadMatches = useCallback(async (v: string) => {
    if (!v) return;
    try {
      const res  = await fetch(`/api/cs/releases/match?version=${encodeURIComponent(v)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setMatches(json.matches ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { if (version) { loadItems(version); loadMatches(version); } }, [version, loadItems, loadMatches]);

  // Customer names, for the matrix. Cheap enough to read from the CS list.
  useEffect(() => {
    fetch("/api/cs/customers").then(r => r.json()).then(j => {
      const m: Record<string, string> = {};
      for (const c of j.customers ?? []) m[c.customerNsId] = c.name;
      setNames(m);
    }).catch(() => { /* names fall back to ids */ });
  }, []);

  async function ingest() {
    setBusy("Parsing release notes…"); setError(null);
    try {
      const res  = await fetch("/api/cs/releases", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setShowIngest(false);
      setVersion(form.version);
      await loadItems(form.version);
      setError(`Parsed ${json.parsed} items${json.dropped ? `, ${json.dropped} dropped as unusable` : ""}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  }

  async function runMatch() {
    setBusy("Matching every customer — one call each…"); setError(null); setRunResult(null);
    try {
      const res  = await fetch("/api/cs/releases/match", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setRunResult(json);
      await loadMatches(version);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  }

  async function toggle(m: Match) {
    try {
      await fetch("/api/cs/releases/match", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, includedInPdf: !m.included_in_pdf }),
      });
      setMatches(ms => ms.map(x => x.id === m.id ? { ...x, included_in_pdf: !x.included_in_pdf } : x));
    } catch { /* the toggle reverts on next load */ }
  }

  const itemById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items]);
  const byCustomer = useMemo(() => {
    const m: Record<string, Match[]> = {};
    for (const x of matches) (m[x.customer_ns_id] ??= []).push(x);
    for (const k of Object.keys(m)) m[k].sort((a, b) => b.relevance_score - a.relevance_score);
    return m;
  }, [matches]);

  const current = items[0];

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <select value={version} onChange={e => setVersion(e.target.value)}
                style={{ padding: "5px 9px", fontSize: 13, border: `1px solid ${C.mid}`, borderRadius: 6, fontFamily: C.font }}>
          {versions.length === 0 && <option value="">No releases ingested</option>}
          {versions.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <span style={{ fontSize: 12, color: C.textSub }}>{items.length} items · {matches.length} matches</span>
        <button onClick={() => setShowIngest(s => !s)} style={btn(C.blue, true)}>
          {showIngest ? "Cancel" : "+ Paste release notes"}
        </button>
        {version && (
          <button onClick={runMatch} disabled={!!busy} style={btn(C.purple)}>
            {busy ? busy : "Match all customers"}
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, color: C.textMid,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {showIngest && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <select value={form.product} onChange={e => setForm({ ...form, product: e.target.value })} style={inp}>
              <option value="netsuite">NetSuite</option>
              <option value="loop_erp">Loop ERP</option>
            </select>
            <input placeholder="Version, e.g. 2026.2" value={form.version}
                   onChange={e => setForm({ ...form, version: e.target.value })} style={inp} />
            <input type="date" value={form.releaseDate}
                   onChange={e => setForm({ ...form, releaseDate: e.target.value })} style={inp} />
          </div>
          <textarea
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            rows={10}
            placeholder="Paste the release notes here. Manual paste is the supported path — an ingestion pipeline that breaks twice a year at exactly the moment you need it is worse than a paste box."
            style={{ width: "100%", padding: "9px 11px", fontSize: 12, fontFamily: C.font,
                     border: `1px solid ${C.mid}`, borderRadius: 6, resize: "vertical" }}
          />
          <button onClick={ingest} disabled={!!busy || !form.version || form.notes.length < 200}
                  style={{ ...btn(C.blue, true), marginTop: 8, opacity: (!form.version || form.notes.length < 200) ? 0.5 : 1 }}>
            {busy ?? "Parse into items"}
          </button>
        </div>
      )}

      {runResult && (
        <div style={{
          background: runResult.warnings.length ? C.yellowBg : C.greenBg,
          border: `1px solid ${runResult.warnings.length ? C.yellowBd : C.greenBd}`,
          color: runResult.warnings.length ? C.yellow : C.green,
          borderRadius: 8, padding: "10px 13px", fontSize: 12, marginBottom: 12, lineHeight: 1.6,
        }}>
          Matched {runResult.customers.length} customers. Highest overlap between any two:{" "}
          <strong>{Math.round(runResult.maxOverlap * 100)}%</strong>.
          {runResult.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          {!runResult.warnings.length && " Documents should read differently from each other."}
        </div>
      )}

      {/* Curation matrix */}
      {Object.keys(byCustomer).length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: C.textSub, marginBottom: 8 }}>
            Toggle items in or out per customer. The reasoning text appears verbatim in their PDF.
          </div>
          {Object.entries(byCustomer).map(([cid, ms]) => {
            const included = ms.filter(m => m.included_in_pdf);
            const isOpen = selected === cid;
            return (
              <div key={cid} style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8, background: C.surface }}>
                <div onClick={() => setSelected(isOpen ? null : cid)}
                     style={{ padding: "10px 14px", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{names[cid] ?? cid}</span>
                  <span style={{ fontSize: 12, fontFamily: C.mono, color: C.textMid }}>
                    {included.length} of {ms.length} included
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: C.textSub }}>{isOpen ? "hide" : "open"}</span>
                </div>

                {isOpen && (
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 14px", background: C.alt }}>
                    {ms.map(m => {
                      const it = itemById[m.release_item_id];
                      return (
                        <div key={m.id} style={{ marginBottom: 12, opacity: m.included_in_pdf ? 1 : 0.45 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                            <input type="checkbox" checked={m.included_in_pdf} onChange={() => toggle(m)} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{it?.title ?? "—"}</span>
                            <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub }}>
                              {Math.round(m.relevance_score * 100)}%
                            </span>
                            {m.matched_on?.actionRequired && (
                              <span style={{ fontSize: 10, color: C.orange, background: C.orangeBg,
                                             border: `1px solid ${C.orangeBd}`, borderRadius: 4, padding: "1px 6px" }}>
                                action needed
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: C.textMid, marginTop: 3, marginLeft: 22, lineHeight: 1.5 }}>
                            {m.reasoning}
                          </div>
                          {!!m.matched_on?.attributes?.length && (
                            <div style={{ fontSize: 10, color: C.textSub, marginLeft: 22, marginTop: 2, fontFamily: C.mono }}>
                              matched on: {m.matched_on.attributes.join(" · ")}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {included.length > 0 && current && (
                      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 4 }}>
                        <ReleasePdfPreview
                          compact
                          customerName={names[cid] ?? cid}
                          product={current.product}
                          version={current.release_version}
                          releaseDate={current.release_date}
                          preparedBy="Loop Services"
                          intro={`We go through each NetSuite release and pull out only what affects how you actually use the system. Here is what we found for ${names[cid] ?? "you"} in ${current.release_version}.`}
                          items={included.map(m => {
                            const it = itemById[m.release_item_id];
                            return {
                              title: it?.title ?? "",
                              description: it?.description ?? "",
                              category: it?.category ?? null,
                              reasoning: m.reasoning,
                              actionRequired: Boolean(m.matched_on?.actionRequired),
                              modules: it?.modules_affected ?? [],
                            };
                          })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {items.length === 0 && !showIngest && (
        <div style={{ padding: "30px 0", textAlign: "center", color: C.textSub, fontSize: 13, lineHeight: 1.7 }}>
          No releases ingested yet.<br />
          Paste the notes for a release and they are broken into individually matchable items.
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: "5px 9px", fontSize: 13, border: `1px solid ${C.mid}`,
  borderRadius: 6, fontFamily: C.font, background: C.surface,
};
const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
