"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";
import { renewalClock, renewalSummary } from "@/lib/cs-contracts";

// ─── Contracts and renewals ─────────────────────────────────────────────────
//
// Read from NetSuite — the Contract Renewals SuiteApp record
// CUSTOMRECORD_CONTRACTS. Terms, dates, values and status are NetSuite's and are
// NOT editable here; a second copy would drift from the renewal process the
// business actually runs on.
//
// The one editable field is the NOTICE PERIOD, because NetSuite has no field for
// it. Until one is entered the countdown runs to the END date, and the row says
// so rather than implying a notice window that was never agreed.
//
// ON COLOUR: this view uses amber and red where the accounts table does not. A
// notice deadline inside 30 days is a hard fact requiring action, not an
// inference about health, so it cannot cry wolf. Green is unused — a contract
// that is simply not due yet is not "healthy", it is just not due.

interface Contract {
  nsContractId: string;
  customerNsId: string;
  customerName: string;
  status: "active" | "renewed" | "other";
  statusLabel: string;
  contractType: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalTermMonths: number | null;
  annualValue: number | null;
  totalValue: number | null;
  dateRenewed: string | null;
  noticePeriodDays: number | null;
  localNotes: string | null;
}

const money = (n: number | null) =>
  n === null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const bandStyle = (band: number | null, expired: boolean, noticePassed: boolean) => {
  if (expired || band === 30 || noticePassed) return { bg: C.redBg, fg: C.red, bd: C.redBd };
  if (band === 60 || band === 90 || band === 120) return { bg: C.yellowBg, fg: C.yellow, bd: C.yellowBd };
  return { bg: C.alt, fg: C.textMid, bd: C.border };
};

export default function CsContracts({ customerNsId }: { customerNsId?: string }) {
  const [all, setAll]       = useState<Contract[]>([]);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [editing, setEdit]  = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy]     = useState(false);

  const load = useCallback(async () => {
    setLoad(true); setError(null);
    try {
      const res  = await fetch("/api/cs/contracts");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setAll(json.contracts ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoad(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveNotice(nsContractId: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/cs/contracts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nsContractId, noticePeriodDays: Number(notice) || 0 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setEdit(null); setNotice("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(false); }
  }

  const shown = customerNsId ? all.filter(c => c.customerNsId === customerNsId) : all;

  // Soonest decision first; contracts with no end date have no clock to run.
  const sorted = [...shown].sort((a, b) => {
    const ka = renewalClock({ end_date: a.endDate, notice_period_days: a.noticePeriodDays ?? 0 });
    const kb = renewalClock({ end_date: b.endDate, notice_period_days: b.noticePeriodDays ?? 0 });
    if (ka.daysToNotice === null) return 1;
    if (kb.daysToNotice === null) return -1;
    return ka.daysToNotice - kb.daysToNotice;
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>
          {customerNsId ? "Contracts" : "Renewal calendar"}
        </h4>
        <span style={{ fontSize: 12, color: C.textSub, fontFamily: C.mono }}>{sorted.length}</span>
        <span style={{ fontSize: 11, color: C.textSub }}>
          From NetSuite · Contract Renewals. Read-only except the notice period.
        </span>
        <button onClick={load} disabled={loading} style={{
          marginLeft: "auto", background: "transparent", border: `1px solid ${C.border}`,
          color: C.textMid, borderRadius: 6, padding: "4px 10px", fontSize: 12,
          fontWeight: 600, cursor: "pointer", fontFamily: C.font,
        }}>↻</button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {loading && <div style={{ fontSize: 12, color: C.textSub, padding: "10px 0" }}>Loading from NetSuite…</div>}

      {!loading && sorted.length === 0 && (
        <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6, padding: "4px 0 10px" }}>
          {customerNsId
            ? "No NetSuite contract for this customer. Without one, nothing can tell a finished implementation from an account going quiet — which is why the silence rules stay quiet here."
            : "No contracts found in NetSuite."}
        </div>
      )}

      {sorted.map(c => {
        const k = renewalClock({ end_date: c.endDate, notice_period_days: c.noticePeriodDays ?? 0 });
        const s = bandStyle(k.alertBand, k.expired, k.noticePassed);
        const superseded = c.status === "renewed";
        return (
          <div key={c.nsContractId} style={{
            border: `1px solid ${C.border}`, borderLeft: `3px solid ${superseded ? C.border : s.bd}`,
            borderRadius: 8, padding: "10px 13px", marginBottom: 8, background: C.surface,
            opacity: superseded ? 0.6 : 1,
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              {!customerNsId && (
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{c.customerName}</span>
              )}
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3,
                             color: C.textSub, fontFamily: C.mono }}>
                {c.statusLabel}
              </span>
              {c.contractType && (
                <span style={{ fontSize: 10, color: C.purple, background: C.purpleBg,
                               border: `1px solid ${C.purpleBd}`, borderRadius: 4, padding: "1px 6px" }}>
                  {c.contractType}
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 12, fontFamily: C.mono, color: C.textMid }}>
                {money(c.annualValue)}/yr
                {c.totalValue && c.totalValue !== c.annualValue ? ` · ${money(c.totalValue)} total` : ""}
              </span>
            </div>

            <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {!superseded && (
                <span style={{ fontSize: 12, fontWeight: 600, color: s.fg, background: s.bg,
                               border: `1px solid ${s.bd}`, borderRadius: 5, padding: "2px 8px" }}>
                  {renewalSummary({ end_date: c.endDate, notice_period_days: c.noticePeriodDays ?? 0, auto_renew: true })}
                </span>
              )}
              <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
                {c.startDate ?? "—"} → {c.endDate ?? "—"}
                {c.renewalTermMonths ? ` · ${c.renewalTermMonths}mo term` : ""}
                {c.dateRenewed ? ` · renewed ${c.dateRenewed}` : ""}
              </span>
            </div>

            {/* The only editable field — NetSuite has no notice-period column. */}
            <div style={{ marginTop: 7, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {editing === c.nsContractId ? (
                <>
                  <input
                    type="number" min={0} autoFocus value={notice}
                    onChange={e => setNotice(e.target.value)}
                    placeholder="days"
                    style={{ width: 90, padding: "3px 8px", fontSize: 12, border: `1px solid ${C.mid}`,
                             borderRadius: 5, fontFamily: C.font }}
                  />
                  <button onClick={() => saveNotice(c.nsContractId)} disabled={busy} style={mini(C.blue)}>
                    {busy ? "…" : "Save"}
                  </button>
                  <button onClick={() => setEdit(null)} style={mini(C.textSub)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 11, color: c.noticePeriodDays ? C.textMid : C.orange }}>
                    {c.noticePeriodDays
                      ? `Notice period: ${c.noticePeriodDays} days`
                      : "No notice period recorded — countdown runs to the end date"}
                  </span>
                  <button
                    onClick={() => { setEdit(c.nsContractId); setNotice(String(c.noticePeriodDays ?? "")); }}
                    style={mini(C.blue)}
                  >
                    {c.noticePeriodDays ? "Change" : "Set notice period"}
                  </button>
                </>
              )}
            </div>

            {c.localNotes && <div style={{ marginTop: 5, fontSize: 12, color: C.textMid }}>{c.localNotes}</div>}
          </div>
        );
      })}
    </div>
  );
}

const mini = (color: string): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.border}`, color,
  borderRadius: 5, padding: "2px 9px", fontSize: 11, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
