"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";

// ─── Triage — who needs attention today, and why ────────────────────────────
//
// The primary CS interface. Ranked by severity, then how soon a contract
// decision is due, then the size of the score drop.
//
// Only accounts with an open flag appear. The spec is firm about keeping the
// default list short: "ten accounts you should look at today is useful; a list
// of two hundred sorted by score is not." Padding it with healthy rows would
// make it the thing nobody opens.
//
// THIS view is RAG-coloured, where the accounts table is not — and that is the
// distinction throughout this module. A health band is a judgment the system has
// made and must stand behind, with evidence attached. "Quiet for 200 days" is a
// fact, and facts do not get colour.

type Severity = "low" | "medium" | "high" | "critical";
type Band     = "healthy" | "watch" | "at_risk" | "critical";

interface Flag {
  id: string; ruleId: string; severity: Severity; title: string;
  reason: string; evidence: Record<string, unknown>; status: string; raisedAt: string;
}
interface Row {
  customerNsId: string; customerName: string;
  score: number | null; band: Band | null; delta: number | null;
  topSeverity: Severity; headline: string; headlineTitle: string;
  daysToNotice: number | null; annualValue: number | null;
  daysSinceLastHour: number | null;
  flags: Flag[];
}

const BAND_STYLE: Record<Band, { bg: string; fg: string; bd: string; label: string }> = {
  healthy:  { bg: C.greenBg,  fg: C.green,  bd: C.greenBd,  label: "Healthy"  },
  watch:    { bg: C.yellowBg, fg: C.yellow, bd: C.yellowBd, label: "Watch"    },
  at_risk:  { bg: C.orangeBg, fg: C.orange, bd: C.orangeBd, label: "At risk"  },
  critical: { bg: C.redBg,    fg: C.red,    bd: C.redBd,    label: "Critical" },
};

const SEV_STYLE: Record<Severity, { fg: string; bg: string; bd: string }> = {
  low:      { fg: C.textMid, bg: C.alt,       bd: C.border   },
  medium:   { fg: C.yellow,  bg: C.yellowBg,  bd: C.yellowBd },
  high:     { fg: C.orange,  bg: C.orangeBg,  bd: C.orangeBd },
  critical: { fg: C.red,     bg: C.redBg,     bd: C.redBd    },
};

export default function CsTriage() {
  const [rows, setRows]   = useState<Row[]>([]);
  const [meta, setMeta]   = useState<{ lastRun: string | null; contractsRecorded: number; rulesVersion: string | null }>({ lastRun: null, contractsRecorded: 0, rulesVersion: null });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen]   = useState<string | null>(null);
  const [note, setNote]   = useState("");
  const [drafting, setDrafting] = useState<string | null>(null);
  const [drafted,  setDrafted]  = useState<string | null>(null);
  // A draft needs a profile, and most customers do not have one yet. Rather
  // than bouncing the reader to the Accounts tab and back, offer to extract it
  // here and continue.
  const [needsProfile, setNeedsProfile] = useState<{ cid: string; name: string; flagId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/cs/triage");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setRows(json.rows ?? []);
      setMeta({ lastRun: json.lastRun, contractsRecorded: json.contractsRecorded ?? 0, rulesVersion: json.rulesVersion });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runNow() {
    setRunning(true); setError(null);
    try {
      const res  = await fetch("/api/cs/triage", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      if (json.warnings?.length) setError(json.warnings.join(" · "));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setRunning(false); }
  }

  /**
   * Turn a flag into a draft. It lands in the queue and goes nowhere until a
   * person approves it — there is no path from here to an outbound email.
   */
  async function draft(customerNsId: string, flagId: string, name = "") {
    setDrafting(flagId); setError(null); setDrafted(null); setNeedsProfile(null);
    try {
      const res = await fetch("/api/cs/motions/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerNsId, flagId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);

      const bits: string[] = [];
      if (json.suppression?.blocked) bits.push(`blocked by suppression: ${json.suppression.reasons.join(" · ")}`);
      else bits.push("waiting in Drafts");
      if (json.lint?.length) bits.push(`flagged phrasing: ${json.lint.join(", ")}`);
      if (json.facts?.withheld?.total) bits.push(`${json.facts.withheld.total} unverified fact(s) withheld from the prompt`);
      if (!json.facts?.profileVerified) bits.push("profile is not human-verified, so only high-confidence facts were usable");
      setDrafted(bits.join(" · "));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      // The commonest first-run outcome, and recoverable in place.
      if (/no profile/i.test(msg)) setNeedsProfile({ cid: customerNsId, name, flagId });
      else setError(msg);
    } finally { setDrafting(null); }
  }

  /** Extract the profile, then carry on to the draft that wanted it. */
  async function extractThenDraft(cid: string, name: string, flagId: string) {
    setDrafting(flagId); setError(null); setNeedsProfile(null);
    try {
      const res = await fetch("/api/cs/profiles/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerNsId: cid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Extraction failed (${res.status})`);
      setDrafting(null);
      await draft(cid, flagId, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setDrafting(null);
    }
  }

  async function act(flagId: string, status: string, dismissedReason?: string) {
    setError(null);
    try {
      const res = await fetch("/api/cs/triage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagId, status, dismissedReason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: C.textSub }}>
          {meta.lastRun
            ? `Last scored ${new Date(meta.lastRun).toLocaleString()}${meta.rulesVersion ? ` · rules ${meta.rulesVersion}` : ""}`
            : "Never scored — run it to populate this list."}
        </span>
        <button onClick={runNow} disabled={running} style={{
          marginLeft: "auto", background: C.blueBg, border: `1px solid ${C.blueBd}`, color: C.blue,
          borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
          cursor: running ? "default" : "pointer", opacity: running ? 0.6 : 1, fontFamily: C.font,
        }}>
          {running ? "Scoring every account…" : "↻ Run scoring now"}
        </button>
      </div>

      {meta.contractsRecorded === 0 && (
        <div style={{ background: C.yellowBg, border: `1px solid ${C.yellowBd}`, color: C.yellow,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
          No contracts came back from NetSuite, so the silence rules cannot fire at all —
          nothing can tell a finished implementation from an account going quiet. Contracts
          are read from the Contract Renewals record, so this usually means NetSuite was
          unreachable rather than that none exist. Check the Renewals tab.
        </div>
      )}

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {needsProfile && (
        <div style={{ background: C.alt, border: `1px solid ${C.mid}`, borderRadius: 8,
                      padding: "11px 14px", fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          <strong>{needsProfile.name || "This customer"} has no profile yet.</strong> A health
          check with nothing specific in it is worse than none, so extraction has to run
          first — it reads their projects, support cases and consultant time memos, and takes
          up to a couple of minutes on a large account.
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => extractThenDraft(needsProfile.cid, needsProfile.name, needsProfile.flagId)}
              style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, color: C.blue,
                       borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
                       cursor: "pointer", fontFamily: C.font }}
            >
              Extract profile, then draft
            </button>
            <button onClick={() => setNeedsProfile(null)} style={smallBtn(C.textSub)}>Not now</button>
            <span style={{ fontSize: 11, color: C.textSub }}>
              You can also read and verify the profile first, under Accounts.
            </span>
          </div>
        </div>
      )}

      {drafted && (
        <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, color: C.blue,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
          Draft written — {drafted}. Nothing sends until you approve it in Drafts.
        </div>
      )}

      {loading && <div style={{ padding: "30px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>Loading…</div>}

      {!loading && rows.length === 0 && (
        <div style={{ padding: "30px 0", textAlign: "center", color: C.textSub, fontSize: 13, lineHeight: 1.7 }}>
          Nothing needs attention.<br />
          {meta.lastRun ? "Every account was evaluated and no rule fired." : "Run scoring to evaluate every account."}
        </div>
      )}

      {rows.map(r => {
        const b = r.band ? BAND_STYLE[r.band] : null;
        const sev = SEV_STYLE[r.topSeverity];
        const isOpen = open === r.customerNsId;
        return (
          <div key={r.customerNsId} style={{
            border: `1px solid ${C.border}`, borderLeft: `3px solid ${sev.bd}`,
            borderRadius: 8, marginBottom: 8, background: C.surface,
          }}>
            <div
              onClick={() => setOpen(isOpen ? null : r.customerNsId)}
              style={{ padding: "11px 14px", cursor: "pointer" }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{r.customerName}</span>
                {b && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: b.fg, background: b.bg,
                                 border: `1px solid ${b.bd}`, borderRadius: 5, padding: "1px 7px" }}>
                    {b.label}
                  </span>
                )}
                {r.score !== null && (
                  <span style={{ fontSize: 13, fontFamily: C.mono, color: C.textMid }}>
                    {r.score}
                    {r.delta !== null && r.delta !== 0 && (
                      <span style={{ marginLeft: 4, color: r.delta < 0 ? C.red : C.green }}>
                        {r.delta < 0 ? "▼" : "▲"}{Math.abs(r.delta)}
                      </span>
                    )}
                  </span>
                )}
                {r.daysToNotice !== null && r.daysToNotice <= 180 && (
                  <span style={{ fontSize: 11, fontFamily: C.mono,
                                 color: r.daysToNotice <= 30 ? C.red : C.textMid }}>
                    notice in {r.daysToNotice}d
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
                  {r.flags.length} flag{r.flags.length === 1 ? "" : "s"} · {isOpen ? "hide" : "open"}
                </span>
              </div>
              <div style={{ marginTop: 5, fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>
                <strong style={{ color: sev.fg }}>{r.headlineTitle}</strong> — {r.headline}
              </div>
            </div>

            {isOpen && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 14px", background: C.alt }}>
                {r.flags.map(f => (
                  <div key={f.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
                                     color: SEV_STYLE[f.severity].fg, background: SEV_STYLE[f.severity].bg,
                                     border: `1px solid ${SEV_STYLE[f.severity].bd}`, borderRadius: 4, padding: "1px 6px" }}>
                        {f.severity}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{f.title}</span>
                      <span style={{ fontSize: 10, color: C.textSub, fontFamily: C.mono }}>{f.ruleId}</span>
                      {f.status !== "open" && (
                        <span style={{ fontSize: 10, color: C.textSub, fontFamily: C.mono }}>· {f.status}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: C.textMid, marginTop: 3 }}>{f.reason}</div>

                    <div style={{ marginTop: 5, fontSize: 11, fontFamily: C.mono, color: C.textSub }}>
                      {Object.entries(f.evidence ?? {}).map(([k, v]) => (
                        <span key={k} style={{ marginRight: 12 }}>
                          {k}=<span style={{ color: C.textMid }}>{v === null ? "—" : String(v)}</span>
                        </span>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 6, marginTop: 7, alignItems: "center", flexWrap: "wrap" }}>
                      {f.status === "open" && (
                        <button onClick={() => act(f.id, "acknowledged")} style={smallBtn(C.textMid)}>Acknowledge</button>
                      )}
                      <button
                        onClick={() => draft(r.customerNsId, f.id, r.customerName)}
                        disabled={drafting === f.id}
                        style={smallBtn(C.blue)}
                      >
                        {drafting === f.id ? "Working…" : "Draft health check"}
                      </button>
                      <input
                        value={open === r.customerNsId ? note : ""}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Reason, to dismiss…"
                        style={{ flex: "1 1 200px", minWidth: 160, padding: "4px 8px", fontSize: 12,
                                 border: `1px solid ${C.mid}`, borderRadius: 5, fontFamily: C.font }}
                      />
                      <button
                        onClick={() => note.trim() && act(f.id, "dismissed", note.trim())}
                        disabled={!note.trim()}
                        style={{ ...smallBtn(C.red), opacity: note.trim() ? 1 : 0.5 }}
                      >
                        Dismiss for 90d
                      </button>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: C.textSub, lineHeight: 1.6 }}>
                  Dismissals need a reason because they are the only feedback on rule quality —
                  a rule dismissed across many accounts is a bad rule.
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const smallBtn = (color: string): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.border}`, color,
  borderRadius: 5, padding: "3px 9px", fontSize: 11, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
