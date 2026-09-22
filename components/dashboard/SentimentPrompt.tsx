"use client";
import { useState } from "react";
import { C } from "@/lib/constants";

// ─── Consultant sentiment — three seconds, one click ────────────────────────
//
// "An amber from a consultant who has been on site outranks any derived metric
// in the system." With no product telemetry this is the only relational signal
// available, and it needs months of data before it means anything — so it
// starts collecting now, long before anything reads it.
//
// Design constraint from the spec: a single optional prompt, three seconds to
// complete. Anything heavier gets skipped, and a signal nobody records is worth
// nothing regardless of how good the schema is.
//
// The consultant never sees a score, a flag, or anything else from this module.
// They answer; they do not receive. That asymmetry is deliberate — a risk flag
// reaching the delivery team changes how people behave toward the client and
// becomes self-fulfilling.

const OPTIONS = [
  { rating: "green" as const, label: "Fine",    bg: C.greenBg,  fg: C.green,  bd: C.greenBd  },
  { rating: "amber" as const, label: "Uneasy",  bg: C.yellowBg, fg: C.yellow, bd: C.yellowBd },
  { rating: "red"   as const, label: "Worried", bg: C.redBg,    fg: C.red,    bd: C.redBd    },
];

export default function SentimentPrompt({
  customerNsId, projectNsId, consultantName, compact = false,
}: {
  customerNsId: string | null;
  projectNsId?: string | number | null;
  consultantName?: string;
  compact?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [note,   setNote]   = useState("");
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [busy,   setBusy]   = useState(false);

  // No customer behind this project — internal work, or a native pm_projects
  // row. Nothing to attach an opinion to.
  if (!customerNsId) return null;

  async function send(rating: string, withNote: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/cs/sentiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerNsId, projectNsId: projectNsId ?? null,
          consultantName, rating, note: withNote,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setPicked(null);
    } finally { setBusy(false); }
  }

  if (saved) {
    return (
      <span style={{ fontSize: 11, color: C.textSub }}>
        Thanks — recorded.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {!compact && (
        <span style={{ fontSize: 11, color: C.textSub }}>How is this account feeling?</span>
      )}
      {OPTIONS.map(o => (
        <button
          key={o.rating}
          disabled={busy}
          onClick={() => {
            setPicked(o.rating);
            // Green needs no explanation; amber and red are worth a sentence,
            // but it stays optional — a forced field is a skipped prompt.
            if (o.rating === "green") send(o.rating, "");
          }}
          style={{
            background: picked === o.rating ? o.bg : "transparent",
            border: `1px solid ${picked === o.rating ? o.bd : C.border}`,
            color: picked === o.rating ? o.fg : C.textMid,
            borderRadius: 5, padding: "2px 9px", fontSize: 11, fontWeight: 600,
            cursor: busy ? "default" : "pointer", fontFamily: C.font,
          }}
        >
          {o.label}
        </button>
      ))}

      {picked && picked !== "green" && (
        <>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional — what's the concern?"
            autoFocus
            style={{ flex: "1 1 180px", minWidth: 140, padding: "3px 8px", fontSize: 11,
                     border: `1px solid ${C.mid}`, borderRadius: 5, fontFamily: C.font }}
          />
          <button
            disabled={busy}
            onClick={() => send(picked, note)}
            style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, color: C.blue,
                     borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600,
                     cursor: "pointer", fontFamily: C.font }}
          >
            {busy ? "…" : "Send"}
          </button>
        </>
      )}

      {error && <span style={{ fontSize: 11, color: C.red }}>{error}</span>}
    </div>
  );
}
