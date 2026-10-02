"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { C } from "@/lib/constants";
import type { SearchHit } from "@/app/api/search/route";

// ─── Cmd+K ───────────────────────────────────────────────────────────────────
//
// 180 customers, 815 contacts, 295 deals, and the only way to reach one was
// Customers → Accounts → filter → scroll.
//
// ⚠ SELECTING A HIT NAVIGATES BY URL, WHICH COSTS A PAGE LOAD, AND THAT IS A
// DELIBERATE TRADE. The alternative is threading a "go here" signal into two
// different customer pages (the CRM one and the CS one) that each own their own
// selection state, and keeping both in step with the address bar. One
// well-formed URL does the same job through the state restoration that already
// exists, and cannot drift from it. A second of load is worth not having two
// ways to open a customer.

const KIND: Record<SearchHit["kind"], { label: string; fg: string; bg: string; bd: string }> = {
  customer: { label: "Account", fg: C.blue,   bg: C.blueBg,   bd: C.blueBd },
  contact:  { label: "Person",  fg: C.teal,   bg: C.tealBg,   bd: C.tealBd },
  deal:     { label: "Deal",    fg: C.purple, bg: C.purpleBg, bd: C.purpleBd },
};

export default function GlobalSearch() {
  const [open, setOpen]   = useState(false);
  const [q, setQ]         = useState("");
  const [hits, setHits]   = useState<SearchHit[]>([]);
  const [busy, setBusy]   = useState(false);
  const [sel, setSel]     = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const runRef   = useRef(0);

  // Cmd+K / Ctrl+K anywhere, Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(v => !v);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  useEffect(() => {
    if (!open) { setQ(""); setHits([]); setSel(0); }
  }, [open]);

  // 180ms debounce. Typing "oxide" is five keystrokes; five round trips to
  // answer one question is five chances to render a half-typed result.
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const run = ++runRef.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const json = await res.json();
        // ⚠ A slower earlier request must not overwrite a newer answer — the
        // same stale-run guard the meetings participant fetch needs.
        if (run !== runRef.current) return;
        setHits(res.ok ? (json.hits ?? []) : []);
        setSel(0);
      } finally {
        if (run === runRef.current) setBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const go = useCallback((h: SearchHit) => {
    const p = new URLSearchParams();
    p.set("tab", "customers");
    p.set("view", "accounts");
    p.set("customer", h.customerNsId);
    window.location.assign(`${window.location.pathname}?${p.toString()}`);
  }, []);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
               zIndex: 1000, display: "flex", alignItems: "flex-start",
               justifyContent: "center", paddingTop: "12vh" }}
    >
      <div onClick={e => e.stopPropagation()}
           style={{ width: "min(600px, 92vw)", background: C.surface,
                    borderRadius: 12, boxShadow: C.shMd, overflow: "hidden" }}>
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
            if (e.key === "ArrowUp")   { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && hits[sel]) { e.preventDefault(); go(hits[sel]); }
          }}
          placeholder="Search accounts, people and deals…"
          style={{ width: "100%", boxSizing: "border-box", padding: "15px 18px",
                   fontSize: 15, fontFamily: C.font, color: C.text,
                   border: "none", borderBottom: `1px solid ${C.border}`, outline: "none" }}
        />

        <div style={{ maxHeight: "52vh", overflowY: "auto" }}>
          {q.trim().length < 2 ? (
            <Note>Type at least two characters. ↑↓ to move, ↵ to open, Esc to close.</Note>
          ) : busy && !hits.length ? (
            <Note>Searching…</Note>
          ) : !hits.length ? (
            // Honest about scope: the index is rebuilt nightly, so a customer
            // created today is genuinely not here yet.
            <Note>
              Nothing matching “{q.trim()}”. Accounts are searched from the nightly
              index, so one created today will not appear until tomorrow.
            </Note>
          ) : (
            hits.map((h, n) => {
              const k = KIND[h.kind];
              return (
                <button
                  key={`${h.kind}:${h.id}`}
                  onClick={() => go(h)}
                  onMouseEnter={() => setSel(n)}
                  style={{ display: "flex", width: "100%", gap: 11, alignItems: "center",
                           padding: "10px 18px", textAlign: "left", cursor: "pointer",
                           background: n === sel ? C.blueBg : "transparent",
                           border: "none", borderBottom: `1px solid ${C.border}`,
                           fontFamily: C.font }}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
                                 color: k.fg, background: k.bg, border: `1px solid ${k.bd}`,
                                 borderRadius: 3, padding: "2px 6px", minWidth: 54,
                                 textAlign: "center", flexShrink: 0 }}>
                    {k.label}
                  </span>
                  <span style={{ minWidth: 0, flexGrow: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text, display: "block",
                                   overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.title}
                    </span>
                    {h.sub && (
                      <span style={{ fontSize: 11.5, color: C.textSub, display: "block",
                                     overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.sub}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 18px", fontSize: 12, color: C.textSub, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}
