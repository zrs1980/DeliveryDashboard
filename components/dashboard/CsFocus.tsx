"use client";
import { useEffect, useState, useCallback } from "react";
import { C } from "@/lib/constants";
import type { FocusResult, FocusSection, FocusItem } from "@/lib/cs-focus";

// ─── Focus ───────────────────────────────────────────────────────────────────
//
// "Which customers should I open this morning, and why."
//
// Grouped by reason to act, never ranked into one list — see lib/cs-focus.ts
// for why. Each section carries its own reason in its own words, because a
// worklist that does not say why something is on it is a worklist people stop
// trusting the first time an entry looks wrong.
//
// ⚠ AN EMPTY SECTION STILL RENDERS. Three states, and they must never look
// alike: genuinely nothing to do; a source that cannot be read; and a source
// nothing has ever written to. The third is the dangerous one — "no overdue
// commitments" reads as reassurance when the truth is that no commitment has
// ever been recorded.

const toneOf = (t?: "red" | "yellow") =>
  t === "red"    ? { fg: C.red,    bg: C.redBg,    bd: C.redBd }
: t === "yellow" ? { fg: C.yellow, bg: C.yellowBg, bd: C.yellowBd }
:                  { fg: C.textMid, bg: C.alt,     bd: C.border };

export default function CsFocus({
  onOpenCustomer,
}: {
  onOpenCustomer?: (customerNsId: string, name: string) => void;
}) {
  const [data, setData] = useState<FocusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/cs/focus");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 20, fontSize: 13, color: C.textSub }}>Loading…</div>;
  if (error)   return <div style={{ padding: 20, fontSize: 13, color: C.red }}>{error}</div>;
  if (!data)   return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text }}>Focus</h2>
        <span style={{ fontSize: 12, color: C.textSub }}>
          {data.total === 0
            ? "Nothing needs you right now — each section below says why."
            : `${data.total} thing${data.total === 1 ? "" : "s"} to act on`}
        </span>
        {/* A stale view that looks identical to a fresh one is how stale data
            gets trusted — the index is rebuilt nightly, so say when. */}
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
          {data.refreshedAt
            ? `index ${new Date(data.refreshedAt).toLocaleString()}`
            : "index never built"}
        </span>
        <button onClick={load} style={{
          fontSize: 11, fontWeight: 600, color: C.blue, background: C.blueBg,
          border: `1px solid ${C.blueBd}`, borderRadius: 5, padding: "3px 9px",
          cursor: "pointer", fontFamily: C.font,
        }}>↻ Refresh</button>
      </div>

      {data.sections.map(s => (
        <Section key={s.kind} s={s} onOpenCustomer={onOpenCustomer} />
      ))}
    </div>
  );
}

function Section({
  s, onOpenCustomer,
}: {
  s: FocusSection;
  onOpenCustomer?: (customerNsId: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const SHOW = 6;
  const shown = expanded ? s.items : s.items.slice(0, SHOW);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 10, boxShadow: C.sh, overflow: "hidden" }}>
      <div style={{ padding: "11px 14px", borderBottom: `1px solid ${C.border}`, background: C.alt }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{s.title}</span>
          {s.items.length > 0 && (
            <span style={{ fontSize: 11, fontFamily: C.mono, fontWeight: 700, color: C.textMid,
                           background: C.surface, border: `1px solid ${C.border}`,
                           borderRadius: 10, padding: "1px 8px" }}>
              {s.items.length}
            </span>
          )}
        </div>
        {/* The reason, always visible. Not a tooltip: if it is worth saying it
            is worth reading without hovering. */}
        <div style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.6, marginTop: 4 }}>{s.why}</div>
      </div>

      <div style={{ padding: s.items.length ? 0 : "12px 14px" }}>
        {s.unavailable ? (
          // Could not be evaluated. Amber, because an unevaluated check is not a
          // passed one — the same rule the suppression checks follow.
          <div style={{ fontSize: 12, color: C.yellow, background: C.yellowBg,
                        border: `1px solid ${C.yellowBd}`, borderRadius: 6,
                        padding: "8px 10px", lineHeight: 1.6 }}>
            {s.unavailable}
          </div>
        ) : s.summary ? (
          <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{s.summary}</div>
        ) : s.items.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textSub }}>Nothing here.</div>
        ) : (
          <>
            {shown.map((i, n) => (
              <Row key={i.customerNsId + n} i={i} onOpenCustomer={onOpenCustomer} />
            ))}
            {s.items.length > SHOW && (
              <button onClick={() => setExpanded(!expanded)} style={{
                width: "100%", padding: "8px 14px", fontSize: 11.5, fontWeight: 600,
                color: C.blue, background: "transparent", border: "none",
                borderTop: `1px solid ${C.border}`, cursor: "pointer",
                fontFamily: C.font, textAlign: "left",
              }}>
                {expanded ? "Show fewer" : `Show all ${s.items.length}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  i, onOpenCustomer,
}: {
  i: FocusItem;
  onOpenCustomer?: (customerNsId: string, name: string) => void;
}) {
  const t = toneOf(i.tone);
  return (
    <button
      onClick={() => onOpenCustomer?.(i.customerNsId, i.name)}
      disabled={!onOpenCustomer}
      style={{
        display: "flex", width: "100%", gap: 12, alignItems: "center",
        padding: "9px 14px", borderTop: `1px solid ${C.border}`,
        background: "transparent", border: "none", borderTopStyle: "solid",
        cursor: onOpenCustomer ? "pointer" : "default", textAlign: "left",
        fontFamily: C.font,
      }}
    >
      {/* Only where the section earned RAG. A neutral row gets no dot rather
          than a grey one — decorative colour is what makes real colour stop
          meaning anything. */}
      {i.tone && (
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.fg, flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text,
                     minWidth: 0, flexShrink: 0, maxWidth: 260,
                     overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {i.name}
      </span>
      <span style={{ fontSize: 12, color: i.tone ? t.fg : C.textMid,
                     flexGrow: 1, minWidth: 0,
                     overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {i.detail}
      </span>
      {onOpenCustomer && (
        <span style={{ fontSize: 11, color: C.blue, flexShrink: 0 }}>Open →</span>
      )}
    </button>
  );
}
