"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { C } from "@/lib/constants";
import CrmPipeline from "@/components/dashboard/CrmPipeline";
import CrmContacts from "@/components/dashboard/CrmContacts";
import CrmTasks from "@/components/dashboard/CrmTasks";
import CrmAccountPage, { type AccountDetail } from "@/components/dashboard/CrmAccountPage";
import CrmDealPanel from "@/components/dashboard/CrmDealPanel";
import CrmProjects from "@/components/dashboard/CrmProjects";

// ─── CRM ────────────────────────────────────────────────────────────────────
//
// Pipeline, contacts and tasks.
//
// Customers are read live from NetSuite, PLUS any local prospects — accounts
// NetSuite has never heard of, so a deal can start on day one. They carry a
// LOCAL chip everywhere and key on a synthetic `local:<uuid>` (lib/crm-accounts
// .ts). The end state of every one is being linked onto its real NetSuite
// record, which re-keys everything written against it. NetSuite stays the
// customer master.
//
// EVERYTHING ELSE IS APP-OWNED —
// the pipeline, contacts, tasks and activity are never read from or written to
// NetSuite, so nothing overwrites an edit made here and nothing leaks back.
//
// Opportunities and contacts were imported from NetSuite once, before the link
// was removed. `ns_opportunity_id` / `ns_contact_id` on those rows record where
// they came from; nothing matches on them any more.
//
// Not behind cs_layer. This is ordinary commercial work an account manager or
// PM does, not the risk data that boundary exists to contain — no health
// score, band or flag appears anywhere in this view.

type Mode = "accounts" | "pipeline" | "projects" | "contacts" | "tasks";

interface AccountRow {
  // A NetSuite id is a number; a local one is the synthetic `local:<uuid>`.
  id: number | string; companyname: string; entityid: string | null;
  subsidiaryId: number | null; subsidiaryName: string | null;
  inBothSubsidiaries: boolean; stage: string | null;
  entitystatusId?: number | null;
  entitystatusLabel: string | null; industry: string | null;
  isLocal?: boolean; localId?: string;
  // Contact details, for the account page's key-information band.
  billingAddress?: string | null; shippingAddress?: string | null;
  phone?: string | null; email?: string | null; website?: string | null;
  salesrepName?: string | null;
}

/**
 * NetSuite entitystatus 13, "Customer-Closed Won" — a won customer.
 *
 * Verified September 2026 across the 180 active records: 13 Customer-Closed Won
 * (55) · 14 Prospect-Closed Lost (68) · 16 Customer-Lost Customer (30) · 9
 * Prospect-Coordinate Discovery (12) · 10 Prospect-Proposal (6) · and a long
 * tail. The id is matched rather than the label, which is editable in NetSuite.
 */
const CLOSED_WON = 13;

const BLANK_PROSPECT = {
  name: "", domain: "", industry: "", subsidiaryId: "", stage: "PROSPECT", notes: "",
};

const fld: React.CSSProperties = {
  padding: "6px 10px", fontSize: 12.5, fontFamily: C.font,
  border: `1px solid ${C.mid}`, borderRadius: 6, background: C.surface, color: C.text,
};

export default function CrmView() {
  // Accounts first: the account is the thing everything else hangs off, and
  // opening one is how contacts, deals, tasks and correspondence stop being
  // four separate lists.
  const [mode, setMode] = useState<Mode>("accounts");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  // The open deal, held at this level rather than inside the board: a deal is
  // reachable from the board AND from its account, and both must land on the
  // same record page rather than each growing their own.
  const [deal, setDeal] = useState<string | null>(null);
  const [pipelineNonce, setPipelineNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [q, setQ] = useState("");
  const [book, setBook] = useState<"all" | "loop" | "parent">("all");
  /**
   * Won customers by default — 55 of the 180 active records.
   *
   * It is a DEFAULT and not a hard filter on purpose. Restricting the list to
   * Customer-Closed Won outright would also hide every prospect and lead, and
   * the pipeline, contacts and tasks all hang off an account — so you could no
   * longer open a deal on anyone you have not already won. It would also hide
   * every local prospect, making "+ New prospect" create something invisible.
   */
  const [status, setStatus] = useState<"customers" | "pipeline" | "all">("customers");

  // Creating a local prospect, and promoting one onto its NetSuite record.
  const [adding, setAdding]   = useState(false);
  const [np, setNp]           = useState(BLANK_PROSPECT);
  const [savingNp, setSavingNp] = useState(false);
  const [linking, setLinking] = useState<{ localId: string; name: string } | null>(null);
  const [linkQ, setLinkQ]     = useState("");
  const [linkBusy, setLinkBusy] = useState(false);

  const openDeal = useCallback((dealId: string) => {
    setDeal(dealId);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const openCustomer = useCallback((id: string, name: string) => {
    setSelected({ id, name });
    setDeal(null);
    setMode("accounts");
    // The panel renders above the list; scrolling up is what makes the jump
    // read as "opened this account" rather than "nothing happened".
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Two sources, one list. The local ones are fetched separately rather than
  // merged into /api/customers, because that route's response shape is consumed
  // by CustomersView, PMView and ProjectManagementView and must not change.
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const [nsRes, localRes] = await Promise.all([
        fetch("/api/customers"),
        fetch("/api/crm/accounts"),
      ]);
      const ns = await nsRes.json();
      const rows: AccountRow[] = [...(ns.customers ?? [])];

      // A failure here is surfaced, not swallowed. Silently dropping the local
      // accounts would read as "my prospect vanished", which is the one thing
      // a holding pen must never do.
      if (localRes.ok) {
        const lj = await localRes.json();
        rows.push(...(lj.accounts ?? []));
      } else {
        const lj = await localRes.json().catch(() => ({}));
        setError(lj?.hint
          ? `Local prospects could not be loaded: ${lj.error}. ${lj.hint}`
          : `Local prospects could not be loaded: ${lj?.error ?? localRes.status}`);
      }

      rows.sort((a, b) => a.companyname.localeCompare(b.companyname));
      setAccounts(rows);
    } catch {
      /* the empty state covers it */
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  // Loaded once on mount rather than when the Accounts tab is first opened: a
  // deal reached from the pipeline links straight to its account page, which
  // needs the detail row immediately.
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  async function createProspect() {
    if (!np.name.trim()) return;
    setSavingNp(true); setError(null);
    try {
      const res = await fetch("/api/crm/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(np),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setNp(BLANK_PROSPECT); setAdding(false);
      // A local prospect is never Customer-Closed Won, so leaving the default
      // filter on would make the thing just created disappear from the list it
      // was created in.
      setStatus(s => s === "customers" ? "pipeline" : s);
      await loadAccounts();
      // Straight into the new account: the reason you created it is to put
      // something on it.
      openCustomer(json.account.id, json.account.companyname);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setSavingNp(false); }
  }

  async function linkTo(target: AccountRow) {
    if (!linking) return;
    setLinkBusy(true); setError(null);
    try {
      const res = await fetch("/api/crm/accounts/link", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localId: linking.localId,
          customerNsId: String(target.id),
          customerName: target.companyname,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      const m = json.moved ?? {};
      const total = Object.values(m).reduce((n: number, v) => n + Number(v || 0), 0);
      setError(total === 0
        ? `Linked to ${target.companyname}. Nothing was attached to the local record, so nothing moved.`
        : `Linked to ${target.companyname} — moved ${m.contacts ?? 0} contacts, `
          + `${m.opportunities ?? 0} deals, ${m.tasks ?? 0} tasks, ${m.activities ?? 0} activities.`);
      setLinking(null); setLinkQ("");
      setSelected(null);
      await loadAccounts();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLinkBusy(false); }
  }

  const matchesStatus = useCallback((a: AccountRow) => {
    if (status === "all") return true;
    if (status === "customers") return a.entitystatusId === CLOSED_WON;
    // Pipeline: anyone still being sold to, including local prospects, which
    // have no NetSuite status at all.
    return Boolean(a.isLocal) || a.stage === "PROSPECT" || a.stage === "LEAD";
  }, [status]);

  const visibleAccounts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts.filter(a => {
      if (needle && !a.companyname.toLowerCase().includes(needle)) return false;
      if (!matchesStatus(a)) return false;
      // A customer in both subsidiaries belongs on both books — an equality
      // check would drop Certified Waste and Yaffe off the Loop ERP list.
      if (book === "loop")   return a.subsidiaryId === 2 || a.inBothSubsidiaries;
      if (book === "parent") return a.subsidiaryId === 1 || a.inBothSubsidiaries;
      return true;
    });
  }, [accounts, q, book, matchesStatus]);

  const statusCounts = useMemo(() => ({
    customers: accounts.filter(a => a.entitystatusId === CLOSED_WON).length,
    pipeline:  accounts.filter(a => a.isLocal || a.stage === "PROSPECT" || a.stage === "LEAD").length,
    all:       accounts.length,
  }), [accounts]);

  const selectedAccount = useMemo<AccountDetail | undefined>(
    () => selected ? accounts.find(a => String(a.id) === selected.id) : undefined,
    [accounts, selected]);

  const linkTargets = useMemo(() => {
    const needle = linkQ.trim().toLowerCase();
    return accounts
      .filter(a => !a.isLocal && (!needle || a.companyname.toLowerCase().includes(needle)))
      .slice(0, 8);
  }, [accounts, linkQ]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>CRM</h2>
        <span style={{ fontSize: 12, color: C.textSub }}>
          Accounts, pipeline, projects, contacts and tasks. Customers and projects
          stay in NetSuite.
        </span>

        <div style={{ display: "flex", gap: 2, background: C.alt, border: `1px solid ${C.border}`,
                      borderRadius: 7, padding: 2 }}>
          {(["accounts", "pipeline", "projects", "contacts", "tasks"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              background: mode === m ? C.blue : "transparent",
              color: mode === m ? "#fff" : C.textMid,
              border: "none", borderRadius: 5, padding: "4px 13px",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
            }}>
              {m === "accounts" ? "Accounts" : m === "pipeline" ? "Pipeline"
                : m === "projects" ? "Projects" : m === "contacts" ? "Contacts" : "Tasks"}
            </button>
          ))}
        </div>

      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "10px 13px", fontSize: 12, margin: "12px 0", lineHeight: 1.5 }}>
          {error}
          {/relation|does not exist|schema cache|ON CONFLICT/i.test(error) && (
            <div style={{ marginTop: 5 }}>
              Run <span style={{ fontFamily: C.mono }}>supabase/crm-schema.sql</span> in the
              Supabase SQL editor — it is safe to re-run and repairs an existing database.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {deal && (
          <div>
            <CrmDealPanel
              key={deal}
              dealId={deal}
              onClose={() => setDeal(null)}
              onOpenCustomer={openCustomer}
              // An edit here changes a card on the board behind it. Bumping the
              // nonce remounts the board so the two cannot disagree.
              onChanged={() => setPipelineNonce(n => n + 1)}
            />
          </div>
        )}

        {/* An open account REPLACES the list rather than sitting above it — the
            same drill-down shape as the PM tab. An open deal in turn replaces
            the account page, so closing it returns you to where you were. */}
        {mode === "accounts" && selected && !deal && (
          <CrmAccountPage
            key={selected.id}
            customerNsId={selected.id}
            customerName={selected.name}
            account={selectedAccount}
            onClose={() => setSelected(null)}
            onOpenDeal={openDeal}
          />
        )}

        {mode === "accounts" && !selected && !deal && (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search accounts…"
                style={{ flex: "1 1 220px", maxWidth: 300, padding: "6px 11px", fontSize: 13,
                         border: `1px solid ${C.mid}`, borderRadius: 6, fontFamily: C.font }}
              />
              <div style={{ display: "flex", gap: 2, background: C.alt,
                            border: `1px solid ${C.border}`, borderRadius: 7, padding: 2 }}>
                {(["customers", "pipeline", "all"] as const).map(st => (
                  <button key={st} onClick={() => setStatus(st)} style={{
                    background: status === st ? C.surface : "transparent",
                    color: status === st ? C.text : C.textSub,
                    border: status === st ? `1px solid ${C.border}` : "1px solid transparent",
                    borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600,
                    cursor: "pointer", fontFamily: C.font,
                  }}>
                    {st === "customers" ? "Customers" : st === "pipeline" ? "Pipeline" : "All"}
                    <span style={{ marginLeft: 5, fontFamily: C.mono, color: C.textSub }}>
                      {statusCounts[st]}
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 2, background: C.alt,
                            border: `1px solid ${C.border}`, borderRadius: 7, padding: 2 }}>
                {(["all", "loop", "parent"] as const).map(b => (
                  <button key={b} onClick={() => setBook(b)} style={{
                    background: book === b ? C.surface : "transparent",
                    color: book === b ? C.text : C.textSub,
                    border: book === b ? `1px solid ${C.border}` : "1px solid transparent",
                    borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 600,
                    cursor: "pointer", fontFamily: C.font,
                  }}>
                    {b === "all" ? "All" : b === "loop" ? "Loop ERP" : "Loop Services"}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 12, color: C.textSub }}>
                {visibleAccounts.length} of {accounts.length}
              </span>
              <button onClick={() => setAdding(a => !a)} style={{
                background: adding ? "transparent" : C.blueBg,
                border: `1px solid ${adding ? C.border : C.blueBd}`,
                color: adding ? C.textMid : C.blue, borderRadius: 6,
                padding: "5px 12px", fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: C.font,
              }}>
                {adding ? "Cancel" : "+ New prospect"}
              </button>
            </div>

            {adding && (
              <div style={{ border: `1px solid ${C.blueBd}`, background: C.blueBg,
                            borderRadius: 9, padding: "12px 14px", marginBottom: 13,
                            display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11.5, color: C.textMid, lineHeight: 1.55 }}>
                  For a company NetSuite has never heard of. It lives only here, marked
                  <strong> LOCAL</strong>, until you link it to a real NetSuite record —
                  which brings everything you attached along with it.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input value={np.name} onChange={e => setNp({ ...np, name: e.target.value })}
                         placeholder="Company name" autoFocus
                         style={{ ...fld, flex: "1 1 200px" }} />
                  <input value={np.domain} onChange={e => setNp({ ...np, domain: e.target.value })}
                         placeholder="Domain (acme.com)"
                         style={{ ...fld, flex: "1 1 150px", fontFamily: C.mono }} />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input value={np.industry} onChange={e => setNp({ ...np, industry: e.target.value })}
                         placeholder="Industry" style={{ ...fld, flex: "1 1 150px" }} />
                  <select value={np.subsidiaryId}
                          onChange={e => setNp({ ...np, subsidiaryId: e.target.value })}
                          style={{ ...fld, flex: "1 1 140px", cursor: "pointer" }}>
                    <option value="">Book not decided</option>
                    <option value="1">Loop Services</option>
                    <option value="2">Loop ERP</option>
                  </select>
                  <select value={np.stage} onChange={e => setNp({ ...np, stage: e.target.value })}
                          style={{ ...fld, flex: "0 1 130px", cursor: "pointer" }}>
                    <option value="PROSPECT">Prospect</option>
                    <option value="LEAD">Lead</option>
                  </select>
                  <button onClick={createProspect} disabled={savingNp || !np.name.trim()}
                          style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`,
                                   color: C.blue, borderRadius: 6, padding: "6px 14px",
                                   fontSize: 12, fontWeight: 600, cursor: "pointer",
                                   fontFamily: C.font, opacity: np.name.trim() ? 1 : 0.5 }}>
                    {savingNp ? "Creating…" : "Create"}
                  </button>
                </div>
              </div>
            )}

            {/* Promoting a local account onto its NetSuite record. */}
            {linking && (
              <div style={{ border: `1px solid ${C.purpleBd}`, background: C.purpleBg,
                            borderRadius: 9, padding: "12px 14px", marginBottom: 13 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13, color: C.purple }}>
                    Link “{linking.name}” to a NetSuite account
                  </strong>
                  <button onClick={() => { setLinking(null); setLinkQ(""); }}
                          style={{ marginLeft: "auto", background: "transparent",
                                   border: `1px solid ${C.border}`, color: C.textMid,
                                   borderRadius: 5, padding: "2px 9px", fontSize: 11,
                                   fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
                    Cancel
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: C.textMid, margin: "6px 0 9px", lineHeight: 1.55 }}>
                  Every contact, deal, task and activity on the local record moves to the
                  NetSuite one. This cannot be undone from here.
                </div>
                <input value={linkQ} onChange={e => setLinkQ(e.target.value)}
                       placeholder="Search NetSuite accounts…" autoFocus
                       style={{ ...fld, width: "100%", boxSizing: "border-box", marginBottom: 8 }} />
                <div style={{ display: "grid", gap: 4 }}>
                  {linkTargets.length === 0 && (
                    <span style={{ fontSize: 12, color: C.textSub }}>No NetSuite account matches.</span>
                  )}
                  {linkTargets.map(t => (
                    <button key={String(t.id)} disabled={linkBusy}
                            onClick={() => linkTo(t)}
                            style={{ display: "flex", gap: 9, alignItems: "baseline",
                                     textAlign: "left", background: C.surface,
                                     border: `1px solid ${C.border}`, borderRadius: 6,
                                     padding: "7px 11px", cursor: "pointer", fontFamily: C.font }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text }}>
                        {t.companyname}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: C.textSub }}>
                        {t.stage ?? ""}{t.industry ? ` · ${t.industry}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {status === "customers" && accounts.length > 0 && (
              <div style={{ fontSize: 11.5, color: C.textSub, marginBottom: 11, lineHeight: 1.6 }}>
                Showing <strong>Customer-Closed Won</strong> only.
                {" "}{accounts.length - statusCounts.customers} other active
                {" "}record{accounts.length - statusCounts.customers === 1 ? " is" : "s are"} hidden —
                prospects, leads, lost customers and anything not yet in NetSuite.
              </div>
            )}

            {accountsLoading && (
              <div style={{ padding: "26px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                Loading accounts…
              </div>
            )}

            <div style={{ display: "grid", gap: 5 }}>
              {visibleAccounts.map(a => (
                <div key={String(a.id)} style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                <button
                  onClick={() => openCustomer(String(a.id), a.companyname)}
                  style={{
                    display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                    textAlign: "left", width: "100%", flex: 1, minWidth: 0,
                    // No selected-row highlight: opening an account replaces
                    // this list entirely, so no row can be selected while it is
                    // on screen.
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: "9px 13px", cursor: "pointer", fontFamily: C.font,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{a.companyname}</span>
                  {/* Not RAG — teal marks provenance, the same way the task
                      statuses use it for "supplied". This says where the record
                      lives, not whether anything is wrong. */}
                  {a.isLocal && (
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: C.teal,
                                   background: C.tealBg, border: `1px solid ${C.tealBd}`,
                                   borderRadius: 3, padding: "1px 5px" }}>
                      LOCAL
                    </span>
                  )}
                  {(a.subsidiaryId === 2 || a.inBothSubsidiaries) && (
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: C.purple,
                                   background: C.purpleBg, border: `1px solid ${C.purpleBd}`,
                                   borderRadius: 3, padding: "1px 5px" }}>
                      LOOP ERP
                    </span>
                  )}
                  {/* Stage matters here: the list is every active record, so a
                      prospect sitting next to a customer needs to look like one. */}
                  {a.stage && a.stage !== "CUSTOMER" && (
                    <span style={{ fontSize: 10, color: C.textSub, fontFamily: C.mono }}>{a.stage}</span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: C.textSub }}>
                    {a.entitystatusLabel ?? ""}
                    {a.industry ? ` · ${a.industry}` : ""}
                  </span>
                </button>

                {a.isLocal && a.localId && (
                  <button
                    onClick={() => { setLinking({ localId: a.localId!, name: a.companyname }); setAdding(false); }}
                    title="Promote this onto its real NetSuite record, bringing everything with it"
                    style={{ background: C.surface, border: `1px solid ${C.border}`,
                             color: C.purple, borderRadius: 8, padding: "0 11px",
                             fontSize: 11, fontWeight: 600, cursor: "pointer",
                             fontFamily: C.font, whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    Link…
                  </button>
                )}
                </div>
              ))}
            </div>
          </>
        )}

        {mode === "pipeline" && !deal && (
          <CrmPipeline key={pipelineNonce} onOpenCustomer={openCustomer} onOpenDeal={openDeal} />
        )}
        {mode === "projects" && !deal && <CrmProjects />}
        {mode === "contacts" && !deal && <CrmContacts />}
        {mode === "tasks"    && !deal && <CrmTasks />}
      </div>
    </div>
  );
}
