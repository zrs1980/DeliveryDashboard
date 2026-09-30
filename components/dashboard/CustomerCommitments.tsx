"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";

// ─── What we owe them, and what they owe us ──────────────────────────────────
//
// ⚠ THE MOST IMPORTANT THING A CSM RECORDS HAD NOWHERE TO GO. `cs_commitments`
// has the right shape and a complete API — POST, PATCH, GET — and the only
// writer was the Process-meeting wizard, which has run on 7 of 100 meetings.
// So the table is empty, Focus's "We owe them, overdue" section is structurally
// incapable of firing, and someone coming off a call who wants to note
// "revised SOW to Dana by 15 Oct" has only a free-text note that will never
// remind them.
//
// ⚠ RECORDING AND READING ARE GATED DIFFERENTLY, ON PURPOSE. POST is
// session-gated: the people who know what was promised are the PMs and
// consultants on the call, and they must not hold cs_layer, because a risk
// flag reaching the delivery team is self-fulfilling. GET is cs_layer-gated,
// because the book of outstanding obligations is commercial context.
//
// So this component does something slightly unusual and deliberate: **a reader
// who cannot list commitments can still add one**, and is told plainly that it
// goes to the CS team rather than being shown an empty list that looks broken.

interface Commitment {
  id: string;
  direction: "we_owe" | "they_owe";
  description: string;
  due_date: string | null;
  status: "open" | "done" | "slipped" | "cancelled";
  confirmed_by_human: boolean;
  created_by: string | null;
  created_at: string;
}

const fmt = (d: string | null) => {
  if (!d) return null;
  const x = new Date(d);
  return isNaN(x.getTime()) ? d
    : x.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
};

const daysUntil = (d: string | null): number | null => {
  if (!d) return null;
  const x = new Date(d + "T00:00:00");
  if (isNaN(x.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((x.getTime() - t.getTime()) / 86_400_000);
};

export default function CustomerCommitments({ customerNsId }: { customerNsId: string }) {
  const [rows, setRows]     = useState<Commitment[]>([]);
  const [canRead, setCanRead] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [busy, setBusy]     = useState<string | null>(null);

  const [open, setOpen]     = useState(false);
  const [dir, setDir]       = useState<"we_owe" | "they_owe">("we_owe");
  const [text, setText]     = useState("");
  const [due, setDue]       = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cs/commitments?customerNsId=${encodeURIComponent(customerNsId)}`);
      if (res.status === 403) { setCanRead(false); setRows([]); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setCanRead(true);
      setRows(json.commitments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, [customerNsId]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!text.trim()) return;
    setBusy("new"); setError(null);
    try {
      const res = await fetch("/api/cs/commitments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerNsId,
          commitments: [{ direction: dir, description: text.trim(), dueDate: due || null }],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setText(""); setDue(""); setOpen(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  }

  async function setStatus(id: string, status: Commitment["status"]) {
    setBusy(id);
    try {
      const res = await fetch("/api/cs/commitments", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Failed");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  }

  const openRows = rows.filter(r => r.status === "open");
  const weOwe    = openRows.filter(r => r.direction === "we_owe");
  const theyOwe  = openRows.filter(r => r.direction === "they_owe");

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 14,
                  background: C.surface, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px",
                    background: C.alt, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Commitments</span>
        {canRead && openRows.length > 0 && (
          <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textMid }}>
            {weOwe.length} we owe · {theyOwe.length} they owe
          </span>
        )}
        <button onClick={() => setOpen(!open)}
                style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: C.blue,
                         background: C.blueBg, border: `1px solid ${C.blueBd}`,
                         borderRadius: 5, padding: "3px 9px", cursor: "pointer",
                         fontFamily: C.font }}>
          {open ? "Cancel" : "＋ Log a commitment"}
        </button>
      </div>

      <div style={{ padding: "10px 12px" }}>
        {error && (
          <div style={{ fontSize: 11.5, color: C.red, marginBottom: 8 }}>{error}</div>
        )}

        {open && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
            <select value={dir} onChange={e => setDir(e.target.value as typeof dir)}
                    style={fld}>
              <option value="we_owe">We owe them</option>
              <option value="they_owe">They owe us</option>
            </select>
            <input value={text} onChange={e => setText(e.target.value)}
                   onKeyDown={e => { if (e.key === "Enter" && text.trim()) add(); }}
                   placeholder="What was promised?" autoFocus
                   style={{ ...fld, flex: "1 1 240px" }} />
            <input type="date" value={due} onChange={e => setDue(e.target.value)}
                   style={fld} title="Due date" />
            <button onClick={add} disabled={busy === "new" || !text.trim()}
                    style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: C.blue,
                             border: "none", borderRadius: 6, padding: "5px 13px",
                             cursor: "pointer", fontFamily: C.font,
                             opacity: text.trim() ? 1 : 0.5 }}>
              {busy === "new" ? "…" : "Log"}
            </button>
          </div>
        )}

        {/* The consultant's view: they record, they do not receive. Saying so
            is better than an empty list, which reads as "nothing promised". */}
        {!canRead ? (
          <div style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.6 }}>
            Anything logged here goes to the Customer Success team, who track what is
            outstanding. The list itself is not shown on your account.
          </div>
        ) : loading ? (
          <div style={{ fontSize: 12, color: C.textSub }}>Loading…</div>
        ) : openRows.length === 0 ? (
          <div style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.6 }}>
            Nothing outstanding on record. Log what you promised on the last call — it is
            the cheapest thing on this page to keep on top of, and the fastest way to lose
            an account when it slips.
          </div>
        ) : (
          openRows.map(c => {
            const d = daysUntil(c.due_date);
            const late = d !== null && d < 0;
            return (
              <div key={c.id} style={{ display: "flex", gap: 9, alignItems: "flex-start",
                                       padding: "6px 0", borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
                               color: c.direction === "we_owe" ? C.orange : C.teal,
                               background: c.direction === "we_owe" ? C.orangeBg : C.tealBg,
                               border: `1px solid ${c.direction === "we_owe" ? C.orangeBd : C.tealBd}`,
                               borderRadius: 3, padding: "1px 6px", whiteSpace: "nowrap",
                               marginTop: 2 }}>
                  {c.direction === "we_owe" ? "WE OWE" : "THEY OWE"}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.text }}>
                  {c.description}
                  {/* RAG earned: a missed promise is a dated fact, not a judgment. */}
                  {c.due_date && (
                    <span style={{ fontSize: 11, fontFamily: C.mono, marginLeft: 7,
                                   color: late ? C.red : C.textSub }}>
                      {late ? `${Math.abs(d!)}d overdue` : `due ${fmt(c.due_date)}`}
                    </span>
                  )}
                  {/* An agent-extracted commitment nobody confirmed is a claim. */}
                  {!c.confirmed_by_human && (
                    <span style={{ fontSize: 9, fontWeight: 700, marginLeft: 7, color: C.textSub,
                                   background: C.alt, border: `1px solid ${C.border}`,
                                   borderRadius: 3, padding: "1px 5px" }}>
                      UNCONFIRMED
                    </span>
                  )}
                </span>
                <button disabled={busy === c.id} onClick={() => setStatus(c.id, "done")}
                        style={mini(C.green)}>{busy === c.id ? "…" : "Done"}</button>
                <button disabled={busy === c.id} onClick={() => setStatus(c.id, "slipped")}
                        style={mini(C.textSub)}>Slipped</button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const fld: React.CSSProperties = {
  padding: "5px 9px", fontSize: 12, fontFamily: C.font,
  border: `1px solid ${C.mid}`, borderRadius: 6, background: C.surface, color: C.text,
};

const mini = (color: string): React.CSSProperties => ({
  fontSize: 11, fontWeight: 600, color, background: "transparent",
  border: `1px solid ${C.border}`, borderRadius: 5, padding: "2px 8px",
  cursor: "pointer", fontFamily: C.font, whiteSpace: "nowrap", flexShrink: 0,
});
