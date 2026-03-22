"use client";
import { useState, useEffect, useMemo } from "react";
import { C } from "@/lib/constants";
import { EMPLOYEES } from "@/lib/constants";
import type { NSCustomer } from "@/app/api/customers/route";
import type { Healthcheck } from "@/app/api/healthchecks/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentQuarter(): string {
  const d = new Date();
  return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
}

function quarterList(): string[] {
  const d = new Date();
  const cur = Math.ceil((d.getMonth() + 1) / 3);
  const yr  = d.getFullYear();
  const qs: string[] = [];
  for (let i = 0; i < 8; i++) {
    let q = cur + i, y = yr;
    if (q > 4) { q -= 4; y += 1; }
    qs.push(`Q${q} ${y}`);
  }
  return qs;
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

type HCStatus = "completed" | "scheduled" | "overdue" | "unscheduled";

function getStatus(customerId: number, quarter: string, hcs: Healthcheck[]): HCStatus {
  const mine = hcs.filter(h => h.customer_ns_id === String(customerId) && h.quarter === quarter);
  if (mine.some(h => h.status === "completed")) return "completed";
  const sched = mine.find(h => h.status === "scheduled");
  if (sched) {
    if (sched.scheduled_date && new Date(sched.scheduled_date) < new Date()) return "overdue";
    return "scheduled";
  }
  return "unscheduled";
}

function lastHealthcheck(customerId: number, hcs: Healthcheck[]): Healthcheck | null {
  const mine = hcs
    .filter(h => h.customer_ns_id === String(customerId) && h.status === "completed")
    .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at));
  return mine[0] ?? null;
}

const STATUS_STYLE: Record<HCStatus, { label: string; bg: string; color: string; bd: string }> = {
  completed:   { label: "✅ Completed",     bg: C.greenBg,  color: C.green,  bd: C.greenBd },
  scheduled:   { label: "📅 Scheduled",     bg: C.blueBg,   color: C.blue,   bd: C.blueBd  },
  overdue:     { label: "⚠ Overdue",        bg: C.redBg,    color: C.red,    bd: C.redBd   },
  unscheduled: { label: "❌ Not Scheduled", bg: C.yellowBg, color: C.yellow, bd: C.yellowBd },
};

// ─── Schedule / Complete Modal ────────────────────────────────────────────────

interface ModalProps {
  customer: NSCustomer;
  existing: Healthcheck | null;
  onClose: () => void;
  onSaved: () => void;
}

function HealthcheckModal({ customer, existing, onClose, onSaved }: ModalProps) {
  const cq = currentQuarter();
  const [quarter, setQuarter]           = useState(existing?.quarter ?? cq);
  const [date, setDate]                 = useState(existing?.scheduled_date ?? "");
  const [consultantId, setConsultantId] = useState<string>(String(existing?.consultant_ns_id ?? ""));
  const [topics, setTopics]             = useState(existing?.topics ?? "");
  const [notes, setNotes]               = useState(existing?.notes ?? "");
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const payload = {
        customer_ns_id:   String(customer.id),
        customer_name:    customer.companyname,
        quarter,
        scheduled_date:   date || null,
        consultant_ns_id: consultantId ? parseInt(consultantId) : null,
        consultant_name:  consultantId ? EMPLOYEES[parseInt(consultantId)] ?? null : null,
        topics:  topics || null,
        notes:   notes  || null,
      };
      const url    = existing ? `/api/healthchecks/${existing.id}` : "/api/healthchecks";
      const method = existing ? "PUT" : "POST";
      const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function markComplete() {
    if (!existing) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/healthchecks/${existing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      onSaved(); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = {
    width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 13, fontFamily: C.font, color: C.text, background: C.surface, outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.surface, borderRadius: 14, padding: "28px 32px", width: 520, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.18)", fontFamily: C.font }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: C.text, marginBottom: 4 }}>
          {existing ? "Edit Health Check" : "Schedule Health Check"}
        </div>
        <div style={{ fontSize: 13, color: C.textSub, marginBottom: 22 }}>{customer.companyname}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Quarter</label>
            <select value={quarter} onChange={e => setQuarter(e.target.value)} style={inp}>
              {quarterList().map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Scheduled Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Consultant</label>
          <select value={consultantId} onChange={e => setConsultantId(e.target.value)} style={inp}>
            <option value="">— Unassigned —</option>
            {Object.entries(EMPLOYEES).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Topics / Agenda</label>
          <textarea
            value={topics} onChange={e => setTopics(e.target.value)}
            placeholder="e.g. New automation features, SuiteAnalytics updates, ARM enhancements…"
            rows={3} style={{ ...inp, resize: "vertical" }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} />
        </div>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "8px 12px", color: C.red, fontSize: 12, marginBottom: 14 }}>⚠ {error}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {existing && existing.status !== "completed" && (
            <button onClick={markComplete} disabled={saving}
              style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: C.greenBg, color: C.green, border: `1px solid ${C.greenBd}`, fontFamily: C.font }}>
              ✅ Mark Complete
            </button>
          )}
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font }}>
            {saving ? "Saving…" : existing ? "Update" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── History Modal ────────────────────────────────────────────────────────────

function HistoryModal({ customer, hcs, onClose }: { customer: NSCustomer; hcs: Healthcheck[]; onClose: () => void }) {
  const mine = hcs
    .filter(h => h.customer_ns_id === String(customer.id))
    .sort((a, b) => b.quarter.localeCompare(a.quarter));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.surface, borderRadius: 14, padding: "28px 32px", width: 560, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.18)", fontFamily: C.font, maxHeight: "80vh", overflow: "auto" }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: C.text, marginBottom: 4 }}>Health Check History</div>
        <div style={{ fontSize: 13, color: C.textSub, marginBottom: 20 }}>{customer.companyname}</div>

        {mine.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.textSub, fontSize: 14 }}>No health checks recorded yet.</div>
        ) : (
          mine.map(h => {
            const st = STATUS_STYLE[h.status as HCStatus] ?? STATUS_STYLE.unscheduled;
            return (
              <div key={h.id} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 14, marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{h.quarter}</div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: st.bg, color: st.color, border: `1px solid ${st.bd}` }}>{st.label}</span>
                </div>
                {h.scheduled_date && <div style={{ fontSize: 12, color: C.textSub, marginBottom: 3 }}>📅 {fmtDate(h.scheduled_date)}{h.consultant_name ? ` · ${h.consultant_name}` : ""}</div>}
                {h.topics && <div style={{ fontSize: 12, color: C.textMid, marginBottom: 3 }}>Topics: {h.topics}</div>}
                {h.notes  && <div style={{ fontSize: 12, color: C.textSub }}>{h.notes}</div>}
              </div>
            );
          })
        )}

        <div style={{ textAlign: "right", marginTop: 8 }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function CustomersView() {
  const [customers, setCustomers]     = useState<NSCustomer[]>([]);
  const [healthchecks, setHealthchecks] = useState<Healthcheck[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState("");
  const [filterStatus, setFilterStatus] = useState<HCStatus | "all">("all");
  const [scheduleFor, setScheduleFor] = useState<NSCustomer | null>(null);
  const [editHc, setEditHc]           = useState<Healthcheck | null>(null);
  const [historyFor, setHistoryFor]   = useState<NSCustomer | null>(null);
  const [monitorOpen, setMonitorOpen] = useState(true);

  const cq = currentQuarter();

  async function load() {
    setLoading(true); setError(null);
    try {
      const [cRes, hRes] = await Promise.all([fetch("/api/customers"), fetch("/api/healthchecks")]);
      const [cData, hData] = await Promise.all([cRes.json(), hRes.json()]);
      if (cData.error) throw new Error(cData.error);
      setCustomers(cData.customers ?? []);
      setHealthchecks(hData.healthchecks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let completed = 0, scheduled = 0, overdue = 0, unscheduled = 0;
    for (const c of customers) {
      const s = getStatus(c.id, cq, healthchecks);
      if (s === "completed")   completed++;
      else if (s === "scheduled")   scheduled++;
      else if (s === "overdue")     overdue++;
      else                          unscheduled++;
    }
    return { completed, scheduled, overdue, unscheduled };
  }, [customers, healthchecks, cq]);

  // ── Proactive monitor: needs action ────────────────────────────────────────
  const needsAction = useMemo(() => {
    return customers
      .map(c => ({ c, status: getStatus(c.id, cq, healthchecks), last: lastHealthcheck(c.id, healthchecks) }))
      .filter(({ status }) => status === "overdue" || status === "unscheduled")
      .sort((a, b) => {
        if (a.status === "overdue" && b.status !== "overdue") return -1;
        if (b.status === "overdue" && a.status !== "overdue") return 1;
        const aDate = a.last?.completed_at ?? "0000";
        const bDate = b.last?.completed_at ?? "0000";
        return aDate.localeCompare(bDate); // oldest last check first
      });
  }, [customers, healthchecks, cq]);

  // ── Filtered customer list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return customers.filter(c => {
      if (search && !c.companyname.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus !== "all" && getStatus(c.id, cq, healthchecks) !== filterStatus) return false;
      return true;
    });
  }, [customers, healthchecks, search, filterStatus, cq]);

  if (loading) return (
    <div style={{ padding: "60px 24px", textAlign: "center", color: C.textSub, fontFamily: C.font }}>
      <div style={{ fontSize: 22, marginBottom: 10 }}>⏳</div>Loading customers…
    </div>
  );

  if (error) return (
    <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: "14px 18px", color: C.red, fontSize: 13, fontFamily: C.font }}>⚠ {error}</div>
  );

  const openSchedule = (c: NSCustomer) => {
    const existing = healthchecks.find(h => h.customer_ns_id === String(c.id) && h.quarter === cq && h.status !== "completed") ?? null;
    setEditHc(existing);
    setScheduleFor(c);
  };

  return (
    <div style={{ fontFamily: C.font }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Customers</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 2 }}>{cq} · {customers.length} active customers</div>
        </div>
        <button onClick={load} style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
          ↻ Refresh
        </button>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {([
          { label: "✅ Completed", value: stats.completed, bg: C.greenBg, color: C.green, bd: C.greenBd, filter: "completed" as const },
          { label: "📅 Scheduled", value: stats.scheduled, bg: C.blueBg,  color: C.blue,  bd: C.blueBd,  filter: "scheduled" as const },
          { label: "⚠ Overdue",   value: stats.overdue,   bg: C.redBg,   color: C.red,   bd: C.redBd,   filter: "overdue" as const },
          { label: "❌ No Schedule",value: stats.unscheduled, bg: C.yellowBg, color: C.yellow, bd: C.yellowBd, filter: "unscheduled" as const },
        ] as const).map(k => (
          <div key={k.label}
            onClick={() => setFilterStatus(filterStatus === k.filter ? "all" : k.filter)}
            style={{ background: k.bg, border: `1px solid ${k.bd}`, borderRadius: 12, padding: "16px 20px", cursor: "pointer",
              opacity: filterStatus !== "all" && filterStatus !== k.filter ? 0.5 : 1, transition: "opacity 0.15s" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: k.color, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: k.color, fontFamily: C.mono, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: k.color, opacity: 0.7, marginTop: 4 }}>this quarter</div>
          </div>
        ))}
      </div>

      {/* ── Proactive Monitor ───────────────────────────────────────────────── */}
      {needsAction.length > 0 && (
        <div style={{ background: "linear-gradient(135deg, #0F172A, #1A3052)", borderRadius: 12, marginBottom: 20, overflow: "hidden" }}>
          <div
            onClick={() => setMonitorOpen(o => !o)}
            style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>🔔</span>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#F1F5F9" }}>
                Proactive Monitor
                <span style={{ marginLeft: 8, background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, borderRadius: 9, padding: "1px 7px", fontSize: 11 }}>
                  {needsAction.length} need attention
                </span>
              </div>
            </div>
            <span style={{ color: "#64748B", fontSize: 16 }}>{monitorOpen ? "▲" : "▼"}</span>
          </div>

          {monitorOpen && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", maxHeight: 280, overflowY: "auto" }}>
              {needsAction.map(({ c, status, last }) => {
                const st = STATUS_STYLE[status];
                return (
                  <div key={c.id} style={{ padding: "10px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#F1F5F9" }}>{c.companyname}</div>
                      <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                        {last ? `Last health check: ${fmtDate(last.completed_at)}` : "No health check on record"}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: st.bg, color: st.color, border: `1px solid ${st.bd}` }}>{st.label}</span>
                      <button
                        onClick={() => openSchedule(c)}
                        style={{ padding: "4px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font }}>
                        Schedule
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search customers…"
          style={{ flex: 1, padding: "8px 14px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: C.font, color: C.text, background: C.surface, outline: "none" }}
        />
        <div style={{ fontSize: 12, color: C.textSub }}>{filtered.length} shown</div>
        {filterStatus !== "all" && (
          <button onClick={() => setFilterStatus("all")}
            style={{ fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 7, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>
            Clear filter ✕
          </button>
        )}
      </div>

      {/* ── Customer Table ───────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.sh }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Customer", "Email / Phone", `${cq} Status`, "Consultant", "Scheduled Date", "Last Check", "Actions"].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", background: C.alt, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => {
              const status   = getStatus(c.id, cq, healthchecks);
              const st       = STATUS_STYLE[status];
              const curHc    = healthchecks.find(h => h.customer_ns_id === String(c.id) && h.quarter === cq);
              const lastHc   = lastHealthcheck(c.id, healthchecks);
              const history  = healthchecks.filter(h => h.customer_ns_id === String(c.id));

              return (
                <tr key={c.id} style={{ background: i % 2 === 0 ? C.surface : C.alt, borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{c.companyname}</div>
                    <div style={{ fontSize: 11, color: C.textSub, fontFamily: C.mono }}>#{c.id}</div>
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    {c.email && <div style={{ fontSize: 12, color: C.textMid }}>{c.email}</div>}
                    {c.phone && <div style={{ fontSize: 12, color: C.textSub }}>{c.phone}</div>}
                    {!c.email && !c.phone && <span style={{ color: C.textSub, fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 9, background: st.bg, color: st.color, border: `1px solid ${st.bd}`, whiteSpace: "nowrap" }}>
                      {st.label}
                    </span>
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: C.textMid }}>
                    {curHc?.consultant_name ?? <span style={{ color: C.textSub }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 12, fontFamily: C.mono, color: C.text, whiteSpace: "nowrap" }}>
                    {fmtDate(curHc?.scheduled_date)}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 12, fontFamily: C.mono, color: C.textSub, whiteSpace: "nowrap" }}>
                    {lastHc ? fmtDate(lastHc.completed_at ?? lastHc.updated_at) : "—"}
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => openSchedule(c)}
                        style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, fontFamily: C.font, whiteSpace: "nowrap" }}>
                        {status === "unscheduled" ? "📅 Schedule" : "✏ Edit"}
                      </button>
                      {history.length > 0 && (
                        <button onClick={() => setHistoryFor(c)}
                          style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>
                          History
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "40px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
                  No customers match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {scheduleFor && (
        <HealthcheckModal
          customer={scheduleFor}
          existing={editHc}
          onClose={() => { setScheduleFor(null); setEditHc(null); }}
          onSaved={load}
        />
      )}
      {historyFor && (
        <HistoryModal
          customer={historyFor}
          hcs={healthchecks}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}
