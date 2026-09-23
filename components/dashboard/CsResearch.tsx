"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";

// ─── Account research ───────────────────────────────────────────────────────
//
// Runs the bounded read-only agent over the account's Drive documents, ClickUp
// tasks, NetSuite projects and support cases.
//
// ⚠ NOTHING HERE IS RAG-COLOURED. Confidence on a finding is not health, and a
// red "low confidence" chip reads as "this customer is in trouble" — the same
// rule the profile panel follows. Blue marks the chargeable/free split on next
// steps, because that is a category, not a judgment.
//
// ⚠ A PARTIAL RUN SAYS SO. Hitting the tool or time budget means the agent
// stopped early, and a truncated look at the evidence must never be presented
// as a considered conclusion.

interface Evidence { kind: string; ref: string; label: string }
interface Finding {
  title: string; detail: string; confidence: string; evidence: Evidence[];
}
interface NextStep { action: string; rationale: string; chargeable: boolean }
interface Run {
  id: string; status: string; stop_reason: string | null;
  summary: string | null; findings: Finding[]; next_steps: NextStep[];
  sources_read: Evidence[]; tool_calls: number; duration_ms: number | null;
  error: string | null; run_by: string | null; created_at: string;
}

const KIND_ICON: Record<string, string> = {
  document: "📄", project: "🗂", clickup: "☑", case: "🎫",
};

export default function CsResearch({
  customerNsId, customerName,
}: { customerNsId: string; customerName: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nothingToRead, setNothingToRead] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cs/research/${encodeURIComponent(customerNsId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.hint ? `${json.error} ${json.hint}` : json?.error);
      setRuns(json.runs ?? []);
      setOpenRun(json.runs?.[0]?.id ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, [customerNsId]);

  useEffect(() => { load(); }, [load]);

  // A run reads Drive and ClickUp and can take a couple of minutes. A bare
  // spinner for that long reads as "nothing is happening" — the same complaint
  // the extract-then-draft flow drew — so the elapsed time is always on screen.
  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function run() {
    setRunning(true); setError(null); setNothingToRead(null);
    try {
      const res = await fetch(`/api/cs/research/${encodeURIComponent(customerNsId)}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        if (json?.nothingToRead) { setNothingToRead(json.error); return; }
        throw new Error(json?.error ?? `Failed (${res.status})`);
      }
      await load();
      setOpenRun(json.runId);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setRunning(false); }
  }

  const current = runs.find(r => r.id === openRun) ?? null;

  return (
    <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 10 }}>
        <strong style={{ fontSize: 14, color: C.text }}>⚡ Account research</strong>
        <span style={{ fontSize: 11.5, color: C.textSub }}>
          Reads Drive, ClickUp, projects and cases. Read-only — it proposes, it never sends.
        </span>
        <button onClick={run} disabled={running} style={{
          marginLeft: "auto", background: running ? C.alt : C.blueBg,
          border: `1px solid ${running ? C.border : C.blueBd}`,
          color: running ? C.textMid : C.blue, borderRadius: 6, padding: "5px 13px",
          fontSize: 12, fontWeight: 600, cursor: running ? "default" : "pointer", fontFamily: C.font,
        }}>
          {running ? `Researching… ${elapsed}s` : runs.length ? "↻ Run again" : "Run research"}
        </button>
      </div>

      {running && (
        <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, color: C.blue,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 11,
                      lineHeight: 1.55 }}>
          Reading {customerName}&apos;s documents and tasks. This takes up to a few minutes and
          is capped — it will stop and report what it found rather than running on.
        </div>
      )}

      {nothingToRead && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, color: C.textMid,
                      borderRadius: 8, padding: "10px 13px", fontSize: 12, marginBottom: 11,
                      lineHeight: 1.6 }}>
          {nothingToRead}
        </div>
      )}

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 11 }}>
          {error}
        </div>
      )}

      {loading && <div style={{ fontSize: 12, color: C.textSub }}>Loading previous runs…</div>}

      {!loading && runs.length === 0 && !nothingToRead && (
        <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.65 }}>
          No research has been run on this account yet.
        </div>
      )}

      {runs.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
          {runs.map(r => (
            <button key={r.id} onClick={() => setOpenRun(r.id)} style={{
              background: openRun === r.id ? C.blueBg : "transparent",
              border: `1px solid ${openRun === r.id ? C.blueBd : C.border}`,
              color: openRun === r.id ? C.blue : C.textSub, borderRadius: 5,
              padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              fontFamily: C.font,
            }}>
              {new Date(r.created_at).toLocaleDateString()}
            </button>
          ))}
        </div>
      )}

      {current && current.status !== "complete" && (
        <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, color: C.yellow,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 11 }}>
          This run {current.status === "failed" ? "failed" : "stopped early"}
          {current.error ? `: ${current.error}` : "."}
        </div>
      )}

      {current?.status === "complete" && (
        <>
          {(current.stop_reason === "tool_budget" || current.stop_reason === "time_budget") && (
            <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, color: C.yellow,
                          borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 11,
                          lineHeight: 1.55 }}>
              <strong>Partial.</strong> The agent hit its{" "}
              {current.stop_reason === "tool_budget" ? "limit of reads" : "time limit"} and
              submitted what it had. Treat this as a first pass, not a full picture.
            </div>
          )}

          {current.summary && (
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.65, margin: "0 0 13px" }}>
              {current.summary}
            </p>
          )}

          {current.findings.length === 0 && (
            <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.65, marginBottom: 12 }}>
              Nothing it could evidence. A finding with nothing behind it is dropped rather than
              reported, so this means the material was thin — not that the account is fine.
            </div>
          )}

          {current.findings.map((f, i) => (
            <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8,
                                  padding: "11px 13px", marginBottom: 8, background: C.surface }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13, color: C.text }}>{f.title}</strong>
                {/* Not RAG: confidence is about the evidence, not the account. */}
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                               color: C.textMid, background: C.alt,
                               border: `1px solid ${C.border}`, borderRadius: 3, padding: "1px 5px" }}>
                  {f.confidence.toUpperCase()} CONFIDENCE
                </span>
              </div>
              <p style={{ fontSize: 12.5, color: C.textMid, lineHeight: 1.6, margin: "5px 0 7px" }}>
                {f.detail}
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {f.evidence.map((e, j) => (
                  <span key={j} style={{ fontSize: 10.5, color: C.textSub, background: C.alt,
                                         border: `1px solid ${C.border}`, borderRadius: 4,
                                         padding: "2px 7px" }}>
                    {KIND_ICON[e.kind] ?? "·"} {e.label}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {current.next_steps.length > 0 && (
            <div style={{ marginTop: 13 }}>
              <strong style={{ fontSize: 12.5, color: C.text }}>Recommended next steps</strong>
              <div style={{ display: "grid", gap: 6, marginTop: 7 }}>
                {current.next_steps.map((n, i) => (
                  <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 7,
                                        padding: "9px 12px", background: C.alt }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>{n.action}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                                     color: n.chargeable ? C.blue : C.textSub,
                                     background: n.chargeable ? C.blueBg : "transparent",
                                     border: `1px solid ${n.chargeable ? C.blueBd : C.border}`,
                                     borderRadius: 3, padding: "1px 5px" }}>
                        {n.chargeable ? "CHARGEABLE" : "NO COST"}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.textMid, marginTop: 3, lineHeight: 1.55 }}>
                      {n.rationale}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What it read. This is what makes a thin answer auditable: "it found
              little" and "there was little to find" are different claims, and
              only the read log tells them apart. */}
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 11.5, color: C.textSub, cursor: "pointer" }}>
              Read {current.sources_read?.length ?? 0} source
              {(current.sources_read?.length ?? 0) === 1 ? "" : "s"} in {current.tool_calls} calls
              {current.duration_ms ? ` · ${Math.round(current.duration_ms / 1000)}s` : ""}
            </summary>
            <ul style={{ margin: "7px 0 0", paddingLeft: 17 }}>
              {(current.sources_read ?? []).map((s, i) => (
                <li key={i} style={{ fontSize: 11, color: C.textMid, lineHeight: 1.65 }}>
                  {KIND_ICON[s.kind] ?? "·"} {s.label}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
