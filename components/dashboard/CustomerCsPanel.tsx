"use client";
import { useEffect, useState } from "react";
import { C } from "@/lib/constants";
import type { CustomerCsBlock } from "@/lib/customer-record";
import { navigateTo } from "@/lib/app-nav";
import CustomerProfilePanel from "@/components/dashboard/CustomerProfilePanel";

// ─── The CS half of the customer page ────────────────────────────────────────
//
// Health, open flags, the extracted profile and the outreach drafts — the four
// things the account page deliberately never showed, now shown on the SAME page
// as the contacts, deals and contracts rather than in a separate tab that could
// not see them.
//
// ⚠ IT RENDERS NOTHING UNLESS THE SERVER SENT A `cs` BLOCK, AND THAT IS THE
// WHOLE SAFETY ARGUMENT. `GET /api/customers/[id]` attaches `cs` only for a
// reader holding cs_layer; for everyone else the key is ABSENT from the JSON.
// So this component is not "hidden" for a consultant — it is handed nothing to
// render. There is no client-side permission check here on purpose: a check
// would imply the data arrived and was suppressed, which is exactly the weaker
// guarantee this design avoids. See lib/customer-record.ts.
//
// A risk flag visibly changes how someone behaves toward a client, and a false
// positive becomes self-fulfilling. That is why the boundary is server-side and
// why this file cannot weaken it.

interface State {
  cs: CustomerCsBlock | null;
  loading: boolean;
  error: string | null;
}

/** Health bands ARE RAG — a judgment the system made and must defend. */
const bandStyle = (band: string | null) => {
  const b = (band ?? "").toLowerCase();
  if (b === "healthy")  return { fg: C.green,   bg: C.greenBg,  bd: C.greenBd };
  if (b === "watch")    return { fg: C.yellow,  bg: C.yellowBg, bd: C.yellowBd };
  if (b === "at_risk" || b === "at risk" || b === "critical")
    return { fg: C.red, bg: C.redBg, bd: C.redBd };
  return { fg: C.textMid, bg: C.alt, bd: C.border };
};

const sevStyle = (s: string | null) => {
  const v = (s ?? "").toLowerCase();
  if (v === "high" || v === "critical") return { fg: C.red,    bg: C.redBg,    bd: C.redBd };
  if (v === "medium")                   return { fg: C.yellow, bg: C.yellowBg, bd: C.yellowBd };
  return { fg: C.textMid, bg: C.alt, bd: C.border };
};

const DRAFT_STYLE: Record<string, { fg: string; bg: string; bd: string }> = {
  sent:     { fg: C.green,   bg: C.greenBg,  bd: C.greenBd },
  rejected: { fg: C.textMid, bg: C.alt,      bd: C.border },
  expired:  { fg: C.textMid, bg: C.alt,      bd: C.border },
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function CustomerCsPanel({
  customerNsId, customerName, onHasCs,
}: {
  customerNsId: string;
  customerName: string;
  /**
   * Told to the parent so it can show or hide the tab that opens this panel.
   * The parent must not decide for itself — only the server's response knows.
   */
  onHasCs?: (has: boolean) => void;
}) {
  const [s, setS] = useState<State>({ cs: null, loading: true, error: null });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/customers/${encodeURIComponent(customerNsId)}`);
        const json = await res.json();
        if (!live) return;
        if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
        // `"cs" in json` rather than `json.cs` — the distinction between an
        // absent key and a present-but-empty one is the entire boundary.
        const cs = "cs" in json ? (json.cs as CustomerCsBlock) : null;
        setS({ cs, loading: false, error: null });
        onHasCs?.(cs !== null);
      } catch (e) {
        if (!live) return;
        setS({ cs: null, loading: false, error: e instanceof Error ? e.message : "Unknown error" });
        onHasCs?.(false);
      }
    })();
    return () => { live = false; };
  }, [customerNsId, onHasCs]);

  if (s.loading) return <div style={{ padding: 14, fontSize: 12, color: C.textSub }}>Loading…</div>;
  if (s.error)   return <div style={{ padding: 14, fontSize: 12, color: C.red }}>{s.error}</div>;
  if (!s.cs)     return null;

  const { healthScore, healthBand, openFlags, profile, profileVerified, drafts } = s.cs;
  const band = bandStyle(healthBand);

  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Health ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 26, fontWeight: 700, fontFamily: C.mono, color: band.fg }}>
            {healthScore ?? "—"}
          </span>
          <span style={{ fontSize: 11, color: C.textSub }}>/ 100</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                       color: band.fg, background: band.bg, border: `1px solid ${band.bd}`,
                       borderRadius: 4, padding: "3px 9px" }}>
          {healthBand ?? "not scored"}
        </span>
        {healthScore === null && (
          <span style={{ fontSize: 11, color: C.textSub }}>
            Never scored — only stage CUSTOMER is judged, and the nightly run must have seen it.
          </span>
        )}
      </div>

      {/* ── Open flags ─────────────────────────────────────────────────── */}
      <Block title={`Open flags (${openFlags.length})`}>
        {openFlags.length === 0 ? (
          // "No flags" is not "healthy" — several rules ship disabled for want
          // of data, so say what was actually evaluated rather than implying a
          // clean bill of health.
          <Empty>Nothing currently flagged. Some rules are disabled pending data they need.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {openFlags.map(f => {
              const sv = sevStyle(f.severity);
              return (
                <div key={f.id} style={{ display: "flex", gap: 9, alignItems: "flex-start",
                                         padding: "7px 9px", background: C.alt,
                                         border: `1px solid ${C.border}`, borderRadius: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, color: sv.fg,
                                 background: sv.bg, border: `1px solid ${sv.bd}`, borderRadius: 3,
                                 padding: "2px 6px", whiteSpace: "nowrap" }}>
                    {(f.severity ?? "—").toUpperCase()}
                  </span>
                  <span style={{ flexGrow: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text, display: "block" }}>
                      {f.summary ?? f.rule_id}
                    </span>
                    <span style={{ fontSize: 10.5, color: C.textSub, fontFamily: C.mono }}>
                      {f.rule_id} · raised {day(f.created_at)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Block>

      {/* ── Profile ────────────────────────────────────────────────────── */}
      <Block title="Profile">
        {!profile ? (
          <Empty>
            No profile extracted yet. Without one there are no quotable facts, so every
            outreach motion would skip with nothing specific to say.
          </Empty>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {/* Verification is tinted blue, never RAG. It decides whether a claim
                may be quoted to a customer — it is not a health judgment, and a
                red chip here would read as "this customer is in trouble". */}
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                           color: profileVerified ? C.blue : C.textMid,
                           background: profileVerified ? C.blueBg : C.alt,
                           border: `1px solid ${profileVerified ? C.blueBd : C.border}`,
                           borderRadius: 3, padding: "2px 7px" }}>
              {profileVerified ? "HUMAN VERIFIED" : "NOT VERIFIED"}
            </span>
            <span style={{ fontSize: 11.5, color: C.textMid }}>
              {profileVerified
                ? "Medium-confidence facts are quotable on this account."
                : "Only high-confidence observed facts may be quoted."}
            </span>
          </div>
        )}
      </Block>

      {/* ── The extracted profile in full ──────────────────────────────── */}
      {/* Folded in from what used to be its own tab. "Risk" and "Profile" both
          answered "what does the CS layer think about this account", and
          neither filled a tab on its own — while a separate "Health" tab sat
          three places from "Health checks", which is a collision nobody would
          get right from the label. */}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 2 }}>
        <CustomerProfilePanel
          embedded
          customerNsId={customerNsId}
          customerName={customerName}
          onClose={() => {}}
        />
      </div>

      {/* ── Drafts ─────────────────────────────────────────────────────── */}
      <Block title={`Outreach drafts (${drafts.length})`}>
        {drafts.length === 0 ? (
          <Empty>No drafts generated for this account.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {drafts.slice(0, 8).map(d => {
              const st = DRAFT_STYLE[d.status] ?? { fg: C.blue, bg: C.blueBg, bd: C.blueBd };
              return (
                <div key={d.id} style={{ display: "flex", gap: 9, alignItems: "center",
                                         fontSize: 12, color: C.text }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, color: st.fg,
                                 background: st.bg, border: `1px solid ${st.bd}`, borderRadius: 3,
                                 padding: "2px 6px", minWidth: 64, textAlign: "center" }}>
                    {d.status.toUpperCase()}
                  </span>
                  <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden",
                                 textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.subject ?? "(no subject)"}
                  </span>
                  <span style={{ fontSize: 10.5, color: C.textSub, fontFamily: C.mono, whiteSpace: "nowrap" }}>
                    {d.motion} · {day(d.created_at)}
                  </span>
                  {/* Read-only here on purpose — a send is reviewed in the
                      draft queue, and putting "approve and send" on a panel
                      someone opened to read a timeline would widen a safety
                      surface that is narrow by design. This just takes them
                      to the screen that does it. */}
                  <button onClick={() => navigateTo({ tab: "cs", focus: { kind: "draft", id: d.id } })}
                          style={{ fontSize: 10, fontWeight: 700, color: C.blue,
                                   background: C.blueBg, border: `1px solid ${C.blueBd}`,
                                   borderRadius: 3, padding: "1px 6px", cursor: "pointer",
                                   fontFamily: C.font, whiteSpace: "nowrap" }}>
                    Review →
                  </button>
                </div>
              );
            })}
            {drafts.length > 8 && (
              <span style={{ fontSize: 11, color: C.textSub }}>+{drafts.length - 8} more</span>
            )}
          </div>
        )}
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: C.textSub,
                    textTransform: "uppercase", marginBottom: 7 }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6 }}>{children}</div>;
}
