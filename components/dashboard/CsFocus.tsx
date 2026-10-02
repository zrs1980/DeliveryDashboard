"use client";
import { useEffect, useState, useCallback } from "react";
import { C } from "@/lib/constants";
import type { FocusResult, FocusSection, FocusItem } from "@/lib/cs-focus";
import { currentQuarter } from "@/lib/healthchecks";

interface FocusPayload extends FocusResult {
  /** The signed-in user as a NetSuite employee, resolved server-side. */
  me: { nsId: number | null; name: string | null; email: string };
}

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

const whyBtn: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: C.blue, background: "transparent",
  border: "none", padding: 0, marginLeft: 7, cursor: "pointer", fontFamily: C.font,
};

const toneOf = (t?: "red" | "yellow") =>
  t === "red"    ? { fg: C.red,    bg: C.redBg,    bd: C.redBd }
: t === "yellow" ? { fg: C.yellow, bg: C.yellowBg, bd: C.yellowBd }
:                  { fg: C.textMid, bg: C.alt,     bd: C.border };

export default function CsFocus({
  onOpenCustomer,
}: {
  onOpenCustomer?: (customerNsId: string, name: string) => void;
}) {
  const [data, setData] = useState<FocusPayload | null>(null);
  /**
   * ⚠ A FILTER, NEVER A PERMISSION. "Not mine" is still one click away and the
   * route returns everything regardless — this only decides what is shown
   * first. Defaults to the signed-in user's own book when NetSuite knows who
   * they are, because a list of 87 accounts belonging to several people is the
   * thing a CSM stops opening.
   */
  const [owner, setOwner] = useState<number | "all">("all");
  const [pickedOwner, setPickedOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/cs/focus");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setData(json);
      // Default to "mine" once, on first load, and only if they actually own
      // something — defaulting an unresolved user, or one with an empty book,
      // to a filter that hides everything reads as a broken page.
      if (!pickedOwner && json.me?.nsId) {
        const ownsSomething = (json.sections ?? []).some((sec: FocusSection) =>
          sec.items.some(i => i.ownerNsId === json.me.nsId));
        if (ownsSomething) setOwner(json.me.nsId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, [pickedOwner]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 20, fontSize: 13, color: C.textSub }}>Loading…</div>;
  if (error)   return <div style={{ padding: 20, fontSize: 13, color: C.red }}>{error}</div>;
  if (!data)   return null;

  const mine = (i: FocusItem) => owner === "all" || i.ownerNsId === owner;
  const sections = data.sections.map(sec => ({ ...sec, items: sec.items.filter(mine) }));
  const shown = sections.reduce((n, s) => n + s.items.length, 0);
  const hidden = data.total - shown;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text }}>Focus</h2>
        <span style={{ fontSize: 12, color: C.textSub }}>
          {shown === 0
            ? owner === "all"
              ? "Nothing needs you right now — each section below says why."
              : "Nothing on your accounts. Switch to All to see the rest of the book."
            : `${shown} thing${shown === 1 ? "" : "s"} to act on`}
          {/* Never let a filter hide work silently. */}
          {hidden > 0 && (
            <span style={{ color: C.textSub }}> · {hidden} on other people&apos;s accounts</span>
          )}
        </span>

        <select
          value={String(owner)}
          onChange={e => {
            setPickedOwner(true);
            setOwner(e.target.value === "all" ? "all" : Number(e.target.value));
          }}
          style={{ fontSize: 12, fontFamily: C.font, padding: "3px 8px",
                   border: `1px solid ${C.mid}`, borderRadius: 6,
                   background: C.surface, color: C.text }}
        >
          <option value="all">All accounts</option>
          {/* ⚠ NAME THE PERSON. "Mine" alone is a promise the reader cannot
              check — it means whoever NetSuite matched to their login email,
              and if that match failed they were silently shown everything with
              nothing saying why. */}
          {data.me?.nsId && (
            <option value={String(data.me.nsId)}>
              Mine{data.me.name ? ` — ${data.me.name}` : ""}
            </option>
          )}
          {data.owners
            .filter(o => o.nsId !== data.me?.nsId)
            .map(o => <option key={o.nsId} value={String(o.nsId)}>{o.name}</option>)}
        </select>
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

      {/* The silent case made loud: no NetSuite employee matched this login, so
          there is no "mine" to filter to. Said once, quietly, rather than
          leaving someone to wonder why the option is missing. */}
      {!data.me?.nsId && (
        <div style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.6,
                      background: C.alt, border: `1px solid ${C.border}`,
                      borderRadius: 6, padding: "7px 10px" }}>
          Showing every account: no NetSuite employee record matches
          <span style={{ fontFamily: C.mono }}> {data.me?.email || "your login"}</span>,
          so there is nothing to filter to. Accounts are owned via the consultant
          or sales rep on the NetSuite customer record.
        </div>
      )}

      {sections.map(s => (
        <Section key={s.kind} s={s} onOpenCustomer={onOpenCustomer} onSnoozed={load} />
      ))}
    </div>
  );
}

function Section({
  s, onOpenCustomer, onSnoozed,
}: {
  s: FocusSection;
  onOpenCustomer?: (customerNsId: string, name: string) => void;
  onSnoozed: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  /**
   * ⚠ BULK EXISTS FOR ONE CASE AND IS NOT OFFERED ANYWHERE ELSE. 45 accounts
   * need a health check and they were booked one at a time through a form on
   * separate pages, with the list unchanged while you worked through it.
   *
   * It is deliberately NOT offered on the other sections. Nothing sensible can
   * be done to five quiet accounts at once — "contact them" is five different
   * conversations — and a checkbox that leads to a menu with nothing useful in
   * it is worse than no checkbox.
   */
  const bulkable = s.kind === "never_health_checked";
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
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
        {/* ⚠ THE REASON EARNS ITS PLACE WHEN THE SECTION IS EMPTY, AND GETS OUT
            OF THE WAY WHEN IT IS NOT.
            These started always-visible on the principle that a worklist nobody
            trusts is one that does not say why something is on it. That is
            right the first time you read it and wrong every morning after:
            six justifying paragraphs above six short lists is a wall of prose
            you scroll past to reach nine rows.
            An EMPTY section is the case where the sentence is the content — it
            is the only thing explaining why you are looking at nothing. So it
            stays there, and hides behind "why?" once there is something to
            work. */}
        {(s.items.length === 0 || whyOpen) ? (
          <div style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.6, marginTop: 4 }}>
            {s.why}
            {s.items.length > 0 && (
              <button onClick={() => setWhyOpen(false)}
                      style={whyBtn}>hide</button>
            )}
          </div>
        ) : (
          <button onClick={() => setWhyOpen(true)} style={{ ...whyBtn, marginLeft: 0, marginTop: 3 }}>
            why?
          </button>
        )}
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
            {bulkable && picked.size > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10,
                            padding: "8px 14px", background: C.blueBg,
                            borderTop: `1px solid ${C.blueBd}` }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.blue }}>
                  {picked.size} selected
                </span>
                <button
                  disabled={bulkBusy}
                  onClick={async () => {
                    setBulkBusy(true);
                    try {
                      // Sequential, not parallel: a partial failure is only
                      // reportable if we know how far we got — the same reason
                      // ClickUp task creation is sequential.
                      const failed: string[] = [];
                      for (const id of picked) {
                        const item = s.items.find(x => x.customerNsId === id);
                        const res = await fetch("/api/healthchecks", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            customer_ns_id: id,
                            customer_name: item?.name ?? id,
                            quarter: currentQuarter(),
                          }),
                        });
                        if (!res.ok) failed.push(item?.name ?? id);
                      }
                      if (failed.length) alert(`Could not create: ${failed.join(", ")}`);
                      setPicked(new Set());
                      onSnoozed();          // reloads Focus
                    } finally { setBulkBusy(false); }
                  }}
                  style={{ fontSize: 11.5, fontWeight: 600, color: "#fff", background: C.blue,
                           border: "none", borderRadius: 5, padding: "4px 11px",
                           cursor: "pointer", fontFamily: C.font }}>
                  {bulkBusy ? "Creating…" : `Create ${currentQuarter()} checks`}
                </button>
                <button onClick={() => setPicked(new Set())}
                        style={{ fontSize: 11, color: C.textMid, background: "transparent",
                                 border: "none", cursor: "pointer", fontFamily: C.font }}>
                  Clear
                </button>
                <span style={{ fontSize: 11, color: C.textSub, marginLeft: "auto" }}>
                  Creates unscheduled checks — pick dates on each account.
                </span>
              </div>
            )}

            {shown.map((i, n) => (
              <Row key={i.customerNsId + n} i={i} kind={s.kind}
                   onOpenCustomer={onOpenCustomer} onSnoozed={onSnoozed}
                   picked={bulkable ? picked.has(i.customerNsId) : undefined}
                   onPick={bulkable ? (on) => setPicked(p => {
                     const next = new Set(p);
                     if (on) next.add(i.customerNsId); else next.delete(i.customerNsId);
                     return next;
                   }) : undefined} />
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
  i, kind, onOpenCustomer, onSnoozed, picked, onPick,
}: {
  i: FocusItem;
  kind: string;
  onOpenCustomer?: (customerNsId: string, name: string) => void;
  onSnoozed: () => void;
  /** Undefined on a section where bulk makes no sense — no checkbox at all. */
  picked?: boolean;
  onPick?: (on: boolean) => void;
}) {
  const t = toneOf(i.tone);
  const [busy, setBusy] = useState(false);

  /**
   * ⚠ THE REASON IS ASKED FOR, NOT ASSUMED. The route rejects a snooze without
   * one, because it is the only feedback on whether a section surfaces the
   * right rows — fifty dismissals saying "not a real customer" means the gate
   * is wrong, and nothing else would ever tell us.
   */
  async function snooze(e: React.MouseEvent) {
    e.stopPropagation();                      // the row itself opens the customer
    const reason = window.prompt(
      `Snooze ${i.name} for 30 days.

Why? (this is how we find out when a section is wrong)`);
    if (!reason || !reason.trim()) return;    // cancelled, or no reason given
    setBusy(true);
    try {
      const res = await fetch("/api/cs/focus", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerNsId: i.customerNsId, kind, reason: reason.trim(), days: 30 }),
      });
      if (!res.ok) { alert((await res.json())?.error ?? "Could not snooze."); return; }
      onSnoozed();
    } finally { setBusy(false); }
  }

  // ⚠ TWO SIBLINGS IN A FLEX ROW, NOT A BUTTON INSIDE A BUTTON. The row opens
  // the customer and Snooze does something else, and nesting one interactive
  // element inside another is invalid HTML — the account list hit this exact
  // trap and solved it the same way.
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12,
                  borderTop: `1px solid ${C.border}`, padding: "0 14px 0 0" }}>
      {onPick && (
        <input type="checkbox" checked={Boolean(picked)}
               onChange={e => onPick(e.target.checked)}
               aria-label={`Select ${i.name}`}
               style={{ marginLeft: 14, flexShrink: 0, cursor: "pointer" }} />
      )}
      <button
        onClick={() => onOpenCustomer?.(i.customerNsId, i.name)}
        disabled={!onOpenCustomer}
        style={{
          display: "flex", flexGrow: 1, minWidth: 0, gap: 12, alignItems: "center",
          padding: "9px 0 9px 10px",
          background: "transparent", border: "none",
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
        <span style={{ fontSize: 10.5, color: C.textSub, flexShrink: 0,
                       fontFamily: C.mono, minWidth: 92, textAlign: "right" }}>
          {/* An account NetSuite has no owner for is visibly unowned rather than
              quietly everyone's — that is a gap worth seeing. */}
          {i.ownerName ?? "unowned"}
        </span>
        {onOpenCustomer && (
          <span style={{ fontSize: 11, color: C.blue, flexShrink: 0 }}>Open →</span>
        )}
      </button>

      <button onClick={snooze} disabled={busy}
              title="Hide this for 30 days. You will be asked why."
              style={{ fontSize: 11, color: C.textSub, flexShrink: 0,
                       background: "transparent", border: "none",
                       cursor: "pointer", fontFamily: C.font,
                       opacity: busy ? 0.4 : 1 }}>
        {busy ? "…" : "Snooze"}
      </button>
    </div>
  );
}
