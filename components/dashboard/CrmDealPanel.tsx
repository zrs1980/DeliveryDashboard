"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { C } from "@/lib/constants";
import CrmTasks from "@/components/dashboard/CrmTasks";

// ─── One deal, everything on it ─────────────────────────────────────────────
//
// The record page. Until now a deal was a card on a board with a stage
// dropdown: there was no way to change its value, its close date or its owner,
// no way to see who was on it, and no way to tell when anyone last touched it.
// Every other object had a home and the deal — the thing the pipeline is
// actually made of — did not.
//
// Layout follows the shape a CRM record page has for good reason: properties
// stay on screen while you work the tabs, because the value and the close date
// are the context for everything else. Tabs are People / Tasks / Activity.
//
// Deliberately NO health score or RAG band, matching CrmCustomerPanel. The one
// exception is inactivity, which is a fact about a date — see below.

interface Stage {
  id: string; name: string; probability: number | null;
  sort_order: number; is_won: boolean; is_lost: boolean; is_open: boolean;
}
interface Deal {
  id: string; title: string; description: string | null;
  customer_ns_id: string; customer_name: string | null;
  stage_id: string | null; stage_name: string | null; status: string | null;
  opportunity_type: string | null; lead_source: string | null;
  projected_total: number | null; probability: number | null;
  expected_close: string | null; owner_name: string | null;
  ns_opportunity_id: string | null; ns_tranid: string | null; source: string;
}
interface LinkedContact {
  contact_id: string; label: string; is_primary: boolean;
  contact: {
    id: string; name: string; email: string | null; job_title: string | null;
    phone: string | null; mobile: string | null; role: string; is_active: boolean;
  } | null;
}
interface Activity {
  id: string; kind: string; direction: string | null;
  subject: string | null; body: string | null;
  occurred_at: string; actor_email: string | null; actor_name: string | null;
}
interface AccountContact {
  id: string; name: string; email: string | null; job_title: string | null;
}

const LABEL_TEXT: Record<string, string> = {
  decision_maker:   "Decision maker",
  budget_holder:    "Budget holder",
  champion:         "Champion",
  influencer:       "Influencer",
  technical:        "Technical",
  billing:          "Billing",
  blocker:          "Blocker",
  point_of_contact: "Point of contact",
  unlabeled:        "No label",
};

// Blue for the roles that carry commercial weight, red for a blocker, neutral
// otherwise. A blocker is red because it is a stated fact about the deal, not a
// guess about its health — the same line the rest of this module draws.
const LABEL_STYLE = (l: string) =>
  l === "blocker"
    ? { fg: C.red, bg: C.redBg, bd: C.redBd }
    : l === "decision_maker" || l === "budget_holder" || l === "champion"
      ? { fg: C.blue, bg: C.blueBg, bd: C.blueBd }
      : { fg: C.textMid, bg: C.alt, bd: C.border };

const KIND_ICON: Record<string, string> = {
  email: "✉", note: "✎", call: "📞", meeting: "👥",
  stage_change: "→", task_done: "✓",
};

const money = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—"
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

type Tab = "people" | "tasks" | "activity";

export default function CrmDealPanel({
  dealId, onClose, onOpenCustomer, onChanged,
}: {
  dealId: string;
  onClose: () => void;
  onOpenCustomer?: (id: string, name: string) => void;
  /** Lets the board refresh after an edit, so the card and the panel agree. */
  onChanged?: () => void;
}) {
  const [deal, setDeal]         = useState<Deal | null>(null);
  const [stages, setStages]     = useState<Stage[]>([]);
  const [people, setPeople]     = useState<LinkedContact[]>([]);
  const [acts, setActs]         = useState<Activity[]>([]);
  const [taskCount, setTaskCount] = useState(0);
  const [daysQuiet, setDaysQuiet] = useState<number | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [tab, setTab]           = useState<Tab>("people");

  // Property edits are staged and saved together. Saving per keystroke would
  // write a row per character; saving per field makes "change the value and the
  // close date" two round trips and two timeline entries.
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // The account's contacts, for the add-person picker.
  const [accountContacts, setAccountContacts] = useState<AccountContact[]>([]);
  const [addId, setAddId]     = useState("");
  const [addLabel, setAddLabel] = useState("point_of_contact");
  const [busy, setBusy]       = useState<string | null>(null);

  const [note, setNote]       = useState("");
  const [noteKind, setNoteKind] = useState<"note" | "call" | "meeting">("note");
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/crm/opportunities?id=${encodeURIComponent(dealId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setDeal(json.deal);
      setStages(json.stages ?? []);
      setPeople(json.contacts ?? []);
      setActs(json.activities ?? []);
      setTaskCount((json.tasks ?? []).filter((t: { status: string }) =>
        t.status === "open" || t.status === "in_progress").length);
      setDaysQuiet(json.daysSinceActivity ?? null);
      setEdit({});
      if (json.errors?.length) setError(json.errors.join(" · "));

      if (json.deal?.customer_ns_id) {
        const cRes = await fetch(
          `/api/crm/contacts?customerNsId=${encodeURIComponent(json.deal.customer_ns_id)}`);
        const cJson = await cRes.json();
        if (cRes.ok) setAccountContacts(cJson.contacts ?? []);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const field = (k: keyof Deal) =>
    edit[k] !== undefined ? edit[k] : (deal?.[k] ?? "") === null ? "" : String(deal?.[k] ?? "");
  const set = (k: string, v: string) => setEdit(e => ({ ...e, [k]: v }));
  const dirty = Object.keys(edit).length > 0;

  async function save(extra?: Record<string, unknown>) {
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: dealId,
          title:           edit.title,
          description:     edit.description,
          projectedTotal:  edit.projected_total,
          expectedClose:   edit.expected_close,
          opportunityType: edit.opportunity_type,
          ownerName:       edit.owner_name,
          leadSource:      edit.lead_source,
          probability:     edit.probability,
          ...extra,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      await load();
      onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setSaving(false); }
  }

  async function link(method: string, body: Record<string, unknown>, key: string) {
    setBusy(key); setError(null);
    try {
      const qs = method === "DELETE"
        ? `?opportunityId=${encodeURIComponent(dealId)}&contactId=${encodeURIComponent(String(body.contactId))}`
        : "";
      const res = await fetch(`/api/crm/deal-contacts${qs}`, {
        method,
        headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined
          : JSON.stringify({ opportunityId: dealId, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      await load();
      onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  }

  async function logNote() {
    if (!note.trim()) return;
    setLogging(true); setError(null);
    try {
      const res = await fetch("/api/crm/activities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: dealId, customerNsId: deal?.customer_ns_id,
          kind: noteKind, direction: "internal",
          subject: note.trim().slice(0, 120), body: note.trim(),
          occurredAt: new Date().toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setNote("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLogging(false); }
  }

  const onDeal = useMemo(() => new Set(people.map(p => p.contact_id)), [people]);
  const addable = accountContacts.filter(c => !onDeal.has(c.id));
  const stage = stages.find(s => s.id === deal?.stage_id);

  if (loading && !deal) {
    return (
      <div style={shell}>
        <div style={{ padding: "26px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>
          Loading deal…
        </div>
      </div>
    );
  }
  if (!deal) {
    return (
      <div style={shell}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 13, color: C.red }}>{error ?? "Deal not found."}</span>
          <button onClick={onClose} style={btn(C.textMid)}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            value={field("title")}
            onChange={e => set("title", e.target.value)}
            style={{
              width: "100%", maxWidth: 520, fontSize: 17, fontWeight: 700, color: C.text,
              fontFamily: C.font, border: "1px solid transparent", borderRadius: 6,
              padding: "3px 6px", marginLeft: -6, background: "transparent",
            }}
            onFocus={e => { e.target.style.borderColor = C.mid; e.target.style.background = C.surface; }}
            onBlur={e => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginTop: 2 }}>
            <button
              onClick={() => deal.customer_name &&
                onOpenCustomer?.(deal.customer_ns_id, deal.customer_name)}
              style={{ background: "none", border: "none", padding: 0, fontSize: 12.5,
                       color: C.blue, cursor: onOpenCustomer ? "pointer" : "default",
                       fontFamily: C.font }}
            >
              {deal.customer_name ?? deal.customer_ns_id}
            </button>
            {stage && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                color: stage.is_won ? C.green : stage.is_lost ? C.textMid : C.blue,
                background: stage.is_won ? C.greenBg : stage.is_lost ? C.alt : C.blueBg,
                border: `1px solid ${stage.is_won ? C.greenBd : stage.is_lost ? C.border : C.blueBd}`,
                borderRadius: 3, padding: "1px 6px",
              }}>
                {stage.name.toUpperCase()}
              </span>
            )}
            {deal.source !== "manual" && deal.ns_tranid && (
              <span style={{ fontSize: 10, color: C.textSub, fontFamily: C.mono }}>
                {deal.ns_tranid}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} style={btn(C.textMid)}>Close</button>
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, margin: "12px 0" }}>{error}</div>
      )}

      {/* Inactivity. Amber/red here is a fact about a date — the same licence
          the task list's overdue marker has, and not a judgment about health. */}
      {stage?.is_open && daysQuiet !== null && daysQuiet >= 21 && (
        <div style={{
          background: daysQuiet >= 45 ? C.redBg : C.yellowBg,
          border: `1px solid ${daysQuiet >= 45 ? C.redBd : C.yellowBd}`,
          color: daysQuiet >= 45 ? C.red : C.yellow,
          borderRadius: 8, padding: "8px 12px", fontSize: 12, marginTop: 12,
        }}>
          Nothing logged on this deal for <strong>{daysQuiet} days</strong>.
        </div>
      )}
      {stage?.is_open && daysQuiet === null && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, color: C.textMid,
                      borderRadius: 8, padding: "8px 12px", fontSize: 12, marginTop: 12 }}>
          No activity has ever been logged on this deal.
        </div>
      )}

      {/* ── Properties ─────────────────────────────────────────────────── */}
      <div style={{
        display: "grid", gap: 10, marginTop: 14, padding: "12px 14px",
        background: C.alt, border: `1px solid ${C.border}`, borderRadius: 9,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      }}>
        <Prop label="Value">
          <input value={field("projected_total")} inputMode="decimal"
                 onChange={e => set("projected_total", e.target.value.replace(/[^0-9.]/g, ""))}
                 style={{ ...inp, fontFamily: C.mono }} />
        </Prop>

        <Prop label="Stage">
          <select
            value={deal.stage_id ?? ""}
            disabled={saving}
            onChange={e => e.target.value && save({ stageId: e.target.value })}
            style={{ ...inp, cursor: "pointer" }}
          >
            <option value="">—</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Prop>

        <Prop label="Close date">
          <input type="date" value={field("expected_close")}
                 onChange={e => set("expected_close", e.target.value)}
                 style={{ ...inp, fontFamily: C.mono }} />
        </Prop>

        <Prop label="Probability" hint="Overrides the stage's. A stage move re-derives it.">
          <input value={field("probability")} inputMode="numeric"
                 onChange={e => set("probability", e.target.value.replace(/[^0-9]/g, ""))}
                 placeholder={stage?.probability != null ? String(stage.probability) : ""}
                 style={{ ...inp, fontFamily: C.mono }} />
        </Prop>

        <Prop label="Type">
          <input value={field("opportunity_type")} onChange={e => set("opportunity_type", e.target.value)}
                 style={inp} />
        </Prop>

        <Prop label="Owner">
          <input value={field("owner_name")} onChange={e => set("owner_name", e.target.value)}
                 style={inp} />
        </Prop>

        <Prop label="Source">
          <input value={field("lead_source")} onChange={e => set("lead_source", e.target.value)}
                 style={inp} />
        </Prop>

        <Prop label="Weighted">
          <span style={{ fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text }}>
            {deal.projected_total !== null && deal.probability !== null
              ? money(deal.projected_total * (deal.probability / 100))
              : "—"}
          </span>
        </Prop>
      </div>

      <div style={{ marginTop: 9 }}>
        <textarea
          value={field("description")} onChange={e => set("description", e.target.value)}
          placeholder="Notes on the deal — scope, competition, what it hinges on…"
          rows={2}
          style={{ ...inp, width: "100%", resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      {dirty && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 9 }}>
          <button onClick={() => save()} disabled={saving} style={btn(C.blue, true)}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={() => setEdit({})} disabled={saving} style={btn(C.textMid)}>
            Discard
          </button>
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 2, marginTop: 16, borderBottom: `1px solid ${C.border}` }}>
        {(["people", "tasks", "activity"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", cursor: "pointer", fontFamily: C.font,
            padding: "7px 13px", fontSize: 12.5, fontWeight: 600,
            color: tab === t ? C.blue : C.textMid,
            borderBottom: `2px solid ${tab === t ? C.blue : "transparent"}`, marginBottom: -1,
          }}>
            {t === "people" ? `👥 People (${people.length})`
              : t === "tasks" ? `☑ Tasks (${taskCount})`
              : `🕐 Activity (${acts.length})`}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 13 }}>
        {tab === "people" && (
          <>
            {addable.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 11 }}>
                <select value={addId} onChange={e => setAddId(e.target.value)}
                        style={{ ...inp, flex: "1 1 190px", cursor: "pointer" }}>
                  <option value="">Add someone from this account…</option>
                  {addable.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.job_title ? ` — ${c.job_title}` : ""}
                    </option>
                  ))}
                </select>
                <select value={addLabel} onChange={e => setAddLabel(e.target.value)}
                        style={{ ...inp, flex: "0 1 150px", cursor: "pointer" }}>
                  {Object.entries(LABEL_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button
                  disabled={!addId || busy === "add"}
                  onClick={() => { link("POST", { contactId: addId, label: addLabel }, "add"); setAddId(""); }}
                  style={{ ...btn(C.blue, true), opacity: addId ? 1 : 0.5 }}
                >
                  {busy === "add" ? "…" : "Add"}
                </button>
              </div>
            )}

            {people.length === 0 && (
              <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.6, padding: "6px 0" }}>
                {accountContacts.length === 0
                  ? "This account has no contacts yet. Add them on the account's Contacts tab first."
                  : "Nobody is on this deal yet. A deal with no named people is one nobody can chase."}
              </div>
            )}

            <div style={{ display: "grid", gap: 7 }}>
              {people.map(p => {
                const ls = LABEL_STYLE(p.label);
                const c  = p.contact;
                return (
                  <div key={p.contact_id} style={{
                    border: `1px solid ${p.is_primary ? C.blueBd : C.border}`,
                    background: p.is_primary ? C.blueBg : C.surface,
                    borderRadius: 8, padding: "9px 12px",
                    opacity: busy === p.contact_id ? 0.55 : 1,
                  }}>
                    <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>
                        {c?.name ?? "(contact removed)"}
                      </span>
                      {c?.job_title && (
                        <span style={{ fontSize: 12, color: C.textMid }}>{c.job_title}</span>
                      )}
                      {c && !c.is_active && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: C.textSub,
                                       border: `1px solid ${C.border}`, borderRadius: 3,
                                       padding: "1px 5px" }}>DEPARTED</span>
                      )}
                      {c?.email && (
                        <a href={`mailto:${c.email}`} style={{ marginLeft: "auto", fontSize: 12,
                                                               color: C.blue, textDecoration: "none" }}>
                          {c.email}
                        </a>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 7, flexWrap: "wrap" }}>
                      <select
                        value={p.label}
                        disabled={busy === p.contact_id}
                        onChange={e => link("PATCH", { contactId: p.contact_id, label: e.target.value }, p.contact_id)}
                        style={{ padding: "2px 7px", fontSize: 11, fontWeight: 600,
                                 color: ls.fg, background: ls.bg, border: `1px solid ${ls.bd}`,
                                 borderRadius: 5, fontFamily: C.font, cursor: "pointer" }}
                      >
                        {Object.entries(LABEL_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>

                      <button
                        onClick={() => link("PATCH", { contactId: p.contact_id, isPrimary: !p.is_primary }, p.contact_id)}
                        disabled={busy === p.contact_id}
                        style={{ ...mini(p.is_primary ? C.blue : C.textMid), fontWeight: p.is_primary ? 700 : 600 }}
                      >
                        {p.is_primary ? "★ Primary" : "☆ Make primary"}
                      </button>

                      <button
                        onClick={() => link("DELETE", { contactId: p.contact_id }, p.contact_id)}
                        disabled={busy === p.contact_id}
                        style={{ ...mini(C.textSub), marginLeft: "auto" }}
                        title="Removes them from this deal. The contact stays on the account."
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {people.length > 0 && (
              <p style={{ fontSize: 11, color: C.textSub, marginTop: 10, lineHeight: 1.6 }}>
                The label is what someone is <em>to this deal</em> — separate from their role on
                the account, because the account champion is regularly a blocker on one
                particular piece of work.
              </p>
            )}
          </>
        )}

        {tab === "tasks" && (
          <CrmTasks opportunityId={dealId} />
        )}

        {tab === "activity" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <select value={noteKind} onChange={e => setNoteKind(e.target.value as typeof noteKind)}
                      style={{ ...inp, flex: "0 1 110px", cursor: "pointer" }}>
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
              </select>
              <input
                value={note} onChange={e => setNote(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") logNote(); }}
                placeholder="What happened?"
                style={{ ...inp, flex: "1 1 240px" }}
              />
              <button onClick={logNote} disabled={logging || !note.trim()}
                      style={{ ...btn(C.blue, true), opacity: note.trim() ? 1 : 0.5 }}>
                {logging ? "…" : "Log"}
              </button>
            </div>

            {acts.length === 0 && (
              <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.6 }}>
                Nothing logged against this deal yet. Stage moves appear here automatically.
              </div>
            )}

            {acts.map(a => (
              <div key={a.id} style={{ display: "flex", gap: 10, padding: "8px 0",
                                       borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13, width: 18, textAlign: "center", flexShrink: 0,
                               color: a.direction === "inbound" ? C.green : C.textSub }}>
                  {KIND_ICON[a.kind] ?? "·"}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: C.text, fontWeight: 500 }}>
                    {a.subject ?? a.kind}
                  </div>
                  {a.body && a.body !== a.subject && (
                    <div style={{ fontSize: 11.5, color: C.textMid, marginTop: 2, lineHeight: 1.5 }}>
                      {a.body.replace(/\s+/g, " ").slice(0, 240)}
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: C.textSub, marginTop: 3, fontFamily: C.mono }}>
                    {new Date(a.occurred_at).toLocaleString()}
                    {a.actor_name || a.actor_email ? ` · ${a.actor_name ?? a.actor_email}` : ""}
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

function Prop({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 3 }} title={hint}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5,
                     color: C.textSub, textTransform: "uppercase" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const shell: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11,
  boxShadow: C.shMd, padding: "15px 18px",
};
const inp: React.CSSProperties = {
  padding: "5px 9px", fontSize: 12.5, fontFamily: C.font,
  border: `1px solid ${C.mid}`, borderRadius: 6, background: C.surface, color: C.text,
  width: "100%", boxSizing: "border-box",
};
const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font, whiteSpace: "nowrap",
});
const mini = (color: string): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.border}`, color,
  borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
