"use client";
import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/constants";

// ─── Contacts ───────────────────────────────────────────────────────────────
//
// ⚠ ROLE IS THE FIELD WORTH FILLING IN, AND IT ARRIVES EMPTY ON PURPOSE.
//
// NetSuite's own contactrole is set on 26 of 1,014 contacts, and its values are
// built-in negative ids whose labels cannot be resolved through SuiteQL at all,
// so nothing was imported. Marking the economic buyer and the champion by hand
// is what makes this column worth having — a champion going quiet is one of the
// strongest churn signals available and is invisible without it.
//
// Hence the role selector sits on every row rather than behind an edit screen,
// and unassigned roles are visibly unassigned rather than quietly defaulted.

interface Contact {
  id: string; ns_contact_id: string | null; customer_ns_id: string;
  name: string; email: string | null; job_title: string | null;
  phone: string | null; mobile: string | null;
  role: string; is_primary: boolean; is_active: boolean;
  last_seen_at: string | null; notes: string | null; source: string;
  suggested_role: string | null; suggested_role_reason: string | null;
  opted_out: boolean | null; opt_out_reason: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  economic_buyer: "Economic buyer",
  champion:       "Champion",
  admin:          "Admin",
  end_user:       "End user",
  technical:      "Technical",
  unknown:        "Not set",
};

// Blue for the two roles that carry commercial weight, neutral for the rest.
// Not RAG — these are categories, not health.
const ROLE_STYLE = (role: string) =>
  role === "economic_buyer" || role === "champion"
    ? { fg: C.blue, bg: C.blueBg, bd: C.blueBd }
    : role === "unknown"
      ? { fg: C.textSub, bg: "transparent", bd: C.border }
      : { fg: C.textMid, bg: C.alt, bd: C.border };

export default function CrmContacts({ customerNsId }: { customerNsId?: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // Adding a person. Only offered when scoped to an account, because a contact
  // has to belong to one — the unscoped list spans every account and has no
  // answer to "which". POST /api/crm/contacts existed from the start with no
  // caller at all, so until now the only contacts in the system were the ones
  // imported from NetSuite before that link was cut.
  // Editing an existing person. PATCH has always accepted name, email, title,
  // phone, mobile and notes; the UI only ever sent role/primary/departed, so a
  // typo in a name or a changed email could not be corrected at all.
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ name: "", jobTitle: "", email: "", phone: "", mobile: "", notes: "" });

  function startEdit(c: Contact) {
    setEditId(c.id);
    setEf({
      name: c.name, jobTitle: c.job_title ?? "", email: c.email ?? "",
      phone: c.phone ?? "", mobile: c.mobile ?? "", notes: c.notes ?? "",
    });
  }

  // Role suggestions. These write `suggested_role`, never `role` — only a
  // person accepting one sets the field that decides who may be emailed.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  async function suggestRoles() {
    if (!customerNsId) return;
    setSuggesting(true); setError(null); setSuggestNote(null);
    try {
      const res = await fetch("/api/crm/contacts/suggest-roles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerNsId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.hint ? `${json.error} ${json.hint}` : json?.error);
      const bits: string[] = [];
      if (json.written) bits.push(`${json.written} suggested`);
      // Said plainly: a short list should look short because the titles were
      // thin, not because the model underperformed.
      if (json.noTitle) bits.push(`${json.noTitle} skipped for having no job title`);
      if (json.dropped) bits.push(`${json.dropped} discarded as unusable`);
      setSuggestNote(json.note ?? (bits.length ? bits.join(" · ") : "Nothing to suggest."));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setSuggesting(false); }
  }

  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    name: "", email: "", jobTitle: "", phone: "", role: "unknown",
  });

  async function create() {
    if (!draft.name.trim() || !customerNsId) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, customerNsId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setDraft({ name: "", email: "", jobTitle: "", phone: "", role: "unknown" });
      setAdding(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setSaving(false); }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (customerNsId) params.set("customerNsId", customerNsId);
      if (q.trim())     params.set("q", q.trim());
      const res  = await fetch(`/api/crm/contacts?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setContacts(json.contacts ?? []);
      setRoles(json.roles ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setLoading(false); }
  }, [customerNsId, q]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id); setError(null);
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setContacts(cs => cs.map(c => c.id === id ? json.contact : c));
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  }

  const withRole = contacts.filter(c => c.role !== "unknown").length;
  // The suggester can only work from a job title, and titles are scarce:
  // 68 of 949 active NetSuite contacts have one, 14 of 458 on closed-won
  // accounts (measured September 2026). Showing the number BEFORE the button is
  // clicked stops it looking broken when it labels two people out of thirty.
  const unroled   = contacts.filter(c => c.role === "unknown" && !c.suggested_role);
  const suggestable = unroled.filter(c => String(c.job_title ?? "").trim()).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search name, email or title…"
          style={{ flex: "1 1 240px", maxWidth: 320, padding: "6px 11px", fontSize: 13,
                   border: `1px solid ${C.mid}`, borderRadius: 6, fontFamily: C.font }}
        />
        <span style={{ fontSize: 12, color: C.textSub }}>
          {contacts.length} contact{contacts.length === 1 ? "" : "s"}
          {contacts.length > 0 && ` · ${withRole} with a role set`}
        </span>
        <button onClick={load} disabled={loading} style={btn(C.blue, true)}>
          {loading ? "…" : "↻"}
        </button>
        {customerNsId && (
          <button onClick={() => setAdding(a => !a)} style={btn(C.blue, !adding)}>
            {adding ? "Cancel" : "+ Add contact"}
          </button>
        )}
        {customerNsId && unroled.length > 0 && (
          <button
            onClick={suggestRoles}
            disabled={suggesting || suggestable === 0}
            style={{ ...btn(C.purple), opacity: suggestable === 0 ? 0.45 : 1 }}
            title={suggestable === 0
              ? "A role is inferred from the job title, and none of these contacts has one."
              : `${suggestable} of ${unroled.length} unroled contacts have a job title to work from.`}
          >
            {suggesting ? "Reading titles…" : `⚡ Suggest roles (${suggestable})`}
          </button>
        )}
      </div>

      {suggestNote && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, color: C.textMid,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12,
                      lineHeight: 1.6 }}>
          {suggestNote}
        </div>
      )}

      {adding && customerNsId && (
        <div style={{ border: `1px solid ${C.blueBd}`, background: C.blueBg, borderRadius: 8,
                      padding: "11px 13px", marginBottom: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                   placeholder="Full name" autoFocus style={{ ...fld, flex: "1 1 170px" }} />
            <input value={draft.jobTitle} onChange={e => setDraft({ ...draft, jobTitle: e.target.value })}
                   placeholder="Job title" style={{ ...fld, flex: "1 1 170px" }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })}
                   placeholder="Email" type="email" style={{ ...fld, flex: "1 1 190px" }} />
            <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })}
                   placeholder="Phone" style={{ ...fld, flex: "1 1 130px", fontFamily: C.mono }} />
            <select value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })}
                    style={{ ...fld, flex: "1 1 140px", cursor: "pointer" }}>
              {(roles.length ? roles : ["unknown"]).map(r => (
                <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
              ))}
            </select>
            <button onClick={create} disabled={saving || !draft.name.trim()}
                    style={{ ...btn(C.blue, true), opacity: draft.name.trim() ? 1 : 0.5 }}>
              {saving ? "Saving…" : "Create"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12 }}>{error}</div>
      )}

      {contacts.length > 0 && withRole === 0 && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, color: C.textMid,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          No roles are set yet, and they mostly have to be set by hand.
          NetSuite&apos;s own contact role is populated on 22 of 949 contacts with values whose
          labels cannot be resolved at all, and <strong>job titles — the only thing a role can
          be inferred from — exist on 68</strong>. So <em>⚡ Suggest roles</em> helps where there
          is a title and declines where there is not.
          <br /><br />
          Marking the <strong>economic buyer</strong> and the <strong>champion</strong> on your
          main accounts is still the single highest-value thing you can do here: a champion
          going quiet is one of the strongest churn signals there is, and it is invisible
          without this field. It is also what decides who the CSM agent may write to.
        </div>
      )}

      {!loading && contacts.length === 0 && (
        <div style={{ padding: "30px 0", textAlign: "center", color: C.textSub, fontSize: 13, lineHeight: 1.7 }}>
          {q ? `Nothing matches “”.` : "No contacts on this account yet."}
        </div>
      )}

      <div style={{ display: "grid", gap: 7 }}>
        {contacts.map(c => {
          const rs = ROLE_STYLE(c.role);
          return (
            <div key={c.id} style={{
              border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface,
              padding: "10px 13px", opacity: busy === c.id ? 0.6 : 1,
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{c.name}</span>
                {c.is_primary && (
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: C.purple,
                                 background: C.purpleBg, border: `1px solid ${C.purpleBd}`,
                                 borderRadius: 3, padding: "1px 5px" }}>PRIMARY</span>
                )}
                {c.job_title && (
                  <span style={{ fontSize: 12, color: C.textMid }}>{c.job_title}</span>
                )}
                <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  {c.email && (
                    <a href={`mailto:${c.email}`} style={{ fontSize: 12, color: C.blue, textDecoration: "none" }}>
                      {c.email}
                    </a>
                  )}
                  {(c.phone || c.mobile) && (
                    <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub }}>
                      {c.mobile ?? c.phone}
                    </span>
                  )}
                </span>
              </div>

              {/* A suggestion is visibly a suggestion. It sits above the role
                  selector rather than inside it, so nothing about the screen
                  implies the role has been set. */}
              {c.suggested_role && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
                              marginTop: 8, padding: "7px 11px", borderRadius: 7,
                              background: C.purpleBg, border: `1px solid ${C.purpleBd}` }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: C.purple }}>
                    SUGGESTED
                  </span>
                  <strong style={{ fontSize: 12.5, color: C.text }}>
                    {ROLE_LABEL[c.suggested_role] ?? c.suggested_role}
                  </strong>
                  {c.suggested_role_reason && (
                    <span style={{ fontSize: 11.5, color: C.textMid }}>{c.suggested_role_reason}</span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button onClick={() => patch(c.id, { acceptSuggestion: true })}
                            disabled={busy === c.id} style={mini(C.green)}>
                      ✓ Accept
                    </button>
                    <button onClick={() => patch(c.id, { rejectSuggestion: true })}
                            disabled={busy === c.id} style={mini(C.textSub)}>
                      Not right
                    </button>
                  </span>
                </div>
              )}

              {c.opted_out && (
                <div style={{ marginTop: 8, padding: "6px 11px", borderRadius: 7,
                              background: C.redBg, border: `1px solid ${C.redBd}`,
                              color: C.red, fontSize: 11.5, lineHeight: 1.5 }}>
                  <strong>Opted out.</strong> Nothing will be sent to this person.
                  {c.opt_out_reason ? ` ${c.opt_out_reason}` : ""}
                </div>
              )}

              <div style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 7, flexWrap: "wrap" }}>
                <select
                  value={c.role}
                  disabled={busy === c.id}
                  onChange={e => patch(c.id, { role: e.target.value })}
                  style={{ padding: "2px 7px", fontSize: 11, fontWeight: 600,
                           color: rs.fg, background: rs.bg, border: `1px solid ${rs.bd}`,
                           borderRadius: 5, fontFamily: C.font, cursor: "pointer" }}
                >
                  {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
                </select>

                <button
                  onClick={() => patch(c.id, { isPrimary: !c.is_primary })}
                  disabled={busy === c.id}
                  style={{ ...mini(C.textMid), opacity: c.is_primary ? 1 : 0.7 }}
                >
                  {c.is_primary ? "Unset primary" : "Make primary"}
                </button>

                <button
                  onClick={() => editId === c.id ? setEditId(null) : startEdit(c)}
                  disabled={busy === c.id}
                  style={mini(editId === c.id ? C.blue : C.textMid)}
                >
                  {editId === c.id ? "Cancel" : "Edit"}
                </button>

                <button
                  onClick={() => {
                    if (c.opted_out) { patch(c.id, { optedOut: false }); return; }
                    const reason = window.prompt(
                      "Record that this person has asked not to be contacted.\n\n"
                      + "What did they say? (optional)");
                    // null = cancelled. An empty string is a deliberate "no reason
                    // given" and still opts them out.
                    if (reason === null) return;
                    patch(c.id, { optedOut: true, optOutReason: reason });
                  }}
                  disabled={busy === c.id}
                  style={mini(c.opted_out ? C.red : C.textSub)}
                  title="Permanent. Suppression blocks every send to an opted-out contact."
                >
                  {c.opted_out ? "Opted out" : "Opt out"}
                </button>

                <button
                  onClick={() => patch(c.id, { isActive: !c.is_active })}
                  disabled={busy === c.id}
                  style={mini(C.textSub)}
                  title="Records that they have left. This is what the champion-silence rule reads."
                >
                  {c.is_active ? "Mark departed" : "Mark returned"}
                </button>

                {c.source === "netsuite" && (
                  <span style={{ marginLeft: "auto", fontSize: 10, color: C.textSub, fontFamily: C.mono }}>
                    from NetSuite
                  </span>
                )}
              </div>

              {editId === c.id && (
                <div style={{ display: "grid", gap: 7, marginTop: 9, paddingTop: 9,
                              borderTop: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <input value={ef.name} onChange={e => setEf({ ...ef, name: e.target.value })}
                           placeholder="Full name" style={{ ...fld, flex: "1 1 160px" }} />
                    <input value={ef.jobTitle} onChange={e => setEf({ ...ef, jobTitle: e.target.value })}
                           placeholder="Job title" style={{ ...fld, flex: "1 1 160px" }} />
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <input value={ef.email} onChange={e => setEf({ ...ef, email: e.target.value })}
                           placeholder="Email" type="email" style={{ ...fld, flex: "1 1 180px" }} />
                    <input value={ef.phone} onChange={e => setEf({ ...ef, phone: e.target.value })}
                           placeholder="Phone" style={{ ...fld, flex: "1 1 120px", fontFamily: C.mono }} />
                    <input value={ef.mobile} onChange={e => setEf({ ...ef, mobile: e.target.value })}
                           placeholder="Mobile" style={{ ...fld, flex: "1 1 120px", fontFamily: C.mono }} />
                  </div>
                  <textarea value={ef.notes} onChange={e => setEf({ ...ef, notes: e.target.value })}
                            placeholder="Notes on this person" rows={2}
                            style={{ ...fld, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
                  <div>
                    <button
                      onClick={async () => { await patch(c.id, ef); setEditId(null); }}
                      disabled={busy === c.id || !ef.name.trim()}
                      style={{ ...btn(C.blue, true), opacity: ef.name.trim() ? 1 : 0.5 }}
                    >
                      {busy === c.id ? "Saving\u2026" : "Save"}
                    </button>
                  </div>
                </div>
              )}

              {c.notes && editId !== c.id && (
                <div style={{ fontSize: 12, color: C.textMid, marginTop: 6 }}>{c.notes}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const fld: React.CSSProperties = {
  padding: "6px 10px", fontSize: 12.5, fontFamily: C.font,
  border: `1px solid ${C.mid}`, borderRadius: 6, background: C.surface, color: C.text,
};
const btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? C.blueBg : "transparent",
  border: `1px solid ${filled ? C.blueBd : C.border}`,
  color, borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
const mini = (color: string): React.CSSProperties => ({
  background: "transparent", border: `1px solid ${C.border}`, color,
  borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 600,
  cursor: "pointer", fontFamily: C.font,
});
