"use client";
import { useState } from "react";
import { C } from "@/lib/constants";
import CrmPipeline from "@/components/dashboard/CrmPipeline";
import CrmContacts from "@/components/dashboard/CrmContacts";
import CrmTasks from "@/components/dashboard/CrmTasks";

// ─── CRM ────────────────────────────────────────────────────────────────────
//
// Pipeline, contacts and tasks. Customers stay in NetSuite; contacts and
// opportunities are mirrored in and then owned here; tasks are native.
//
// Not behind cs_layer. This is ordinary commercial work an account manager or
// PM does, not the risk data that boundary exists to contain — no health
// score, band or flag appears anywhere in this view.

type Mode = "pipeline" | "contacts" | "tasks";

interface SyncResult {
  stages: number;
  contacts: { inserted: number; updated: number; skippedNoCompany: number };
  opportunities: { inserted: number; updated: number };
  lines: number;
  activities: number;
  warnings: string[];
  seconds: number;
}

export default function CrmView() {
  const [mode, setMode] = useState<Mode>("pipeline");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withEmail, setWithEmail] = useState(true);

  async function sync() {
    setSyncing(true); setError(null); setResult(null);
    try {
      const res  = await fetch(`/api/crm/sync${withEmail ? "" : "?email=0"}`, { method: "POST" });
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
          {(["pipeline", "contacts", "tasks"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              background: mode === m ? C.blue : "transparent",
              color: mode === m ? "#fff" : C.textMid,
              border: "none", borderRadius: 5, padding: "4px 13px",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font,
            }}>
              {m === "pipeline" ? "Pipeline" : m === "contacts" ? "Contacts" : "Tasks"}
            </button>
          ))}
        </div>

        <label style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center",
                        fontSize: 11, color: C.textSub }}>
          <input type="checkbox" checked={withEmail} onChange={e => setWithEmail(e.target.checked)} />
          include email history
        </label>
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
          ⏳ Pulling contacts, opportunities{withEmail ? " and email history" : ""} from NetSuite.
          {withEmail && " The email history is around 4,300 messages, so this takes a minute or two."} Leave this tab open.
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
          {result.contacts.inserted} contacts added, {result.contacts.updated} updated ·{" "}
          {result.opportunities.inserted} opportunities added, {result.opportunities.updated} updated ·{" "}
          {result.lines} line items · {result.stages} stages
          {result.activities > 0 && ` · ${result.activities.toLocaleString()} emails`}
          {/* Warnings are the interesting part — they are what the data is
              telling you about itself, not noise to collapse. */}
          {result.warnings?.map((w, i) => (
            <div key={i} style={{ color: C.yellow, marginTop: 3 }}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {mode === "pipeline" && <CrmPipeline />}
        {mode === "contacts" && <CrmContacts />}
        {mode === "tasks"    && <CrmTasks />}
      </div>
    </div>
  );
}
