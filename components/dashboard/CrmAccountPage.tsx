"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { C } from "@/lib/constants";
import CrmContacts from "@/components/dashboard/CrmContacts";
import CrmTasks from "@/components/dashboard/CrmTasks";
import { isLocalAccountId } from "@/lib/crm-accounts";

// ─── The account page ───────────────────────────────────────────
//
// A drill-down, not a panel: opening an account REPLACES the list rather than
// sitting above it, the same shape the PM tab's project drill-down uses. The
// key information band stays on screen across the tabs, because an address and
// a phone number are the things you are usually on this page to read.────
//
// The point of the scaffolding: contacts, opportunities, tasks and the
// correspondence history all key on customer_ns_id, so this is the view where
// that stops being a schema fact and becomes useful.
//
// Deliberately NO health score, band or flag. This panel is open to anyone
// signed in, and risk data reaching the delivery team is self-fulfilling —
// that lives in the CS tab, behind cs_layer.

/** The subset of CsCustomer (and of a local account) this page displays. */
export interface AccountDetail {
  id: number | string;
  companyname: string;
  entityid?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  industry?: string | null;
  stage?: string | null;
  entitystatusLabel?: string | null;
  subsidiaryName?: string | null;
  subsidiaryId?: number | null;
  inBothSubsidiaries?: boolean;
  salesrepName?: string | null;
  isLocal?: boolean;
}

interface Opp {
  id: string; title: string; stage_name: string | null; status: string | null;
  projected_total: number | null; expected_close: string | null;
  opportunity_type: string | null; source: string;
}
interface Activity {
  id: string; kind: string; direction: string | null;
  subject: string | null; body: string | null;
  occurred_at: string; actor_email: string | null; source: string;
}

const money = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—"
    : `$${Math.round(n).toLocaleString()}`;

const KIND_ICON: Record<string, string> = {
  email: "✉", note: "✎", call: "📞", meeting: "👥",
  stage_change: "→", task_done: "✓",
};

interface Contract {
  nsContractId: string; name: string | null;
  status: string; statusLabel: string; contractType: string | null;
  startDate: string | null; endDate: string | null;
  annualValue: number | null; totalValue: number | null;
  renewalTermMonths: number | null;
  netsuiteUrl: string;
  noticePeriodDays: number | null; noticeIsEstimated: boolean;
  daysToRenewal: number | null; daysToNotice: number | null;
  noticeDeadline: string | null; noticePassed: boolean;
  alertBand: 120 | 90 | 60 | 30 | null; expired: boolean;
  summary: string;
}

type Section = "overview" | "contacts" | "tasks" | "activity" | "contracts";

export default function CrmAccountPage({
  customerNsId, customerName, onClose, onOpenDeal, account,
}: {
  customerNsId: string; customerName: string; onClose: () => void;
  onOpenDeal?: (dealId: string) => void;
  /**
   * The row CrmView already holds. Passed rather than re-fetched: the account
   * list is loaded before anything can be clicked, so a detail request here
   * would be a second round trip for data already in memory.
   */
  account?: AccountDetail;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [opps, setOpps] = useState<Opp[]>([]);
  const [stages, setStages] = useState<{ id: string; name: string; is_open: boolean }[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityNote, setActivityNote] = useState<string | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractNote, setContractNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Logging a note or a call — the cheapest thing in a CRM and the one people
  // actually do, so it sits on the panel rather than behind a form.
  const [logKind, setLogKind] = useState<"note" | "call" | "meeting">("note");
  const [logText, setLogText] = useState("");
  const [logging, setLogging] = useState(false);

  // Adding a deal. This is the ONLY way an opportunity now enters the pipeline
  // -- nothing arrives from NetSuite any more -- so it sits on the account
  // panel rather than behind a separate screen, next to the contacts and tasks
  // it will be worked alongside.
  const [adding, setAdding] = useState(false);
  const [nTitle, setNTitle] = useState("");
  const [nValue, setNValue] = useState("");
  const [nStage, setNStage] = useState("");
  const [nClose, setNClose] = useState("");
  const [saving, setSaving] = useState(false);

  async function addOpp() {
    if (!nTitle.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerNsId, customerName, title: nTitle.trim(),
          projectedTotal: nValue.trim() === "" ? undefined : Number(nValue),
          stageId: nStage || undefined,
          expectedClose: nClose || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setNTitle(""); setNValue(""); setNStage(""); setNClose(""); setAdding(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setSaving(false); }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Contracts are fetched with everything else rather than on tab open: the
      // renewal chip in the header has to be right from the first paint, and a
      // deadline that appears only once you click Contracts is a deadline
      // nobody sees.
      const [oRes, aRes, cRes] = await Promise.all([
        fetch(`/api/crm/opportunities?customerNsId=${encodeURIComponent(customerNsId)}`),
        fetch(`/api/crm/activities?customerNsId=${encodeURIComponent(customerNsId)}`),
        fetch(`/api/crm/contracts?customerNsId=${encodeURIComponent(customerNsId)}`),
      ]);
      const [oJson, aJson] = await Promise.all([oRes.json(), aRes.json()]);
      if (!oRes.ok) throw new Error(oJson?.error ?? `Opportunities failed (${oRes.status})`);
      if (!aRes.ok) throw new Error(aJson?.error ?? `Activity failed (${aRes.status})`);
      setOpps(oJson.opportunities ?? []);
      setStages(oJson.stages ?? []);
      setActivities(aJson.activities ?? []);
      setActivityNote(aJson.note ?? null);

      // A contracts failure must not blank the page — the account's deals and
      // contacts are still worth showing, and NetSuite being unreachable is a
      // different problem from the account having no contract.
      const cJson = await cRes.json().catch(() => ({}));
      if (cRes.ok) {
        setContracts(cJson.contracts ?? []);
        setContractNote(cJson.note ?? cJson.noticeOverlayError ?? null);
      } else {
        setContracts([]);
        setContractNote(`Contracts unavailable: ${cJson?.error ?? cRes.status}`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, [customerNsId]);

  useEffect(() => { load(); }, [load]);

  async function log() {
    if (!logText.trim()) return;
    setLogging(true); setError(null);
    try {
      const res = await fetch("/api/crm/activities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerNsId, kind: logKind,
          subject: logText.trim().slice(0, 120),
          body: logText.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setLogText("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLogging(false); }
  }

  const isLocal = isLocalAccountId(customerNsId);

  // The contract that governs. Mirrors currentContractByCustomer(): prefer
  // Active, then the latest end date — Sortera holds a superseded 2025-26 term
  // alongside the 2026-27 one that replaced it, and showing the first row would
  // report an expired contract as current.
  const governing = useMemo(() => {
    const live = contracts.filter(c => !c.expired);
    const pool = live.length ? live : contracts;
    return [...pool].sort((a, b) => {
      const rank = (x: Contract) => x.status === "active" ? 2 : x.status === "other" ? 1 : 0;
      if (rank(b) !== rank(a)) return rank(b) - rank(a);
      return (b.endDate ?? "").localeCompare(a.endDate ?? "");
    })[0] ?? null;
  }, [contracts]);

  const renewalChip = useMemo(() => {
    if (!governing || governing.daysToRenewal === null) return null;
    if (governing.expired) {
      return { text: `CONTRACT ENDED ${Math.abs(governing.daysToRenewal)}D AGO`,
               fg: C.textMid, bg: C.alt, bd: C.border };
    }
    if (governing.noticePassed) {
      return { text: `NOTICE WINDOW CLOSED · ENDS IN ${governing.daysToRenewal}D`,
               fg: C.yellow, bg: C.yellowBg, bd: C.yellowBd };
    }
    const d = governing.daysToNotice;
    if (d === null) return null;
    if (governing.alertBand === 30) {
      return { text: d === 0 ? "NOTICE DUE TODAY" : `NOTICE DUE IN ${d}D`,
               fg: C.red, bg: C.redBg, bd: C.redBd };
    }
    if (governing.alertBand) {
      return { text: `NOTICE DUE IN ${d}D`, fg: C.yellow, bg: C.yellowBg, bd: C.yellowBd };
    }
    // Not due yet is not "healthy", it is just not due — so it stays neutral.
    return { text: `RENEWS IN ${governing.daysToRenewal}D`,
             fg: C.textMid, bg: C.alt, bd: C.border };
  }, [governing]);
  const openOpps = opps.filter(o => o.status === "A");
  const openValue = openOpps.reduce((n, o) => n + (o.projected_total ?? 0), 0);

  return (
    <div style={{ border: `1px solid ${C.mid}`, borderRadius: 10, background: C.surface, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", background: C.alt, borderBottom: `1px solid ${C.border}`,
                    display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{customerName}</span>

        {/* A local account has no NetSuite record, so it gets neither the id nor
            the link. Rendering the link anyway would point at
            custjob.nl?id=local:<uuid> — a dead page that states, wrongly and
            with the authority of a working-looking link, that the account is in
            NetSuite. */}
        {isLocal ? (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: C.teal,
                         background: C.tealBg, border: `1px solid ${C.tealBd}`,
                         borderRadius: 3, padding: "2px 6px" }}>
            LOCAL · NOT IN NETSUITE
          </span>
        ) : (
          <>
            <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub }}>#{customerNsId}</span>
            <a href={`https://system.na1.netsuite.com/app/common/entity/custjob.nl?id=${customerNsId}`}
               target="_blank" rel="noreferrer"
               style={{ fontSize: 11, color: C.purple, background: C.purpleBg,
                        border: `1px solid ${C.purpleBd}`, borderRadius: 5, padding: "2px 7px",
                        textDecoration: "none", fontWeight: 600 }}>
              ↗ NetSuite
            </a>
          </>
        )}
        {account?.stage && account.stage !== "CUSTOMER" && (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: C.textMid,
                         background: C.alt, border: `1px solid ${C.border}`,
                         borderRadius: 3, padding: "2px 6px" }}>
            {account.stage}
          </span>
        )}
        {(account?.subsidiaryId === 2 || account?.inBothSubsidiaries) && (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: C.purple,
                         background: C.purpleBg, border: `1px solid ${C.purpleBd}`,
                         borderRadius: 3, padding: "2px 6px" }}>
            LOOP ERP
          </span>
        )}
        {/* The renewal clock rides in the header so it is visible whichever tab
            you are on. RAG is licensed here for the same reason it is on the
            Renewals view: a notice deadline inside 30 days is a hard fact
            requiring action, not an inference about the account's health. */}
        {renewalChip && (
          <button
            onClick={() => setSection("contracts")}
            style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.2,
                     color: renewalChip.fg, background: renewalChip.bg,
                     border: `1px solid ${renewalChip.bd}`, borderRadius: 4,
                     padding: "3px 8px", cursor: "pointer", fontFamily: C.font }}
          >
            {renewalChip.text}
          </button>
        )}
        <button onClick={onClose} style={{ marginLeft: "auto", ...btn(C.textSub) }}>
          ← All accounts
        </button>
      </div>

      {/* ── Key information ────────────────────────────────────────────
          Only fields that are actually set are rendered. An "Address —" row
          on the 90 of 180 accounts NetSuite has no address for is noise, and
          it reads as a broken page rather than an empty field. */}
      <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.border}`,
                    display: "grid", gap: 13,
                    gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))" }}>
        {account?.billingAddress && (
          <Info label="Address">
            {/* NetSuite returns one newline-delimited block, addressee first. */}
            <span style={{ whiteSpace: "pre-line", lineHeight: 1.45 }}>
              {account.billingAddress}
            </span>
          </Info>
        )}
        {account?.shippingAddress
          && account.shippingAddress !== account.billingAddress && (
          <Info label="Ships to">
            <span style={{ whiteSpace: "pre-line", lineHeight: 1.45 }}>
              {account.shippingAddress}
            </span>
          </Info>
        )}
        {account?.phone && (
          <Info label="Phone">
            <a href={`tel:${account.phone.replace(/[^+\d]/g, "")}`}
               style={{ color: C.blue, textDecoration: "none", fontFamily: C.mono }}>
              {account.phone}
            </a>
          </Info>
        )}
        {account?.email && (
          <Info label="Email">
            <a href={`mailto:${account.email}`} style={{ color: C.blue, textDecoration: "none" }}>
              {account.email}
            </a>
          </Info>
        )}
        {account?.website && (
          <Info label="Website">
            <a href={account.website.startsWith("http") ? account.website : `https://${account.website}`}
               target="_blank" rel="noreferrer"
               style={{ color: C.blue, textDecoration: "none" }}>
              {account.website.replace(/^https?:\/\//, "")}
            </a>
          </Info>
        )}
        {account?.industry   && <Info label="Industry">{account.industry}</Info>}
        {account?.salesrepName && <Info label="Sales rep">{account.salesrepName}</Info>}
        {account?.entityid   && (
          <Info label="Account #"><span style={{ fontFamily: C.mono }}>{account.entityid}</span></Info>
        )}

        {/* Said plainly rather than left as a gap: on this account NetSuite
            holds an address for 90 of 180 customers and a phone for just 31,
            so a blank band is the common case and needs explaining once. */}
        {account && !account.billingAddress && !account.phone && !account.email && (
          <Info label="Contact details">
            <span style={{ color: C.textSub }}>
              {account.isLocal
                ? "None recorded — add them with Edit."
                : "NetSuite holds none for this account."}
            </span>
          </Info>
        )}
        {!account && (
          <Info label="Contact details">
            <span style={{ color: C.textSub }}>Loading…</span>
          </Info>
        )}
      </div>

      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, padding: "0 12px" }}>
        {(["overview", "contacts", "contracts", "tasks", "activity"] as const).map(s => (
          <button key={s} onClick={() => setSection(s)} style={{
            padding: "9px 14px", fontSize: 12,
            fontWeight: section === s ? 700 : 500,
            color: section === s ? C.blue : C.textSub,
            background: "transparent", border: "none",
            borderBottom: section === s ? `2px solid ${C.blue}` : "2px solid transparent",
            cursor: "pointer", fontFamily: C.font, marginBottom: -1,
          }}>
            {s === "overview" ? "Opportunities" : s === "contacts" ? "Contacts"
              : s === "contracts" ? "Contracts" : s === "tasks" ? "Tasks" : "Activity"}
            {s === "contracts" && contracts.length > 0 && (
              <span style={{ marginLeft: 5, fontFamily: C.mono, fontSize: 11 }}>{contracts.length}</span>
            )}
            {s === "overview" && opps.length > 0 && (
              <span style={{ marginLeft: 5, fontFamily: C.mono, fontSize: 11 }}>{opps.length}</span>
            )}
            {s === "activity" && activities.length > 0 && (
              <span style={{ marginLeft: 5, fontFamily: C.mono, fontSize: 11 }}>{activities.length}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding: "14px 16px" }}>
        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                        borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        {section === "overview" && (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center",
                          flexWrap: "wrap", marginBottom: 10 }}>
              {openOpps.length > 0 && (
                <span style={{ fontSize: 12, color: C.textMid }}>
                  <strong style={{ color: C.text, fontFamily: C.mono }}>{money(openValue)}</strong>{" "}
                  across {openOpps.length} open {openOpps.length === 1 ? "deal" : "deals"}
                </span>
              )}
              <button onClick={() => setAdding(a => !a)}
                      style={{ ...btn(C.blue, !adding), marginLeft: "auto" }}>
                {adding ? "Cancel" : "+ Add deal"}
              </button>
            </div>

            {adding && (
              <div style={{ border: `1px solid ${C.blueBd}`, background: C.blueBg,
                            borderRadius: 8, padding: "11px 13px", marginBottom: 11,
                            display: "grid", gap: 8 }}>
                <input
                  value={nTitle} onChange={e => setNTitle(e.target.value)}
                  placeholder="What is the deal? e.g. Phase 2 - WMS rollout"
                  autoFocus
                  style={field()}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={nValue} onChange={e => setNValue(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="Value"
                    inputMode="decimal"
                    style={{ ...field(), flex: "1 1 110px", fontFamily: C.mono }}
                  />
                  {/* Open stages only: a deal is not created already won or lost. */}
                  <select value={nStage} onChange={e => setNStage(e.target.value)}
                          style={{ ...field(), flex: "1 1 150px", cursor: "pointer" }}>
                    <option value="">Stage...</option>
                    {stages.filter(x => x.is_open).map(x => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                  <input
                    type="date" value={nClose} onChange={e => setNClose(e.target.value)}
                    style={{ ...field(), flex: "1 1 140px", fontFamily: C.mono }}
                  />
                  <button onClick={addOpp} disabled={saving || !nTitle.trim()}
                          style={{ ...btn(C.blue, true), opacity: nTitle.trim() ? 1 : 0.5 }}>
                    {saving ? "Saving..." : "Create"}
                  </button>
                </div>
              </div>
            )}
            {loading && <div style={{ fontSize: 12, color: C.textSub }}>Loading…</div>}
            {!loading && opps.length === 0 && (
              <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6, padding: "8px 0" }}>
                No opportunities on this account yet — add the first one above.
              </div>
            )}
            {opps.map(o => (
              <button key={o.id}
                onClick={() => onOpenDeal?.(o.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", fontFamily: C.font,
                  background: C.surface, cursor: onOpenDeal ? "pointer" : "default",
                  border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 13px",
                  marginBottom: 7, opacity: o.status === "A" ? 1 : 0.6,
                }}>
                <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{o.title}</span>
                  <span style={{ fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text }}>
                    {money(o.projected_total)}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: C.textSub }}>
                    {o.stage_name ?? "—"}
                    {o.status === "C" && " · won"}
                    {o.status === "D" && " · lost"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.textSub, marginTop: 3, fontFamily: C.mono }}>
                  {o.expected_close ?? "no close date"}
                  {o.opportunity_type ? ` · ${o.opportunity_type}` : ""}
                </div>
              </button>
            ))}
          </>
        )}

        {section === "contracts" && (
          <>
            {contractNote && (
              <div style={{ background: C.alt, border: `1px solid ${C.border}`, color: C.textMid,
                            borderRadius: 8, padding: "9px 13px", fontSize: 12,
                            marginBottom: 12, lineHeight: 1.55 }}>
                {contractNote}
              </div>
            )}

            {!loading && contracts.length === 0 && !contractNote && (
              <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.7, padding: "6px 0" }}>
                No contract on this account.<br />
                Contracts live in NetSuite&apos;s Contract Renewals record and only five
                accounts carry one, so this is the usual answer rather than a gap.
              </div>
            )}

            <div style={{ display: "grid", gap: 9 }}>
              {contracts.map(ct => {
                const band = ct.expired ? { fg: C.textMid, bg: C.alt, bd: C.border }
                  : ct.alertBand === 30 ? { fg: C.red, bg: C.redBg, bd: C.redBd }
                  : ct.alertBand       ? { fg: C.yellow, bg: C.yellowBg, bd: C.yellowBd }
                  : { fg: C.textMid, bg: C.alt, bd: C.border };
                return (
                  <div key={ct.nsContractId} style={{
                    border: `1px solid ${C.border}`, borderRadius: 9, background: C.surface,
                    padding: "12px 14px", opacity: ct.expired ? 0.65 : 1,
                  }}>
                    <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>
                        {ct.name ?? `Contract ${ct.nsContractId}`}
                      </span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                                     color: ct.status === "active" ? C.green : C.textMid,
                                     background: ct.status === "active" ? C.greenBg : C.alt,
                                     border: `1px solid ${ct.status === "active" ? C.greenBd : C.border}`,
                                     borderRadius: 3, padding: "1px 6px" }}>
                        {ct.statusLabel.toUpperCase()}
                      </span>
                      {ct.contractType && (
                        <span style={{ fontSize: 11.5, color: C.textMid }}>{ct.contractType}</span>
                      )}
                      <a href={ct.netsuiteUrl} target="_blank" rel="noreferrer"
                         style={{ marginLeft: "auto", fontSize: 11, color: C.purple,
                                  background: C.purpleBg, border: `1px solid ${C.purpleBd}`,
                                  borderRadius: 5, padding: "2px 7px",
                                  textDecoration: "none", fontWeight: 600 }}>
                        ↗ NetSuite
                      </a>
                    </div>

                    <div style={{ display: "grid", gap: 11, marginTop: 11,
                                  gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))" }}>
                      <Info label="Term">
                        <span style={{ fontFamily: C.mono }}>
                          {ct.startDate ?? "?"} → {ct.endDate ?? "?"}
                        </span>
                      </Info>
                      {ct.annualValue !== null && (
                        <Info label="Annual value">
                          <span style={{ fontFamily: C.mono, fontWeight: 700 }}>
                            ${ct.annualValue.toLocaleString()}
                          </span>
                        </Info>
                      )}
                      {ct.totalValue !== null && (
                        <Info label="Total value">
                          <span style={{ fontFamily: C.mono }}>
                            ${ct.totalValue.toLocaleString()}
                          </span>
                        </Info>
                      )}
                      {ct.renewalTermMonths !== null && (
                        <Info label="Renewal term">{ct.renewalTermMonths} months</Info>
                      )}
                    </div>

                    <div style={{ marginTop: 11, padding: "8px 11px", borderRadius: 7,
                                  background: band.bg, border: `1px solid ${band.bd}` }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: band.fg }}>
                        {ct.summary}
                      </div>
                      <div style={{ fontSize: 11, color: C.textMid, marginTop: 3, lineHeight: 1.5 }}>
                        {/* Saying WHICH date the countdown runs to is the whole
                            point. NetSuite holds no notice period — its
                            days-before-renewal field reads 358 on every contract
                            in the account, so it is a SuiteApp setting, not a
                            term. Without an entered period the clock runs to the
                            end date, and that has to be stated rather than
                            implied. */}
                        {ct.noticeIsEstimated
                          ? "No notice period recorded, so this counts to the end date. Set one on the Renewals view to get the real deadline."
                          : `Notice deadline ${ct.noticeDeadline} · ${ct.noticePeriodDays} days before end.`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {contracts.length > 0 && (
              <p style={{ fontSize: 11, color: C.textSub, marginTop: 11, lineHeight: 1.6 }}>
                Read live from NetSuite&apos;s Contract Renewals record and not editable here —
                a second copy would drift from the process the business runs on.
              </p>
            )}
          </>
        )}

        {section === "contacts" && <CrmContacts customerNsId={customerNsId} />}
        {section === "tasks"    && <CrmTasks customerNsId={customerNsId} />}

        {section === "activity" && (
          <>
            <div style={{ display: "flex", gap: 7, marginBottom: 12, flexWrap: "wrap" }}>
              <select value={logKind} onChange={e => setLogKind(e.target.value as typeof logKind)}
                      style={{ padding: "5px 9px", fontSize: 12, border: `1px solid ${C.mid}`,
                               borderRadius: 6, fontFamily: C.font }}>
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
              </select>
              <input
                value={logText} onChange={e => setLogText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && logText.trim()) log(); }}
                placeholder="What happened?"
                style={{ flex: "1 1 240px", padding: "5px 10px", fontSize: 12,
                         border: `1px solid ${C.mid}`, borderRadius: 6, fontFamily: C.font }}
              />
              <button onClick={log} disabled={logging || !logText.trim()}
                      style={{ ...btn(C.blue, true), opacity: logText.trim() ? 1 : 0.5 }}>
                {logging ? "…" : "Log"}
              </button>
            </div>

            {activityNote && (
              <div style={{ fontSize: 11, color: C.textSub, marginBottom: 10, lineHeight: 1.5 }}>
                {activityNote}
              </div>
            )}

            {loading && <div style={{ fontSize: 12, color: C.textSub }}>Loading…</div>}
            {!loading && activities.length === 0 && (
              <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6 }}>
                Nothing recorded yet. Historic email was seeded from NetSuite once and is not
                refreshed; anything from here on is what gets logged or sent in this app.
              </div>
            )}

            {activities.map(a => (
              <div key={a.id} style={{
                display: "flex", gap: 10, padding: "8px 0",
                borderBottom: `1px solid ${C.border}`,
              }}>
                <span style={{ fontSize: 13, width: 18, textAlign: "center", flexShrink: 0,
                               color: a.direction === "inbound" ? C.green : C.textSub }}>
                  {KIND_ICON[a.kind] ?? "·"}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: C.text, fontWeight: 500 }}>
                    {a.subject ?? a.kind}
                  </div>
                  {a.body && (
                    <div style={{ fontSize: 11.5, color: C.textMid, marginTop: 2, lineHeight: 1.5,
                                  maxHeight: 54, overflow: "hidden" }}>
                      {a.body.replace(/\s+/g, " ").slice(0, 220)}
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: C.textSub, marginTop: 3, fontFamily: C.mono }}>
                    {new Date(a.occurred_at).toLocaleDateString()}
                    {a.actor_email ? ` · ${a.actor_email}` : ""}
                    {a.source === "netsuite" ? " · NetSuite" : ""}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const field = (): React.CSSProperties => ({
  padding: "6px 10px", fontSize: 12.5, fontFamily: C.font,
  border: `1px solid ${C.mid}`, borderRadius: 6, background: C.surface, color: C.text,
});
function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5,
                     color: C.textSub, textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 12.5, color: C.text, wordBreak: "break-word" }}>
        {children}
      </span>
    </div>
  );
}

const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
