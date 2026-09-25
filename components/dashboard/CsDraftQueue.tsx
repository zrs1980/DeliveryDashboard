"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { C } from "@/lib/constants";

// ─── Draft queue — the control surface ──────────────────────────────────────
//
// Every generated communication lands here first and nothing leaves without an
// explicit click. Permanently, not as a v1 safety measure.
//
// The spec's design constraint: "Optimise for fast approval. The human is the
// throughput bottleneck; every extra click is a queue that backs up." Hence
// keyboard shortcuts, one draft expanded at a time, and the rationale on screen
// without needing to open anything.
//
// "In practice most drafts will be approved in seconds. The 10% that get
// rewritten are the ones that would have cost something."
//
// Rejections and edits are the point of the queue, not friction in it — a
// rejection reason is how generation improves, and the diff between generated
// and sent is the highest-value training data in the system.

interface SuppressionCheck { rule: string; outcome: string; detail: string }
interface Draft {
  id: string; customer_ns_id: string; contact_id: string | null;
  contactName: string | null; contactEmail: string | null; contactRole: string | null;
  contactOptedOut: boolean; contactInactive: boolean;
  motion: string; subject: string; body: string; original_body: string | null;
  rationale: string; evidence: Record<string, unknown>;
  status: string; generated_at: string; expires_at: string | null;
  rejection_reason: string | null;
  suppression_checks: { checks?: SuppressionCheck[]; blocked?: boolean } | null;
  isExpired?: boolean; isSnoozed?: boolean;
}

export default function CsDraftQueue() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<{ subject: string; body: string } | null>(null);
  const [reason, setReason]   = useState("");
  const [to, setTo]           = useState("");
  const [busy, setBusy]       = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Pre-fill the recipient from the draft's own contact. Keyed on the draft id
  // rather than the cursor so moving through the queue and back re-fills, but a
  // reviewer who has typed over it is not overwritten mid-edit.
  const currentId = drafts[cursor]?.id;
  useEffect(() => {
    const d = drafts.find(x => x.id === currentId);
    setTo(d?.contactEmail ?? "");
  }, [currentId, drafts]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/cs/drafts");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setDrafts(json.drafts ?? []);
      setCursor(c => Math.min(c, Math.max(0, (json.drafts?.length ?? 1) - 1)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = drafts[cursor];

  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!current || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/cs/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      if (json.warning) setError(json.warning);
      setEditing(null); setReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(false); }
  }, [current, busy, load]);

  // Shortcuts. Ignored while typing, so a reason containing "a" does not
  // approve the draft being rejected.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "j") { setCursor(c => Math.min(c + 1, drafts.length - 1)); setEditing(null); }
      if (e.key === "k") { setCursor(c => Math.max(c - 1, 0)); setEditing(null); }
      if (e.key === "e" && current) setEditing({ subject: current.subject, body: current.body });
      if (e.key === "s") act("snooze", { snoozeDays: 7 });
      if (e.key === "a" && to.trim()) act("approve_send", { to: to.trim() });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drafts.length, current, act, to]);

  if (loading) return <div style={{ padding: "30px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>Loading queue…</div>;

  return (
    <div ref={rootRef}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: C.textSub }}>
          {drafts.length} awaiting review
        </span>
        <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
          j/k move · e edit · s snooze · a approve &amp; send
        </span>
        <button onClick={load} style={btn(C.blue, true)}>↻ Refresh</button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {drafts.length === 0 && (
        <div style={{ padding: "34px 0", textAlign: "center", color: C.textSub, fontSize: 13, lineHeight: 1.7 }}>
          Nothing in the queue.<br />
          Drafts appear here once a motion generates them — nothing is ever sent without landing here first.
        </div>
      )}

      {current && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: C.alt }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4,
                             color: C.purple, background: C.purpleBg, border: `1px solid ${C.purpleBd}`,
                             borderRadius: 5, padding: "1px 7px" }}>
                {current.motion.replace(/_/g, " ")}
              </span>
              <span style={{ fontSize: 12, color: C.textMid, fontFamily: C.mono }}>
                customer {current.customer_ns_id}
              </span>
              {current.isExpired && (
                <span style={{ fontSize: 11, fontWeight: 700, color: C.red, background: C.redBg,
                               border: `1px solid ${C.redBd}`, borderRadius: 5, padding: "1px 7px" }}>
                  Expired — regenerate rather than send
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
                {cursor + 1} / {drafts.length}
              </span>
            </div>

            {/* Why this, why now — non-negotiable field */}
            <div style={{ marginTop: 8, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
              <strong style={{ color: C.textSub, fontSize: 11, textTransform: "uppercase",
                               letterSpacing: 0.4, marginRight: 6 }}>Why now</strong>
              {current.rationale}
            </div>
          </div>

          {/* The draft */}
          <div style={{ padding: "14px 16px" }}>
            {editing ? (
              <>
                <input
                  value={editing.subject}
                  onChange={e => setEditing({ ...editing, subject: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", fontSize: 14, fontWeight: 600,
                           border: `1px solid ${C.mid}`, borderRadius: 6, marginBottom: 8, fontFamily: C.font }}
                />
                <textarea
                  value={editing.body}
                  onChange={e => setEditing({ ...editing, body: e.target.value })}
                  rows={10}
                  style={{ width: "100%", padding: "9px 11px", fontSize: 13, lineHeight: 1.6,
                           border: `1px solid ${C.mid}`, borderRadius: 6, fontFamily: C.font, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => act("save_edit", editing)} disabled={busy} style={btn(C.blue, true)}>
                    Save edit
                  </button>
                  <button onClick={() => setEditing(null)} style={btn(C.textMid)}>Cancel</button>
                  <span style={{ fontSize: 11, color: C.textSub, alignSelf: "center" }}>
                    The original is kept — the difference between generated and sent is the training signal.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                  {current.subject}
                </div>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                  {current.body}
                </div>
                {current.original_body && (
                  <div style={{ marginTop: 10, fontSize: 11, color: C.textSub }}>
                    Edited. Original retained.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Evidence */}
          {Object.keys(current.evidence ?? {}).length > 0 && (
            <div style={{ padding: "0 16px 12px", fontSize: 11, fontFamily: C.mono, color: C.textSub }}>
              {Object.entries(current.evidence).map(([k, v]) => (
                <span key={k} style={{ marginRight: 12 }}>
                  {k}=<span style={{ color: C.textMid }}>{String(v)}</span>
                </span>
              ))}
            </div>
          )}

          {/* Suppression — collapsed, but present */}
          <div style={{ padding: "0 16px 12px" }}>
            <button onClick={() => setShowChecks(s => !s)} style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              fontSize: 11, color: C.blue, fontFamily: C.font,
            }}>
              {showChecks ? "hide" : "show"} suppression checks
              {current.suppression_checks?.checks
                ? ` (${current.suppression_checks.checks.filter(c => c.outcome === "passed").length} passed, ` +
                  `${current.suppression_checks.checks.filter(c => c.outcome === "skipped").length} not evaluated)`
                : ""}
            </button>
            {showChecks && (
              <div style={{ marginTop: 6 }}>
                {(current.suppression_checks?.checks ?? []).map(c => (
                  <div key={c.rule} style={{ fontSize: 11, color: C.textMid, lineHeight: 1.6 }}>
                    <span style={{ fontFamily: C.mono,
                                   color: c.outcome === "blocked" ? C.red : c.outcome === "skipped" ? C.textSub : C.green }}>
                      {c.outcome.padEnd(8)}
                    </span>
                    <strong style={{ marginRight: 6 }}>{c.rule}</strong>{c.detail}
                  </div>
                ))}
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 5, lineHeight: 1.5 }}>
                  A check recorded as <em>skipped</em> has not been passed — it could not run. Several
                  need cs_contacts and cs_commitments, which are not populated.
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, background: C.alt }}>
            {current.contactName && (
              <div style={{ fontSize: 11.5, color: C.textMid, marginBottom: 7, lineHeight: 1.5 }}>
                To <strong style={{ color: C.text }}>{current.contactName}</strong>
                {current.contactRole && current.contactRole !== "unknown"
                  ? ` · ${current.contactRole.replace(/_/g, " ")}` : ""}
                {current.contactOptedOut && (
                  <strong style={{ color: C.red }}> · OPTED OUT — suppression will block this</strong>
                )}
                {current.contactInactive && !current.contactOptedOut && (
                  <strong style={{ color: C.yellow }}> · marked departed</strong>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder={current.contact_id && !current.contactEmail
                  ? "No address recorded for this contact…"
                  : "Recipient email…"}
                style={{ flex: "1 1 200px", minWidth: 170, padding: "6px 10px", fontSize: 13,
                         border: `1px solid ${current.contactOptedOut ? C.redBd : C.mid}`,
                         borderRadius: 6, fontFamily: C.font }}
              />
              <button
                onClick={() => act("approve_send", { to: to.trim() })}
                disabled={busy || !to.trim() || current.isExpired}
                style={{ ...btn(C.green, true), background: C.greenBg, borderColor: C.greenBd,
                         opacity: busy || !to.trim() || current.isExpired ? 0.5 : 1 }}
              >
                {busy ? "…" : "Approve & send"}
              </button>
              <button onClick={() => setEditing({ subject: current.subject, body: current.body })}
                      disabled={busy} style={btn(C.blue)}>Edit</button>
              <button onClick={() => act("snooze", { snoozeDays: 7 })} disabled={busy} style={btn(C.textMid)}>
                Snooze 7d
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Reason — wrong timing · wrong person · tone off · factually wrong · not relevant · already handled"
                style={{ flex: "1 1 260px", minWidth: 200, padding: "6px 10px", fontSize: 12,
                         border: `1px solid ${C.mid}`, borderRadius: 6, fontFamily: C.font }}
              />
              <button
                onClick={() => act("reject", { rejectionReason: reason.trim() })}
                disabled={busy || !reason.trim()}
                style={{ ...btn(C.red), opacity: busy || !reason.trim() ? 0.5 : 1 }}
              >
                Reject
              </button>
            </div>
            <div style={{ fontSize: 11, color: C.textSub, marginTop: 7, lineHeight: 1.5 }}>
              Sends from your own mailbox, as you. Suppression is re-checked at the moment you
              send — a draft that has sat for days may no longer be safe.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "6px 13px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
