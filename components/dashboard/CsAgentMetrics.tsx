"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";

// ─── How the agent is doing ─────────────────────────────────────────────────
//
// Measured by what the reviewer does with its output, not by anything the agent
// says about itself.
//
// ⚠ NO RAG. Every number here is a count of decisions a person made. Colouring
// a skip rate red would assert that skipping is bad, when a high skip rate on a
// quiet book is exactly right.

interface Metrics {
  days: number;
  runs: {
    total: number; completed: number; proposed: number; skipped: number;
    blocked: number; failed: number; budgetHit: number; humanFlags: number;
  };
  review: {
    agentDrafts: number; sent: number; editedBeforeSending: number;
    approvedUnedited: number; rejected: number; withLintHits: number;
    decisionFailures: number; writingFailures: number;
    rejections: Record<string, number>;
  };
  skipCounts: Record<string, number>;
  cost: { inputTokens: number; outputTokens: number; perRun: number };
  byPrompt: Record<string, { runs: number; proposed: number; skipped: number }>;
  replyNote: string;
}

const SKIP_LABEL: Record<string, string> = {
  recently_contacted: "Contacted recently",
  we_owe_them: "We owe them",
  nothing_specific_to_say: "Nothing specific to say",
  no_suitable_contact: "No suitable contact",
  not_the_right_time: "Not the right time",
  other: "Other",
};

export default function CsAgentMetrics() {
  const [m, setM] = useState<Metrics | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/cs/agent-metrics?days=${days}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.hint ? `${json.error} ${json.hint}` : json?.error);
      setM(json);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <strong style={{ fontSize: 14, color: C.text }}>Agent performance</strong>
        <div style={{ display: "flex", gap: 2, background: C.alt, border: `1px solid ${C.border}`,
                      borderRadius: 7, padding: 2 }}>
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              background: days === d ? C.surface : "transparent",
              color: days === d ? C.text : C.textSub,
              border: days === d ? `1px solid ${C.border}` : "1px solid transparent",
              borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: C.font,
            }}>{d}d</button>
          ))}
        </div>
        <button onClick={load} disabled={loading} style={{
          marginLeft: "auto", background: C.blueBg, border: `1px solid ${C.blueBd}`,
          color: C.blue, borderRadius: 6, padding: "5px 12px", fontSize: 12,
          fontWeight: 600, cursor: "pointer", fontFamily: C.font,
        }}>{loading ? "…" : "↻"}</button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12 }}>{error}</div>
      )}

      {m && m.runs.total === 0 && (
        <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.7 }}>
          The agent has not run in the last {m.days} days.
        </div>
      )}

      {m && m.runs.total > 0 && (
        <>
          <div style={{ display: "grid", gap: 10, marginBottom: 16,
                        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
            <Tile v={m.runs.total}    l="runs" />
            <Tile v={m.runs.proposed} l="proposed" />
            <Tile v={m.runs.skipped}  l="skipped" />
            <Tile v={m.review.sent}   l="sent" />
            <Tile v={m.review.approvedUnedited} l="sent unedited" />
            <Tile v={`${(m.cost.perRun / 1000).toFixed(1)}k`} l="tokens / run" />
          </div>

          {m.runs.budgetHit > 0 && (
            <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, color: C.yellow,
                          borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 13,
                          lineHeight: 1.55 }}>
              <strong>{m.runs.budgetHit} run{m.runs.budgetHit === 1 ? "" : "s"} hit a budget</strong> and
              were forced to decide before finishing. Those are defaults, not considered calls — if
              this keeps rising the bounds are too tight for these accounts.
            </div>
          )}

          <Section title="Why it skipped">
            {Object.keys(m.skipCounts).length === 0
              ? <Muted>No skips recorded.</Muted>
              : Object.entries(m.skipCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <Row key={k} label={SKIP_LABEL[k] ?? k} value={v}
                       note={k === "nothing_specific_to_say"
                         ? "profile too thin to write from — the fix is upstream"
                         : k === "no_suitable_contact"
                           ? "no contact with an allowed role — set roles on the account"
                           : undefined} />
                ))}
          </Section>

          <Section title="Why drafts were rejected">
            <Row label="Decision failures (wrong person / wrong timing)"
                 value={m.review.decisionFailures}
                 note="the agent chose badly — a decision-prompt problem" />
            <Row label="Writing failures (tone / factually wrong)"
                 value={m.review.writingFailures}
                 note="the writing rules need work — a different fix" />
            <Row label="Edited before sending" value={m.review.editedBeforeSending}
                 note="the diff is the highest-value training data here" />
            <Row label="Drafts carrying lint hits" value={m.review.withLintHits} />
          </Section>

          {Object.keys(m.byPrompt).length > 1 && (
            <Section title="By prompt version">
              {Object.entries(m.byPrompt).map(([v, s]) => (
                <Row key={v} label={v} value={`${s.runs} runs · ${s.proposed} proposed · ${s.skipped} skipped`} />
              ))}
            </Section>
          )}

          <p style={{ fontSize: 11, color: C.textSub, marginTop: 14, lineHeight: 1.6 }}>
            {m.replyNote} A reply is the point of the whole system, so this stays a gap rather
            than being quietly left off the list.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ v, l }: { v: number | string; l: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: "10px 13px", boxShadow: C.sh }}>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: C.mono, color: C.text, lineHeight: 1.15 }}>{v}</div>
      <div style={{ fontSize: 10, color: C.textSub, textTransform: "uppercase", letterSpacing: 0.4 }}>{l}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 7 }}>{title}</div>
      <div style={{ display: "grid", gap: 5 }}>{children}</div>
    </div>
  );
}
function Row({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", border: `1px solid ${C.border}`,
                  background: C.surface, borderRadius: 7, padding: "8px 12px" }}>
      <span style={{ fontSize: 12.5, color: C.text }}>{label}</span>
      {note && <span style={{ fontSize: 11, color: C.textSub }}>{note}</span>}
      <span style={{ marginLeft: "auto", fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text }}>
        {value}
      </span>
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: C.textSub }}>{children}</span>;
}
