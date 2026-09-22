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
      </div>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12 }}>{error}</div>
      )}

      {contacts.length > 0 && withRole === 0 && (
        <div style={{ background: C.alt, border: `1px solid ${C.border}`, color: C.textMid,
                      borderRadius: 8, padding: "9px 13px", fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          No roles are set yet. NetSuite&apos;s own contact role is populated on 26 of 1,014
          contacts with values whose labels cannot be read, so nothing was imported. Marking
          the <strong>economic buyer</strong> and the <strong>champion</strong> on your main
          accounts is the single highest-value thing you can do here — a champion going quiet
          is one of the strongest churn signals there is, and it cannot be detected without it.
        </div>
      )}

      {!loading && contacts.length === 0 && (
        <div style={{ padding: "30px 0", textAlign: "center", color: C.textSub, fontSize: 13, lineHeight: 1.7 }}>
          {q ? `Nothing matches “${q}”.` : "No contacts yet — run Sync from NetSuite."}
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
                  onClick={() => patch(c.id, { isActive: false })}
                  disabled={busy === c.id}
                  style={mini(C.textSub)}
                  title="Records that they have left. This is what the champion-silence rule reads."
                >
                  Mark departed
                </button>

                {c.source === "netsuite" && (
                  <span style={{ marginLeft: "auto", fontSize: 10, color: C.textSub, fontFamily: C.mono }}>
                    from NetSuite
                  </span>
                )}
              </div>

              {c.notes && (
                <div style={{ fontSize: 12, color: C.textMid, marginTop: 6 }}>{c.notes}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
