"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";
import {
  renewalClock, renewalSummary, PRODUCTS, STATUSES, PRODUCT_LABEL, STATUS_LABEL,
  type CsContract, type ContractProduct, type ContractStatus,
} from "@/lib/cs-contracts";

// ─── Contracts and renewals ─────────────────────────────────────────────────
//
// Hand-entered, because NetSuite has nowhere to put them — verified Sep 2026,
// there is no contract/subscription/billingschedule table in SuiteQL and the
// customer record holds no renewal date, notice period or annual value.
//
// The countdown shown is to the NOTICE deadline, not the end date. A 90-day
// notice period on a 31 December contract means the decision is due on 2
// October; the end date is merely when it becomes too late. Sorting is on that
// same clock.
//
// ON COLOUR: this view does use amber and red, where the accounts table
// deliberately does not. The difference is that a notice deadline inside 30
// days is a hard fact requiring action, not an inference about health — so it
// cannot cry wolf the way colouring 40 of 55 quiet accounts would. Green is not
// used at all: a contract that is simply not due yet is not "healthy", it is
// just not due.

const bandStyle = (band: number | null, expired: boolean, noticePassed: boolean) => {
  if (expired || band === 30) return { bg: C.redBg,    fg: C.red,    bd: C.redBd };
  if (noticePassed)           return { bg: C.redBg,    fg: C.red,    bd: C.redBd };
  if (band === 60 || band === 90 || band === 120) return { bg: C.yellowBg, fg: C.yellow, bd: C.yellowBd };
  return { bg: C.alt, fg: C.textMid, bd: C.border };
};

const money = (n: number | null) =>
  n === null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

interface Props {
  /** Scope to one customer, with an add form. Omit for the portfolio renewal calendar. */
  customerNsId?: string;
  customerName?: string;
}

export default function CsContracts({ customerNsId, customerName }: Props) {
  const [contracts, setContracts] = useState<CsContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<CsContract> | null>(null);
  const [busy,    setBusy]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs  = customerNsId ? `?customerNsId=${encodeURIComponent(customerNsId)}` : "";
      const res = await fetch(`/api/cs/contracts${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setContracts(json.contracts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, [customerNsId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const isNew = !editing.id;
      const res = await fetch("/api/cs/contracts", {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew
          ? { ...editing, customerNsId, customerName }
          : editing),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/cs/contracts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(false); }
  }

  // Portfolio view sorts by the notice clock: soonest decision first, then the
  // ones with no end date at all, which are their own kind of problem.
  const sorted = [...contracts].sort((a, b) => {
    const ka = renewalClock(a), kb = renewalClock(b);
    if (ka.daysToNotice === null && kb.daysToNotice === null) return 0;
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
        <span style={{ fontSize: 12, color: C.textSub, fontFamily: C.mono }}>{contracts.length}</span>
        <span style={{ fontSize: 11, color: C.textSub }}>Countdown is to the notice deadline, not the end date.</span>
        {customerNsId && !editing && (
          <button onClick={() => setEditing({ product: "services", status: "active", notice_period_days: 0, auto_renew: false })}
                  style={{ marginLeft: "auto", ...btnStyle(C.blue, true) }}>
            + Add contract
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {loading && <div style={{ fontSize: 12, color: C.textSub, padding: "10px 0" }}>Loading…</div>}

      {!loading && contracts.length === 0 && !editing && (
        <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6, padding: "4px 0 10px" }}>
          {customerNsId
            ? "No contract recorded. Without one, nothing can tell a finished implementation from an account going quiet — which is why most accounts read as silent."
            : "No contracts recorded yet. Add them from a customer's profile."}
        </div>
      )}

      {editing && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Field label="Product">
              <select value={editing.product ?? "services"} onChange={e => setEditing({ ...editing, product: e.target.value as ContractProduct })} style={input}>
                {PRODUCTS.map(p => <option key={p} value={p}>{PRODUCT_LABEL[p]}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={editing.status ?? "active"} onChange={e => setEditing({ ...editing, status: e.target.value as ContractStatus })} style={input}>
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Start date">
              <input type="date" value={editing.start_date ?? ""} onChange={e => setEditing({ ...editing, start_date: e.target.value })} style={input} />
            </Field>
            <Field label="End date">
              <input type="date" value={editing.end_date ?? ""} onChange={e => setEditing({ ...editing, end_date: e.target.value })} style={input} />
            </Field>
            <Field label="Notice period (days)" hint="The real deadline">
              <input type="number" min={0} value={editing.notice_period_days ?? 0} onChange={e => setEditing({ ...editing, notice_period_days: Number(e.target.value) })} style={input} />
            </Field>
            <Field label="Annual value">
              <input type="number" min={0} value={editing.annual_value ?? ""} onChange={e => setEditing({ ...editing, annual_value: e.target.value === "" ? null : Number(e.target.value) })} style={input} />
            </Field>
            <Field label="Seats">
              <input type="number" min={0} value={editing.seat_count ?? ""} onChange={e => setEditing({ ...editing, seat_count: e.target.value === "" ? null : Number(e.target.value) })} style={input} />
            </Field>
            <Field label="Auto-renew">
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text, height: 30 }}>
                <input type="checkbox" checked={Boolean(editing.auto_renew)} onChange={e => setEditing({ ...editing, auto_renew: e.target.checked })} />
                Renews unless cancelled
              </label>
            </Field>
          </div>
          <Field label="Notes">
            <input value={editing.notes ?? ""} onChange={e => setEditing({ ...editing, notes: e.target.value })} style={{ ...input, width: "100%" }} placeholder="Where this came from, anything unusual…" />
          </Field>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={save} disabled={busy} style={btnStyle(C.blue, true)}>{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => setEditing(null)} disabled={busy} style={btnStyle(C.textMid)}>Cancel</button>
          </div>
        </div>
      )}

      {sorted.map(c => {
        const k = renewalClock(c);
        const s = bandStyle(k.alertBand, k.expired, k.noticePassed);
        return (
          <div key={c.id} style={{ border: `1px solid ${C.border}`, borderLeft: `3px solid ${s.bd}`,
                                   borderRadius: 8, padding: "10px 13px", marginBottom: 8, background: C.surface }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              {!customerNsId && (
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{c.customer_name}</span>
              )}
              <span style={{ fontSize: 12, fontWeight: 600, color: C.textMid }}>{PRODUCT_LABEL[c.product]}</span>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3,
                             color: C.textSub, fontFamily: C.mono }}>{STATUS_LABEL[c.status]}</span>
              {c.auto_renew && (
                <span style={{ fontSize: 10, color: C.purple, background: C.purpleBg,
                               border: `1px solid ${C.purpleBd}`, borderRadius: 4, padding: "1px 6px" }}>
                  auto-renew
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 12, fontFamily: C.mono, color: C.textMid }}>
                {money(c.annual_value)}{c.seat_count ? ` · ${c.seat_count} seats` : ""}
              </span>
            </div>

            <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: s.fg, background: s.bg,
                             border: `1px solid ${s.bd}`, borderRadius: 5, padding: "2px 8px" }}>
                {renewalSummary(c)}
              </span>
              <span style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>
                {c.start_date ?? "—"} → {c.end_date ?? "—"}
                {k.noticeDeadline && ` · notice by ${k.noticeDeadline}`}
                {c.notice_period_days ? ` (${c.notice_period_days}d)` : " (no notice period set)"}
              </span>
              {customerNsId && (
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button onClick={() => setEditing(c)} disabled={busy} style={btnStyle(C.textMid)}>Edit</button>
                  <button onClick={() => remove(c.id)} disabled={busy} style={btnStyle(C.red)}>Delete</button>
                </span>
              )}
            </div>

            {c.notes && <div style={{ marginTop: 5, fontSize: 12, color: C.textMid }}>{c.notes}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6 }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                      textTransform: "uppercase", color: C.textSub, marginBottom: 3 }}>
        {label}{hint && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, marginLeft: 5 }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  padding: "5px 8px", fontSize: 13, border: `1px solid ${C.mid}`, borderRadius: 5,
  fontFamily: C.font, color: C.text, width: "100%", height: 30, background: C.surface,
};

const btnStyle = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
