"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { C } from "@/lib/constants";
import { useStaff } from "@/lib/use-staff";
import {
  currentQuarter, quarterList, hcStatus, lastCompleted, daysSinceLastCheck,
  healthCheckDue, CADENCE_LABEL, HC_STATUS_STYLE, fmtHcDate, type HCStatus,
} from "@/lib/healthchecks";
import type { Healthcheck } from "@/app/api/healthchecks/route";

// ─── Health checks for one customer ──────────────────────────────────────────
//
// The quarterly customer call: whether it is booked, whether it happened, and
// what was said. The portfolio grid in the Customers area answers "who is
// missing one"; this answers "what is the story on THIS account", which is the
// question you have when you are already looking at them.
//
// ⚠ NOT BEHIND cs_layer, deliberately. `healthchecks` is call scheduling, not
// the CS health score — see lib/healthchecks.ts. A PM or consultant books and
// runs these calls, so hiding the tab from them would hide their own work.
//
// ⚠ COMPLETING A CHECK WRITES THE CUSTOMER'S TIMELINE. The PUT on
// /api/healthchecks/[id] inserts a `call` activity carrying the topics and
// notes, once, on the transition to completed. So what is typed here is what
// the Activity tab shows later — worth knowing before writing "n/a" in it.

export default function CustomerHealthChecks({
  customerNsId, customerName,
  annualValue, daysToNotice,
}: {
  customerNsId: string; customerName: string;
  /** Drives the cadence. Absent is fine — it falls back to annual and says so. */
  annualValue?: number | null;
  daysToNotice?: number | null;
}) {
  const [rows, setRows]       = useState<Healthcheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState<string | null>(null);
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // Consultants and PMs — the people who actually run these calls.
  const staff = useStaff("consultants");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/healthchecks?customerNsId=${encodeURIComponent(customerNsId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      setRows(json.healthchecks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  }, [customerNsId]);

  useEffect(() => { load(); }, [load]);

  const cq = currentQuarter();
  const thisQuarter = hcStatus(customerNsId, cq, rows);
  const last  = lastCompleted(customerNsId, rows);
  const since = daysSinceLastCheck(customerNsId, rows);
  const due   = healthCheckDue(customerNsId, rows, { annualValue, daysToNotice });

  // Newest quarter first, and within a quarter the most recently touched.
  const sorted = useMemo(() => [...rows].sort((a, b) =>
    b.quarter.localeCompare(a.quarter) || (b.updated_at ?? "").localeCompare(a.updated_at ?? "")
  ), [rows]);

  async function save(url: string, method: string, body: unknown, id: string) {
    setBusy(id); setError(null);
    try {
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
      // The PUT reports a timeline write that failed separately from the save
      // itself — the check IS recorded, so this is a warning, not an error.
      if (json.logWarning) setError(json.logWarning);
      setAdding(false); setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setBusy(null); }
  }

  const remove = async (id: string) => {
    if (!confirm("Delete this health check? The timeline entry, if one was written, stays.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/healthchecks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Delete failed");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(null); }
  };

  return (
    <div>
      {/* ── Where this account stands ──────────────────────────────────── */}
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
                    padding: "11px 14px", background: C.alt, border: `1px solid ${C.border}`,
                    borderRadius: 8, marginBottom: 14 }}>
        <Stat label={cq}>
          <Badge status={thisQuarter} />
        </Stat>
        <Stat label="Last completed">
          <span style={{ fontSize: 12.5, color: C.text }}>
            {last ? `${fmtHcDate(last.completed_at ?? last.updated_at)}` : "Never"}
            {since !== null && (
              <span style={{ color: C.textSub, fontFamily: C.mono, fontSize: 11 }}> · {since}d ago</span>
            )}
          </span>
        </Stat>
        <Stat label="On record">
          <span style={{ fontSize: 12.5, fontFamily: C.mono, color: C.text }}>
            {rows.length}
          </span>
        </Stat>
        {/* A status is not a deadline. This is the half the tab was missing:
            when the next one is owed, and on what grounds. */}
        <Stat label="Next due">
          <span style={{ fontSize: 12.5,
                         color: due.neverHeld || (due.daysUntil ?? 0) < 0 ? C.yellow : C.text }}>
            {due.neverHeld
              ? "Now — never held"
              : (due.daysUntil ?? 0) < 0
                ? `${Math.abs(due.daysUntil ?? 0)}d overdue`
                : `${fmtHcDate(due.dueDate)}`}
            <span style={{ color: C.textSub, fontSize: 11 }}>
              {" · "}{CADENCE_LABEL[due.cadence].toLowerCase()}
            </span>
          </span>
          <div style={{ fontSize: 10.5, color: C.textSub, marginTop: 2 }}>{due.reason}</div>
        </Stat>
        <button onClick={() => { setAdding(true); setEditing(null); }}
                style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#fff",
                         background: C.blue, border: "none", borderRadius: 6,
                         padding: "6px 13px", cursor: "pointer", fontFamily: C.font }}>
          ＋ Schedule a check
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: C.yellow, background: C.yellowBg,
                      border: `1px solid ${C.yellowBd}`, borderRadius: 6,
                      padding: "8px 10px", marginBottom: 12, lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {adding && (
        <Editor
          customerNsId={customerNsId} customerName={customerName}
          staff={staff} busy={busy === "new"}
          onCancel={() => setAdding(false)}
          onSave={body => save("/api/healthchecks", "POST", body, "new")}
        />
      )}

      {loading && <div style={{ fontSize: 12, color: C.textSub }}>Loading…</div>}

      {!loading && sorted.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.6 }}>
          No health check has been recorded for {customerName}. That is not the same as
          none having happened — only what was booked or logged here appears.
        </div>
      )}

      {sorted.map(h => {
        const st = hcStatus(customerNsId, h.quarter, [h]);
        return editing === h.id ? (
          <Editor
            key={h.id} existing={h}
            customerNsId={customerNsId} customerName={customerName}
            staff={staff} busy={busy === h.id}
            onCancel={() => setEditing(null)}
            onSave={body => save(`/api/healthchecks/${h.id}`, "PUT", body, h.id)}
          />
        ) : (
          <div key={h.id} style={{ display: "flex", gap: 12, alignItems: "flex-start",
                                   padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ width: 86, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{h.quarter}</div>
              <Badge status={st} small />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.textMid }}>
                {h.status === "completed"
                  ? `Held ${fmtHcDate(h.completed_at ?? h.scheduled_date)}`
                  : h.scheduled_date ? `Booked for ${fmtHcDate(h.scheduled_date)}` : "No date set"}
                {h.consultant_name ? ` · ${h.consultant_name}` : ""}
              </div>
              {h.topics && (
                <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}>
                  <span style={{ color: C.textSub }}>Topics: </span>{h.topics}
                </div>
              )}
              {h.notes && (
                <div style={{ fontSize: 12, color: C.textMid, marginTop: 3, lineHeight: 1.5 }}>
                  {h.notes}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {h.status !== "completed" && (
                <button
                  disabled={busy === h.id}
                  onClick={() => save(`/api/healthchecks/${h.id}`, "PUT", { status: "completed" }, h.id)}
                  style={mini(C.green)}>
                  {busy === h.id ? "…" : "Mark held"}
                </button>
              )}
              <button onClick={() => { setEditing(h.id); setAdding(false); }} style={mini(C.blue)}>
                Edit
              </button>
              <button onClick={() => remove(h.id)} style={mini(C.textSub)}>Delete</button>
            </div>
          </div>
        );
      })}

      <p style={{ fontSize: 11, color: C.textSub, marginTop: 12, lineHeight: 1.6 }}>
        Marking a check held adds a <strong>call</strong> entry to this customer&apos;s Activity tab,
        carrying the topics and notes — so what you write here is what shows up there later.
        It is written once, on the transition; re-saving a completed check does not duplicate it.
      </p>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: C.textSub,
                    textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

function Badge({ status, small }: { status: HCStatus; small?: boolean }) {
  const s = HC_STATUS_STYLE[status];
  return (
    <span style={{ fontSize: small ? 9.5 : 11, fontWeight: 700, color: s.color,
                   background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 4,
                   padding: small ? "1px 5px" : "2px 8px", display: "inline-block",
                   marginTop: small ? 3 : 0, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

const mini = (color: string): React.CSSProperties => ({
  fontSize: 11, fontWeight: 600, color, background: "transparent",
  border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px",
  cursor: "pointer", fontFamily: C.font, whiteSpace: "nowrap",
});

const inp: React.CSSProperties = {
  padding: "5px 9px", fontSize: 12, fontFamily: C.font,
  border: `1px solid ${C.mid}`, borderRadius: 6, background: C.surface, color: C.text,
};

function Editor({
  existing, customerNsId, customerName, staff, busy, onCancel, onSave,
}: {
  existing?: Healthcheck;
  customerNsId: string; customerName: string;
  staff: { id: number; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [quarter, setQuarter] = useState(existing?.quarter ?? currentQuarter());
  const [date, setDate]       = useState(existing?.scheduled_date ?? "");
  const [who, setWho]         = useState(existing?.consultant_ns_id ? String(existing.consultant_ns_id) : "");
  const [topics, setTopics]   = useState(existing?.topics ?? "");
  const [notes, setNotes]     = useState(existing?.notes ?? "");

  // A quarter already gone still has to be selectable when editing a past
  // check, or opening an old row would silently move it to this quarter.
  const quarters = useMemo(() => {
    const list = quarterList();
    return existing && !list.includes(existing.quarter) ? [existing.quarter, ...list] : list;
  }, [existing]);

  const submit = () => {
    const person = staff.find(s => String(s.id) === who);
    onSave({
      customer_ns_id: customerNsId,
      customer_name:  customerName,
      quarter,
      scheduled_date: date || null,
      consultant_ns_id: person?.id ?? null,
      consultant_name:  person?.name ?? null,
      topics: topics.trim() || null,
      notes:  notes.trim()  || null,
    });
  };

  return (
    <div style={{ border: `1px solid ${C.blueBd}`, background: C.blueBg, borderRadius: 8,
                  padding: 12, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={quarter} onChange={e => setQuarter(e.target.value)} style={inp}>
          {quarters.map(q => <option key={q} value={q}>{q}</option>)}
        </select>
        <input type="date" value={date ?? ""} onChange={e => setDate(e.target.value)} style={inp} />
        <select value={who} onChange={e => setWho(e.target.value)} style={{ ...inp, minWidth: 170 }}>
          <option value="">Unassigned</option>
          {staff.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </select>
      </div>
      <input value={topics} onChange={e => setTopics(e.target.value)}
             placeholder="Topics to cover — or what was covered"
             style={{ ...inp, width: "100%" }} />
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Notes. These appear on the Activity tab once the check is marked held."
                style={{ ...inp, width: "100%", resize: "vertical" }} />
      <div style={{ display: "flex", gap: 7 }}>
        <button onClick={submit} disabled={busy}
                style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: C.blue,
                         border: "none", borderRadius: 6, padding: "6px 14px",
                         cursor: "pointer", fontFamily: C.font, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : existing ? "Save" : "Schedule"}
        </button>
        <button onClick={onCancel} style={mini(C.textSub)}>Cancel</button>
      </div>
    </div>
  );
}
