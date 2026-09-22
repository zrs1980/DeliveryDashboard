"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { C } from "@/lib/constants";
import CrmPipeline from "@/components/dashboard/CrmPipeline";
import CrmContacts from "@/components/dashboard/CrmContacts";
import CrmTasks from "@/components/dashboard/CrmTasks";
import CrmCustomerPanel from "@/components/dashboard/CrmCustomerPanel";

// ─── CRM ────────────────────────────────────────────────────────────────────
//
// Pipeline, contacts and tasks.
//
// Customers stay in NetSuite. Opportunities are mirrored in from there and can
// then be edited here. Contacts, tasks and activity are APP-ONLY — they are
// never read from or written to NetSuite, so nothing overwrites them and
// nothing leaks back.
//
// Not behind cs_layer. This is ordinary commercial work an account manager or
// PM does, not the risk data that boundary exists to contain — no health
// score, band or flag appears anywhere in this view.

type Mode = "accounts" | "pipeline" | "contacts" | "tasks";

interface AccountRow {
  id: number; companyname: string; entityid: string;
  subsidiaryId: number | null; subsidiaryName: string | null;
  inBothSubsidiaries: boolean; stage: string | null;
  entitystatusLabel: string | null; industry: string | null;
}

interface SyncResult {
  stages: number;
  opportunities: { inserted: number; updated: number };
  lines: number;
  warnings: string[];
  seconds: number;
}

export default function CrmView() {
  // Accounts first: the account is the thing everything else hangs off, and
  // opening one is how contacts, deals, tasks and correspondence stop being
  // four separate lists.
  const [mode, setMode] = useState<Mode>("accounts");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [q, setQ] = useState("");
  const [book, setBook] = useState<"all" | "loop" | "parent">("all");

  const openCustomer = useCallback((id: string, name: string) => {
    setSelected({ id, name });
    setMode("accounts");
    // The panel renders above the list; scrolling up is what makes the jump
    // read as "opened this account" rather than "nothing happened".
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (mode !== "accounts" || accounts.length) return;
    setAccountsLoading(true);
    fetch("/api/customers")
      .then(r => r.json())
      .then(j => setAccounts(j.customers ?? []))
      .catch(() => { /* the empty state covers it */ })
      .finally(() => setAccountsLoading(false));
  }, [mode, accounts.length]);

  const visibleAccounts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts.filter(a => {
      if (needle && !a.companyname.toLowerCase().includes(needle)) return false;
      // A customer in both subsidiaries belongs on both books — an equality
      // check would drop Certified Waste and Yaffe off the Loop ERP list.
      if (book === "loop")   return a.subsidiaryId === 2 || a.inBothSubsidiaries;
      if (book === "parent") return a.subsidiaryId === 1 || a.inBothSubsidiaries;
      return true;
    });
  }, [accounts, q, book]);

  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setSyncing(true); setError(null); setResult(null);
    try {
      const res  = await fetch("/api/crm/sync", { method: "POST" });
      const text = await res.text();
      let json: Record<string, unknown>;
      // A Vercel timeout page and a login redirect are both HTML; json() on
      // either throws something that says nothing about what happened.
      try { json = JSON.parse(text); }
      catch { throw new Error(`Server returned ${res.status} with a non-JSON body: ${text.slice(0, 140)}`); }
      if (!res.ok) throw new Error(String(json?.error ?? `Failed (${res.status})`));
      setResult(json as unknown as SyncResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setSyncing(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>CRM</h2>
        <span style={{ fontSize: 12, color: C.textSub }}>
          Pipeline, contacts and tasks. Customers stay in NetSuite.
        </span>

        <div style={{ display: "flex", gap: 2, background: C.alt, border: `1px solid ${C.border}`,
                      borderRadius: 7, padding: 2 }}>
          {(["accounts", "pipeline", "contacts", "tasks"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              background: mode === m ? C.blue : "transparent",
              color: mode === m ? "#fff" : C.textMid,
              border: "none", borderRadius: 5, padding: "4px 13px",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
            }}>
              {m === "accounts" ? "Accounts" : m === "pipeline" ? "Pipeline"
                : m === "contacts" ? "Contacts" : "Tasks"}
            </button>
          ))}
        </div>

        <button onClick={sync} disabled={syncing} style={{
          background: C.purpleBg, border: `1px solid ${C.purpleBd}`, color: C.purple,
          borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
          cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.6 : 1, fontFamily: C.font,
        }}>
          {syncing ? "Syncing…" : "↧ Sync from NetSuite"}
        </button>
      </div>

      {syncing && (
        <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, color: C.blue,
                      borderRadius: 8, padding: "10px 13px", fontSize: 12, margin: "12px 0", lineHeight: 1.5 }}>
          ⏳ Pulling the pipeline from NetSuite — stages, opportunities and line items.
          Contacts, tasks and activity are app-only and are not touched. Leave this tab open.
        </div>
      )}

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

      {result && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: "11px 14px", margin: "12px 0", fontSize: 12, color: C.textMid, lineHeight: 1.7 }}>
          <strong style={{ color: C.text }}>Synced in {result.seconds}s.</strong>{" "}
          {result.opportunities.inserted} opportunities added, {result.opportunities.updated} updated ·{" "}
          {result.lines} line items · {result.stages} stages
          {/* Warnings are the interesting part — they are what the data is
              telling you about itself, not noise to collapse. */}
          {result.warnings?.map((w, i) => (
            <div key={i} style={{ color: C.yellow, marginTop: 3 }}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {mode === "accounts" && (
          <>
            {selected && (
              <div style={{ marginBottom: 18 }}>
                <CrmCustomerPanel
                  key={selected.id}
                  customerNsId={selected.id}
                  customerName={selected.name}
                  onClose={() => setSelected(null)}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search accounts…"
                style={{ flex: "1 1 220px", maxWidth: 300, padding: "6px 11px", fontSize: 13,
                         border: `1px solid ${C.mid}`, borderRadius: 6, fontFamily: C.font }}
              />
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
            </div>

            {accountsLoading && (
              <div style={{ padding: "26px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>
                Loading accounts…
              </div>
            )}

            <div style={{ display: "grid", gap: 5 }}>
              {visibleAccounts.map(a => (
                <button
                  key={a.id}
                  onClick={() => openCustomer(String(a.id), a.companyname)}
                  style={{
                    display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                    textAlign: "left", width: "100%",
                    background: selected?.id === String(a.id) ? C.blueBg : C.surface,
                    border: `1px solid ${selected?.id === String(a.id) ? C.blueBd : C.border}`,
                    borderRadius: 8, padding: "9px 13px", cursor: "pointer", fontFamily: C.font,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{a.companyname}</span>
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
              ))}
            </div>
          </>
        )}

        {mode === "pipeline" && <CrmPipeline onOpenCustomer={openCustomer} />}
        {mode === "contacts" && <CrmContacts />}
        {mode === "tasks"    && <CrmTasks />}
      </div>
    </div>
  );
}
