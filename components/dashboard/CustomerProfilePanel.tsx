"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";

// ─── Customer profile — view, verify, re-extract ─────────────────────────────
//
// docs/02-CUSTOMER-PROFILES.md asks for: a structured summary, every claim
// expandable to its evidence, confidence indicators, inline human correction,
// and a re-extract action with a diff BEFORE committing.
//
// Two display rules worth keeping:
//
// 1. NO RAG COLOURS. Confidence is not health. The design system reserves
//    green/amber/red for RAG status, and colouring "low confidence" red would
//    read as "this customer is in trouble". Confidence is a plain monospace
//    label; only observed-vs-inferred gets a tint, in blue, because that is the
//    distinction that decides whether a claim may be quoted to a customer.
//
// 2. EVIDENCE IS ALWAYS ONE CLICK AWAY. A profile whose claims cannot be traced
//    is worse than no profile, because it will be believed anyway. Every item
//    expands to the case ids, project notes and memo quotes behind it.

interface EvidencedItem {
  description:   string;
  evidence_refs: string[];
  confidence:    "high" | "medium" | "low";
  basis:         "observed" | "inferred";
}

interface Profile {
  customer_ns_id:    string;
  customer_name:     string;
  modules_owned:     string[];
  integrations:      string[];
  netsuite_edition:  string | null;
  industry:          string | null;
  company_size:      string | null;
  customisations:    EvidencedItem[];
  pain_points:       EvidencedItem[];
  manual_processes:  EvidencedItem[];
  features_enquired_not_purchased: EvidencedItem[];
  declined_items:    EvidencedItem[];
  extracted_at:      string;
  extraction_version: string;
  human_verified:    boolean;
  human_notes:       string | null;
}

interface ExtractMeta {
  corpus?: { projects: number; cases: number; uniqueMemos: number; notes: string[] };
  droppedUnevidenced?: Record<string, number>;
  contradictionsResolved?: string[];
}

export default function CustomerProfilePanel({
  customerNsId, customerName, onClose,
}: { customerNsId: string; customerName: string; onClose: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pending, setPending] = useState<Profile | null>(null);   // dry-run awaiting a decision
  const [meta,    setMeta]    = useState<ExtractMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [notes,   setNotes]   = useState("");
  const [notesDirty, setNotesDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/cs/profiles?customerNsId=${encodeURIComponent(customerNsId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setProfile(json.profile ?? null);
      setNotes(json.profile?.human_notes ?? "");
      setNotesDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, [customerNsId]);

  useEffect(() => { load(); }, [load]);

  async function extract(dryRun: boolean) {
    setBusy(dryRun ? "Re-extracting…" : "Extracting…");
    setError(null);
    try {
      const res = await fetch("/api/cs/profiles/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerNsId, dryRun }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setMeta({
        corpus: json.corpus,
        droppedUnevidenced: json.droppedUnevidenced,
        contradictionsResolved: json.contradictionsResolved,
      });
      if (dryRun) setPending(json.profile);
      else { setProfile(json.profile); setNotes(json.profile?.human_notes ?? ""); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(null); }
  }

  async function acceptPending() {
    if (!pending) return;
    setBusy("Saving…"); setError(null);
    try {
      const res = await fetch("/api/cs/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerNsId, customerName, profile: pending }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setProfile(json.profile); setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(null); }
  }

  async function patch(body: Record<string, unknown>) {
    setBusy("Saving…"); setError(null);
    try {
      const res = await fetch("/api/cs/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerNsId, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setProfile(json.profile); setNotesDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(null); }
  }

  const shown = pending ?? profile;

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 18, paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{customerName}</h3>
        {profile && (
          <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
            extracted {new Date(profile.extracted_at).toLocaleDateString()} · {profile.extraction_version}
          </span>
        )}
        {profile?.human_verified && !pending && (
          <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, background: C.blueBg,
                         border: `1px solid ${C.blueBd}`, borderRadius: 5, padding: "2px 7px" }}>
            ✓ Verified
          </span>
        )}
        <button onClick={onClose} style={btn(C.textSub)}>Close</button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading && <div style={{ color: C.textSub, fontSize: 13, padding: "18px 0" }}>Loading profile…</div>}

      {!loading && !profile && !pending && (
        <div style={{ padding: "18px 0" }}>
          <p style={{ fontSize: 13, color: C.textMid, marginTop: 0 }}>
            No profile yet. Extraction reads this customer&apos;s projects, support cases and
            consultant time memos, and takes up to a couple of minutes on a large account.
          </p>
          <button onClick={() => extract(false)} disabled={!!busy} style={btn(C.blue, true)}>
            {busy ?? "Extract profile"}
          </button>
        </div>
      )}

      {pending && (
        <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, borderRadius: 8,
                      padding: "11px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.blue, marginBottom: 4 }}>
            New extraction — not saved yet
          </div>
          <div style={{ fontSize: 12, color: C.textMid, marginBottom: 9, lineHeight: 1.5 }}>
            You are looking at the new version. {profile
              ? "The stored profile is unchanged until you keep this one."
              : "Nothing is stored for this customer yet."}
            {profile?.human_verified && " Keeping it will clear the verified mark, since what you checked is not what would be stored."}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={acceptPending} disabled={!!busy} style={btn(C.blue, true)}>
              {busy ?? "Keep this version"}
            </button>
            <button onClick={() => { setPending(null); setMeta(null); }} disabled={!!busy} style={btn(C.textMid)}>
              Discard
            </button>
          </div>
        </div>
      )}

      {meta && (meta.contradictionsResolved?.length || Object.keys(meta.droppedUnevidenced ?? {}).length || meta.corpus) && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: "9px 13px", marginBottom: 14, fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>
          {meta.corpus && (
            <div>Read {meta.corpus.projects} projects · {meta.corpus.cases} cases · {meta.corpus.uniqueMemos} unique time memos.</div>
          )}
          {!!meta.contradictionsResolved?.length && (
            <div>
              Struck from the owned lists: <strong>{meta.contradictionsResolved.join(", ")}</strong> — each was
              also recorded as never purchased, with evidence.
            </div>
          )}
          {!!Object.keys(meta.droppedUnevidenced ?? {}).length && (
            <div>Dropped for citing no evidence: {Object.entries(meta.droppedUnevidenced!).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}.</div>
          )}
          {meta.corpus?.notes?.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      )}

      {shown && (
        <>
          <Facts p={shown} />
          <Section title="Manual processes" hint="Cross-sell targets — the business case is already in the customer's words." items={shown.manual_processes} />
          <Section title="Pain points"      items={shown.pain_points} />
          <Section title="Customisations"   items={shown.customisations} />
          <Section title="Enquired, not purchased" hint="Dormant opportunities." items={shown.features_enquired_not_purchased} />
          <Section title="Declined"         hint="Suppression input — do not pitch these again." items={shown.declined_items} />

          {!pending && (
            <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                              textTransform: "uppercase", color: C.textSub, marginBottom: 6 }}>
                Your notes — never overwritten by re-extraction
              </label>
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); setNotesDirty(true); }}
                rows={3}
                placeholder="What the extraction missed, or got wrong…"
                style={{ width: "100%", padding: "8px 11px", fontSize: 13, fontFamily: C.font,
                         border: `1px solid ${C.mid}`, borderRadius: 6, color: C.text, resize: "vertical" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => patch({ human_notes: notes })} disabled={!!busy || !notesDirty} style={btn(C.blue, notesDirty)}>
                  Save notes
                </button>
                <button onClick={() => patch({ human_verified: !profile?.human_verified })} disabled={!!busy} style={btn(C.textMid)}>
                  {profile?.human_verified ? "Remove verified mark" : "Mark as verified"}
                </button>
                <button onClick={() => extract(true)} disabled={!!busy} style={btn(C.purple)}>
                  {busy ?? "Re-extract"}
                </button>
                <span style={{ fontSize: 11, color: C.textSub }}>
                  Re-extract shows the new version first; nothing is replaced until you keep it.
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Facts({ p }: { p: Profile }) {
  const row = (label: string, value: string) => (
    <div style={{ marginBottom: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                     color: C.textSub, marginRight: 8 }}>{label}</span>
      <span style={{ fontSize: 13, color: C.text }}>{value}</span>
    </div>
  );
  return (
    <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: "12px 14px", marginBottom: 16 }}>
      {row("Modules", p.modules_owned.join(" · ") || "—")}
      {row("Integrations", p.integrations.join(" · ") || "—")}
      {row("Edition", p.netsuite_edition ?? "—")}
      {(p.industry || p.company_size) && row("Industry", [p.industry, p.company_size].filter(Boolean).join(" · "))}
    </div>
  );
}

function Section({ title, items, hint }: { title: string; items: EvidencedItem[]; hint?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</h4>
        <span style={{ fontSize: 12, color: C.textSub, fontFamily: C.mono }}>{items.length}</span>
        {hint && <span style={{ fontSize: 11, color: C.textSub }}>{hint}</span>}
      </div>
      {items.length === 0
        ? <div style={{ fontSize: 12, color: C.textSub, fontStyle: "normal" }}>Nothing found in the record.</div>
        : items.map((it, i) => <Item key={i} item={it} />)}
    </div>
  );
}

function Item({ item }: { item: EvidencedItem }) {
  const [open, setOpen] = useState(false);
  const observed = item.basis === "observed";
  return (
    <div style={{ borderLeft: `2px solid ${observed ? C.blueBd : C.border}`,
                  paddingLeft: 10, marginBottom: 9 }}>
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{item.description}</div>
      <div style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontFamily: C.mono, color: C.textSub, textTransform: "uppercase", letterSpacing: 0.3 }}>
          {item.confidence}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                       color: observed ? C.blue : C.textSub,
                       background: observed ? C.blueBg : "transparent",
                       border: `1px solid ${observed ? C.blueBd : C.border}` }}>
          {item.basis}
        </span>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                   fontSize: 11, color: C.blue, fontFamily: C.font }}
        >
          {open ? "hide evidence" : `evidence (${item.evidence_refs.length})`}
        </button>
      </div>
      {open && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
          {item.evidence_refs.map((r, i) => (
            <li key={i} style={{ fontSize: 11, color: C.textMid, fontFamily: C.mono, lineHeight: 1.6, wordBreak: "break-word" }}>
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
