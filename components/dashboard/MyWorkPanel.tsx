"use client";
import { useEffect, useState } from "react";
import { C } from "@/lib/constants";
import type { MyWork, WorkItem } from "@/lib/my-work";

// ─── What is waiting on you ──────────────────────────────────────────────────
//
// Focus answers this question for the book and is cs_layer-only, so perhaps
// three people could see it. This answers it for one person, from facts rather
// than judgments, which is what lets it be shown to everyone.
//
// ⚠ IT RENDERS NOTHING WHEN THERE IS NOTHING. A permanent "0 items" panel at
// the top of a page people open daily is a thing they stop seeing, and it takes
// the rest of the page down with it.

interface Payload extends MyWork {
  me: { email: string; name: string | null; nsId: number | null };
  note?: string;
}

const due = (d: number | null) =>
  d === null ? { text: "no date", urgent: false }
: d < 0     ? { text: `${Math.abs(d)}d overdue`, urgent: true }
: d === 0   ? { text: "today", urgent: true }
:             { text: `in ${d}d`, urgent: false };

export default function MyWorkPanel({
  onOpenCustomer,
}: {
  onOpenCustomer?: (customerNsId: string, name: string) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/me/work");
        const json = await res.json();
        if (!live) return;
        if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
        setData(json);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Unknown error");
      }
    })();
    return () => { live = false; };
  }, []);

  if (error) {
    return <div style={{ fontSize: 12, color: C.red, marginBottom: 14 }}>{error}</div>;
  }
  // Nothing assigned, and no note to explain a partial answer: stay silent.
  if (!data || (data.total === 0 && !data.note)) return null;

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                  boxShadow: C.sh, marginBottom: 18, overflow: "hidden" }}>
      <div style={{ padding: "11px 14px", background: C.alt,
                    borderBottom: `1px solid ${C.border}`, display: "flex",
                    alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Waiting on you</span>
        <span style={{ fontSize: 11.5, color: C.textSub }}>
          {data.total === 0 ? "Nothing assigned" : `${data.total} item${data.total === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* A partial answer says so. Someone with no NetSuite employee record
          genuinely cannot be found by the two sources keyed on it, and an
          unexplained short list reads as "you have nothing on". */}
      {data.note && (
        <div style={{ fontSize: 11.5, color: C.yellow, background: C.yellowBg,
                      borderBottom: `1px solid ${C.yellowBd}`, padding: "8px 14px",
                      lineHeight: 1.5 }}>
          {data.note}
        </div>
      )}

      {data.sections.map(s => (
        <div key={s.key}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: C.textSub,
                        textTransform: "uppercase", padding: "9px 14px 5px" }}>
            {s.title} <span style={{ fontFamily: C.mono }}>{s.items.length}</span>
          </div>
          {s.items.slice(0, 6).map(i => <Row key={i.id} i={i} onOpenCustomer={onOpenCustomer} />)}
          {s.items.length > 6 && (
            <div style={{ fontSize: 11, color: C.textSub, padding: "4px 14px 9px" }}>
              +{s.items.length - 6} more
            </div>
          )}
        </div>
      ))}

      {data.warnings.map((w, n) => (
        <div key={n} style={{ fontSize: 11, color: C.yellow, padding: "6px 14px" }}>{w}</div>
      ))}
    </div>
  );
}

function Row({
  i, onOpenCustomer,
}: {
  i: WorkItem;
  onOpenCustomer?: (customerNsId: string, name: string) => void;
}) {
  const d = due(i.daysUntil);
  const clickable = Boolean(onOpenCustomer && i.customerNsId);

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline",
                  padding: "6px 14px", borderTop: `1px solid ${C.border}` }}>
      {/* RAG earned: overdue is a dated fact, not an inference about anyone. */}
      <span style={{ fontSize: 11, fontFamily: C.mono, minWidth: 84, flexShrink: 0,
                     color: d.urgent ? C.red : C.textSub }}>
        {d.text}
      </span>
      {clickable ? (
        <button onClick={() => onOpenCustomer!(i.customerNsId!, i.customerName ?? i.customerNsId!)}
                style={{ flexGrow: 1, minWidth: 0, textAlign: "left", background: "transparent",
                         border: "none", padding: 0, cursor: "pointer", fontFamily: C.font,
                         fontSize: 12.5, color: C.text }}>
          {i.title}
          {i.customerName && (
            <span style={{ color: C.textSub }}> · {i.customerName}</span>
          )}
        </button>
      ) : (
        <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: C.text }}>
          {i.title}
          {i.detail && <span style={{ color: C.textSub }}> · {i.detail}</span>}
        </span>
      )}
    </div>
  );
}
