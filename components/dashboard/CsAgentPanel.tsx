"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";

// ─── CSM agent ──────────────────────────────────────────────────────────────
//
// Decides whether to contact this account, who, and about what — then proposes
// the email into the Draft Queue. It never sends.
//
// ⚠ A SKIP IS SHOWN AS AN OUTCOME, NOT A FAILURE. "Nothing specific to say" on
// an account that keeps getting flagged is one of the more useful things this
// system produces: it means the profile is too thin to act on. Rendering skips
// as a quiet nothing would hide exactly that.
//
// ⚠ NO RAG. An outcome is a decision, not a health judgment. The one exception
// is a human flag marked `today`, which is a stated urgency rather than an
// inference — same licence as an overdue task.

interface Run {
  id: string; status: string; outcome: string | null; stop_reason: string | null;
  skip_category: string | null; skip_reason: string | null;
  draft_id: string | null;
  human_flag: { note: string; urgency: string } | null;
  transcript: { tool: string; output: string }[] | null;
  tool_calls: number; duration_ms: number | null;
  prompt_version: string | null; error: string | null;
  run_by: string | null; queued_at: string;
}

const SKIP_LABEL: Record<string, string> = {
  recently_contacted:      "Contacted recently",
  we_owe_them:             "We owe them something",
  nothing_specific_to_say: "Nothing specific to say",
  no_suitable_contact:     "No suitable contact",
  not_the_right_time:      "Not the right time",
  other:                   "Other",
};

export default function CsAgentPanel({
  customerNsId, customerName,
}: { customerNsId: string; customerName: string }) {
  const [runs, setRuns]     = useState<Run[]>([]);
  const [loading, setLoad]  = useState(true);
  const [running, setRun]   = useState(false);
  const [elapsed, setEl]    = useState(0);
  const [error, setError]   = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const res  = await fetch(`/api/cs/agent/${encodeURIComponent(customerNsId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.hint ? `${json.error} ${json.hint}` : json?.error);
      setRuns(json.runs ?? []);
      setOpenId(json.runs?.[0]?.id ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoad(false); }
  }, [customerNsId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!running) return;
    setEl(0);
    const t = setInterval(() => setEl(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function run() {
    setRun(true); setError(null); setNeedsProfile(null);
    try {
      const res  = await fetch(`/api/cs/agent/${encodeURIComponent(customerNsId)}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        if (json?.needsProfile) { setNeedsProfile(json.error); return; }
        throw new Error(json?.hint ? `${json.error} ${json.hint}` : json?.error);
      }
      await load();
      setOpenId(json.runId);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setRun(false); }
  }

  const current = runs.find(r => r.id === openId) ?? null;

  return (
    <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 10 }}>
        <strong style={{ fontSize: 14, color: C.text }}>🤖 CSM agent</strong>
        <span style={{ fontSize: 11.5, color: C.textSub }}>
          Decides whether to write, to whom, and about what. Proposes into the Draft Queue — never sends.
        </span>
        <button onClick={run} disabled={running} style={{
          marginLeft: "auto", background: running ? C.alt : C.blueBg,
          border: `1px solid ${running ? C.border : C.blueBd}`,
          color: running ? C.textMid : C.blue, borderRadius: 6, padding: "5px 13px",
          fontSize: 12, fontWeight: 600, cursor: running ? "default" : "pointer", fontFamily: C.font,
        }}>
          {running ? `Deciding… ${elapsed}s` : runs.length ? "↻ Run again" : "Run CSM agent"}
        </button>
      </div>

      {running && (
        <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, color: C.blue,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 11, lineHeight: 1.55 }}>
          Reading {customerName}&apos;s flags, contacts, contract, commitments and history. It is
          capped and will stop and record a decision rather than running on.
        </div>
      )}

      {needsProfile && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, color: C.textMid,
                      borderRadius: 8, padding: "10px 13px", fontSize: 12, marginBottom: 11, lineHeight: 1.6 }}>
          {needsProfile}
        </div>
      )}
      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 11 }}>{error}</div>
      )}

      {loading && <div style={{ fontSize: 12, color: C.textSub }}>Loading runs…</div>}
      {!loading && runs.length === 0 && !needsProfile && (
        <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.65 }}>
          The agent has not looked at this account yet.
        </div>
      )}

      {runs.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
          {runs.map(r => (
            <button key={r.id} onClick={() => setOpenId(r.id)} style={{
              background: openId === r.id ? C.blueBg : "transparent",
              border: `1px solid ${openId === r.id ? C.blueBd : C.border}`,
              color: openId === r.id ? C.blue : C.textSub, borderRadius: 5,
              padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
            }}>
              {new Date(r.queued_at).toLocaleDateString()} · {r.outcome ?? r.status}
            </button>
          ))}
        </div>
      )}

      {current && (
        <>
          {/* A human flag outranks the outcome — it is the thing that needs a
              person rather than an email, so it goes first. */}
          {current.human_flag && (
            <div style={{
              background: current.human_flag.urgency === "today" ? C.redBg : C.yellowBg,
              border: `1px solid ${current.human_flag.urgency === "today" ? C.redBd : C.yellowBd}`,
              color: current.human_flag.urgency === "today" ? C.red : C.yellow,
              borderRadius: 8, padding: "10px 13px", fontSize: 12.5, marginBottom: 11, lineHeight: 1.6,
            }}>
              <strong>Needs a person{current.human_flag.urgency === "today" ? " today" : " this week"}.</strong>{" "}
              {current.human_flag.note}
            </div>
          )}

          {(current.stop_reason === "tool_budget" || current.stop_reason === "time_budget") && (
            <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, color: C.yellow,
                          borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 11, lineHeight: 1.55 }}>
              <strong>Out of budget.</strong> It was made to decide before it had finished looking,
              so this is a default rather than a considered call.
            </div>
          )}

          {current.outcome === "skipped" && (
            <div style={{ border: `1px solid ${C.border}`, background: C.alt, borderRadius: 8,
                          padding: "11px 13px", fontSize: 12.5, lineHeight: 1.6 }}>
              <strong style={{ color: C.text }}>
                Skipped — {SKIP_LABEL[current.skip_category ?? ""] ?? current.skip_category}
              </strong>
              <div style={{ color: C.textMid, marginTop: 4 }}>{current.skip_reason}</div>
              {current.skip_category === "nothing_specific_to_say" && (
                <div style={{ color: C.textSub, marginTop: 6, fontSize: 11.5 }}>
                  That usually means the profile is too thin to write from, not that the
                  account is fine. Extracting or verifying the profile is the fix.
                </div>
              )}
            </div>
          )}

          {current.outcome === "proposed" && (
            <div style={{ border: `1px solid ${C.greenBd}`, background: C.greenBg, borderRadius: 8,
                          padding: "11px 13px", fontSize: 12.5, color: C.green, lineHeight: 1.6 }}>
              <strong>Drafted.</strong> It is in the Draft Queue awaiting your approval — nothing
              has been sent.
            </div>
          )}

          {current.outcome === "blocked" && (
            <div style={{ border: `1px solid ${C.yellowBd}`, background: C.yellowBg, borderRadius: 8,
                          padding: "11px 13px", fontSize: 12.5, color: C.yellow, lineHeight: 1.6 }}>
              <strong>Written, then blocked by suppression.</strong> The draft is recorded as
              rejected with the reason, rather than discarded — a generator that keeps producing
              blocked drafts is telling you something.
            </div>
          )}

          {current.status === "failed" && (
            <div style={{ border: `1px solid ${C.redBd}`, background: C.redBg, borderRadius: 8,
                          padding: "11px 13px", fontSize: 12.5, color: C.red }}>
              Failed{current.error ? `: ${current.error}` : "."}
            </div>
          )}

          {/* The transcript. Without it you are guessing why it decided
              something, and a decision agent you cannot interrogate is one you
              cannot trust. */}
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 11.5, color: C.textSub, cursor: "pointer" }}>
              {current.tool_calls} tool call{current.tool_calls === 1 ? "" : "s"}
              {current.duration_ms ? ` · ${Math.round(current.duration_ms / 1000)}s` : ""}
              {current.prompt_version ? ` · prompt ${current.prompt_version}` : ""}
            </summary>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {(current.transcript ?? []).map((t, i) => (
                <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 6,
                                      background: C.surface, padding: "7px 10px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid, fontFamily: C.mono }}>
                    {t.tool}
                  </div>
                  <pre style={{ margin: "4px 0 0", fontSize: 10.5, color: C.textSub,
                                whiteSpace: "pre-wrap", wordBreak: "break-word",
                                maxHeight: 150, overflow: "auto" }}>
                    {t.output}
                  </pre>
                </div>
              ))}
              {(current.transcript ?? []).length === 0 && (
                <span style={{ fontSize: 11.5, color: C.textSub }}>No tool calls recorded.</span>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
