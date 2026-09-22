"use client";
import { useState } from "react";
import { C } from "@/lib/constants";

// ─── QBR pack ───────────────────────────────────────────────────────────────
//
// Two artefacts, shown apart and labelled, because one of them must never reach
// the customer. The internal briefing carries consultant sentiment, the health
// score and the contract position; the customer-facing pack carries none of it
// and has nowhere in its shape to put it (see lib/cs-qbr.ts).
//
// The briefing is shown FIRST and given the most room. The spec: "The internal
// briefing is arguably more valuable than the pack. It is what a good CSM would
// have in their head walking into the room."

interface Pack {
  tier: string;
  customerFacing: {
    customerName: string; periodLabel: string;
    summary: { projectsDelivered: Array<{ name: string; entityid: string }>; hoursConsumed: number; casesRaised: number; casesResolved: number };
    supportNarrative: string; goalsUnavailable: boolean;
    forwardLook: Array<{ title: string; reasoning: string; source: string }>;
    nextSteps: string[];
  };
  internal: {
    healthScore: number | null; healthBand: string | null; scoreDelta: number | null;
    openFlags: Array<{ title: string; reason: string; severity: string }>;
    sentiment: Array<{ rating: string; note: string | null; consultant: string; capturedAt: string }>;
    contractPosition: { product: string; endDate: string | null; daysToRenewal: number | null; daysToNotice: number | null; annualValue: number | null; autoRenew: boolean } | null;
    openCommitments: Array<{ direction: string; description: string; dueDate: string | null; overdue: boolean }>;
    declinedItems: string[];
    talkingPoints: string[];
    avoid: string[];
  };
}

const RATING_COLOR: Record<string, string> = { green: C.green, amber: C.yellow, red: C.red };

export default function CsQbr({ customerNsId }: { customerNsId: string }) {
  const [pack, setPack]   = useState<Pack | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function build() {
    setBusy(true); setError(null);
    try {
      const res  = await fetch(`/api/cs/qbr?customerNsId=${encodeURIComponent(customerNsId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setPack(json.pack); setWarnings(json.warnings ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>QBR pack</h4>
        {pack && <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>cadence: {pack.tier.replace(/_/g, " ")}</span>}
        <button onClick={build} disabled={busy} style={{
          marginLeft: "auto", background: C.blueBg, border: `1px solid ${C.blueBd}`, color: C.blue,
          borderRadius: 6, padding: "4px 11px", fontSize: 12, fontWeight: 600,
          cursor: busy ? "default" : "pointer", fontFamily: C.font,
        }}>
          {busy ? "Assembling…" : pack ? "Rebuild" : "Assemble pack"}
        </button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {warnings.length > 0 && (
        <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, color: C.yellow,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {pack && (
        <>
          {/* ── Internal briefing ─────────────────────────────────────────── */}
          <div style={{ border: `2px solid ${C.orangeBd}`, background: C.orangeBg,
                        borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.orange,
                          textTransform: "uppercase", marginBottom: 8 }}>
              Internal briefing — never shown to the customer
            </div>

            <Row label="Health">
              {pack.internal.healthScore !== null
                ? <>{pack.internal.healthScore} · {pack.internal.healthBand}
                    {pack.internal.scoreDelta ? ` (${pack.internal.scoreDelta > 0 ? "+" : ""}${pack.internal.scoreDelta})` : ""}</>
                : "not scored yet"}
            </Row>

            {pack.internal.contractPosition && (
              <Row label="Contract">
                {pack.internal.contractPosition.product} · ends {pack.internal.contractPosition.endDate ?? "—"}
                {pack.internal.contractPosition.daysToNotice !== null &&
                  ` · notice in ${pack.internal.contractPosition.daysToNotice}d`}
                {pack.internal.contractPosition.autoRenew && " · auto-renews"}
              </Row>
            )}

            <Row label="Consultant view">
              {pack.internal.sentiment.length === 0 ? "nothing recorded yet" : (
                <span>
                  {pack.internal.sentiment.slice(0, 4).map((s, i) => (
                    <span key={i} style={{ marginRight: 10 }}>
                      <strong style={{ color: RATING_COLOR[s.rating] ?? C.textMid }}>{s.rating}</strong>
                      {s.note ? ` — “${s.note}”` : ""} <span style={{ color: C.textSub }}>({s.consultant})</span>
                    </span>
                  ))}
                </span>
              )}
            </Row>

            {pack.internal.openFlags.length > 0 && (
              <Row label="Open flags">
                {pack.internal.openFlags.map(f => f.title).join(" · ")}
              </Row>
            )}

            {pack.internal.openCommitments.length > 0 && (
              <Row label="Commitments">
                {pack.internal.openCommitments.map((c, i) => (
                  <div key={i} style={{ color: c.overdue ? C.red : C.textMid }}>
                    {c.direction === "we_owe" ? "We owe" : "They owe"}: {c.description}
                    {c.overdue ? " (OVERDUE)" : ""}
                  </div>
                ))}
              </Row>
            )}

            {pack.internal.avoid.length > 0 && (
              <Row label="Avoid">{pack.internal.avoid.join(" · ")}</Row>
            )}
          </div>

          {/* ── Customer-facing pack ──────────────────────────────────────── */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", background: C.surface }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.textSub,
                          textTransform: "uppercase", marginBottom: 8 }}>
              Customer-facing pack · {pack.customerFacing.periodLabel}
            </div>

            <Row label="Delivered">
              {pack.customerFacing.summary.hoursConsumed}h across{" "}
              {pack.customerFacing.summary.projectsDelivered.length} project(s)
            </Row>
            <Row label="Support">{pack.customerFacing.supportNarrative}</Row>

            {pack.customerFacing.goalsUnavailable && (
              <div style={{ fontSize: 11, color: C.textSub, marginTop: 6, marginBottom: 8, lineHeight: 1.5 }}>
                Outcomes-against-goals is empty because kickoff success criteria were never
                captured in a structured form. That is reported as a gap rather than filled
                with generated prose — the fix is upstream, at kickoff.
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase",
                          letterSpacing: 0.4, marginTop: 10, marginBottom: 5 }}>
              Forward look
            </div>
            {pack.customerFacing.forwardLook.length === 0
              ? <div style={{ fontSize: 12, color: C.textSub }}>Nothing yet — needs release matches or a profile with manual processes.</div>
              : pack.customerFacing.forwardLook.map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: C.textMid, marginBottom: 5, lineHeight: 1.5 }}>
                    <span style={{ fontSize: 10, fontFamily: C.mono, color: C.textSub, marginRight: 6 }}>
                      {f.source.replace(/_/g, " ")}
                    </span>
                    {f.reasoning}
                  </div>
                ))}

            <div style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase",
                          letterSpacing: 0.4, marginTop: 10, marginBottom: 5 }}>
              Proposed next steps
            </div>
            {pack.customerFacing.nextSteps.map((s, i) => (
              <div key={i} style={{ fontSize: 12, color: C.textMid, marginBottom: 3 }}>• {s}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 5, alignItems: "baseline" }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                     color: C.textSub, minWidth: 110 }}>{label}</span>
      <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5, flex: 1 }}>{children}</span>
    </div>
  );
}
