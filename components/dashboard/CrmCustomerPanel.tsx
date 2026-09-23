"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";
import CrmContacts from "@/components/dashboard/CrmContacts";
import CrmTasks from "@/components/dashboard/CrmTasks";
import { isLocalAccountId } from "@/lib/crm-accounts";

// ─── One account, everything attached to it ─────────────────────────────────
//
// The point of the scaffolding: contacts, opportunities, tasks and the
// correspondence history all key on customer_ns_id, so this is the view where
// that stops being a schema fact and becomes useful.
//
// Deliberately NO health score, band or flag. This panel is open to anyone
// signed in, and risk data reaching the delivery team is self-fulfilling —
// that lives in the CS tab, behind cs_layer.

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

type Section = "overview" | "contacts" | "tasks" | "activity";

export default function CrmCustomerPanel({
  customerNsId, customerName, onClose, onOpenDeal,
}: {
  customerNsId: string; customerName: string; onClose: () => void;
  onOpenDeal?: (dealId: string) => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [opps, setOpps] = useState<Opp[]>([]);
  const [stages, setStages] = useState<{ id: string; name: string; is_open: boolean }[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityNote, setActivityNote] = useState<string | null>(null);
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
      const [oRes, aRes] = await Promise.all([
        fetch(`/api/crm/opportunities?customerNsId=${encodeURIComponent(customerNsId)}`),
        fetch(`/api/crm/activities?customerNsId=${encodeURIComponent(customerNsId)}`),
      ]);
      const [oJson, aJson] = await Promise.all([oRes.json(), aRes.json()]);
      if (!oRes.ok) throw new Error(oJson?.error ?? `Opportunities failed (${oRes.status})`);
      if (!aRes.ok) throw new Error(aJson?.error ?? `Activity failed (${aRes.status})`);
      setOpps(oJson.opportunities ?? []);
      setStages(oJson.stages ?? []);
      setActivities(aJson.activities ?? []);
      setActivityNote(aJson.note ?? null);
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
        <button onClick={onClose} style={{ marginLeft: "auto", ...btn(C.textSub) }}>Close</button>
      </div>

      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, padding: "0 12px" }}>
        {(["overview", "contacts", "tasks", "activity"] as const).map(s => (
          <button key={s} onClick={() => setSection(s)} style={{
            padding: "9px 14px", fontSize: 12,
            fontWeight: section === s ? 700 : 500,
            color: section === s ? C.blue : C.textSub,
            background: "transparent", border: "none",
            borderBottom: section === s ? `2px solid ${C.blue}` : "2px solid transparent",
            cursor: "pointer", fontFamily: C.font, marginBottom: -1,
          }}>
            {s === "overview" ? "Opportunities" : s === "contacts" ? "Contacts" : s === "tasks" ? "Tasks" : "Activity"}
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
const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
