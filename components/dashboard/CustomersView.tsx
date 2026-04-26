"use client";
import { useState, useEffect, useMemo } from "react";
import { C } from "@/lib/constants";
import { EMPLOYEES } from "@/lib/constants";
import type { NSCustomer } from "@/app/api/customers/route";
import type { Healthcheck } from "@/app/api/healthchecks/route";
import type { MSAProject } from "@/app/api/msa/route";

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

// ─── MSA View ─────────────────────────────────────────────────────────────────

function MSAView() {
  const [projects, setProjects] = useState<MSAProject[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/msa");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setProjects(data.projects ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const now   = new Date();
  const month = now.toLocaleString("en-AU", { month: "long", year: "numeric" });

  // Summary metrics
  const totalMsa       = projects.reduce((s, p) => s + p.msaHours, 0);
  const totalMtd       = projects.reduce((s, p) => s + p.mtdHours, 0);
  const totalRemaining = projects.reduce((s, p) => s + p.remainingHours, 0);

  if (loading) return (
    <div style={{ padding: "60px 24px", textAlign: "center", color: C.textSub, fontFamily: C.font }}>
      <div style={{ fontSize: 22, marginBottom: 10 }}>⏳</div>Loading MSA projects…
    </div>
  );

  if (error) return (
    <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: "14px 18px", color: C.red, fontSize: 13, fontFamily: C.font }}>⚠ {error}</div>
  );

  return (
    <div style={{ fontFamily: C.font }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Managed Services Agreements</div>
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 2 }}>{month} · {projects.length} In Progress MSA project{projects.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={load} style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font }}>
          ↻ Refresh
        </button>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        <div style={{ background: C.purpleBg, border: `1px solid ${C.purpleBd}`, borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Total MSA Hours</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: C.purple, fontFamily: C.mono, lineHeight: 1 }}>{totalMsa.toFixed(1)}<span style={{ fontSize: 15, fontWeight: 600, marginLeft: 3 }}>h</span></div>
          <div style={{ fontSize: 11, color: C.purple, opacity: 0.7, marginTop: 4 }}>contracted this month</div>
        </div>
        <div style={{ background: C.blueBg, border: `1px solid ${C.blueBd}`, borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>MTD Hours Booked</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: C.blue, fontFamily: C.mono, lineHeight: 1 }}>{totalMtd.toFixed(1)}<span style={{ fontSize: 15, fontWeight: 600, marginLeft: 3 }}>h</span></div>
          <div style={{ fontSize: 11, color: C.blue, opacity: 0.7, marginTop: 4 }}>logged so far this month</div>
        </div>
        <div style={{ background: totalRemaining < 0 ? C.redBg : C.greenBg, border: `1px solid ${totalRemaining < 0 ? C.redBd : C.greenBd}`, borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: totalRemaining < 0 ? C.red : C.green, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            {totalRemaining < 0 ? "Hours Over" : "Hours Remaining"}
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: totalRemaining < 0 ? C.red : C.green, fontFamily: C.mono, lineHeight: 1 }}>
            {Math.abs(totalRemaining).toFixed(1)}<span style={{ fontSize: 15, fontWeight: 600, marginLeft: 3 }}>h</span>
          </div>
          <div style={{ fontSize: 11, color: totalRemaining < 0 ? C.red : C.green, opacity: 0.7, marginTop: 4 }}>
            {totalRemaining < 0 ? "over contracted hours" : "left this month"}
          </div>
        </div>
      </div>

      {/* Table */}
      {projects.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "48px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
          No active Managed Services Agreement projects found.
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.sh }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Project", "Type", "MSA Hours", "MTD Booked", "Remaining", "Usage"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", background: C.alt, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => {
                const pct        = p.msaHours > 0 ? Math.min(p.mtdHours / p.msaHours, 1) : 0;
                const pctDisplay = p.msaHours > 0 ? Math.round((p.mtdHours / p.msaHours) * 100) : 0;
                const isOver     = p.remainingHours < 0;
                const barColor   = isOver ? C.red : pct > 0.85 ? C.yellow : C.green;
                const remColor   = isOver ? C.red : p.remainingHours < p.msaHours * 0.15 ? C.yellow : C.green;

                return (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? C.surface : C.alt, borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{p.customerName}</div>
                      <div style={{ fontSize: 11, color: C.textSub }}>{p.projectName}</div>
                      <div style={{ fontSize: 10, color: C.textSub, fontFamily: C.mono }}>#{p.projectNumber}</div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: C.purpleBg, color: C.purple, border: `1px solid ${C.purpleBd}` }}>
                        {p.jobtypeName}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: C.text }}>
                      {p.msaHours > 0 ? `${p.msaHours.toFixed(1)}h` : <span style={{ color: C.textSub }}>—</span>}
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: C.blue }}>
                      {p.mtdHours.toFixed(1)}h
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: remColor }}>
                      {isOver ? `+${Math.abs(p.remainingHours).toFixed(1)}h over` : `${p.remainingHours.toFixed(1)}h`}
                    </td>
                    <td style={{ padding: "12px 16px", minWidth: 140 }}>
                      {p.msaHours > 0 ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(pct * 100, 100)}%`, height: "100%", background: barColor, borderRadius: 4, transition: "width 0.3s" }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: C.mono, color: barColor, minWidth: 34, textAlign: "right" }}>
                            {pctDisplay}%
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: C.textSub, fontSize: 12 }}>No MSA hours set</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Projects Tab ─────────────────────────────────────────────────────────────

interface NSProject { id: string; entityid: string; companyname: string; golive_date: string | null; budget_hours: string | null; remaining_hours: string | null; jobtype: string; }
interface PortalAccessRow { id: string; customer_ns_id: string; project_ns_id: string; project_name: string; invited_by: string; invited_at: string; customer_portal_users?: { email: string; display_name: string | null } | null; }

function CustomerProjectsView({ customers }: { customers: NSCustomer[] }) {
  const [projects,  setProjects]  = useState<NSProject[]>([]);
  const [access,    setAccess]    = useState<PortalAccessRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [inviting,  setInviting]  = useState<{ project: NSProject; email: string; custId: string } | null>(null);
  const [email,     setEmail]     = useState("");
  const [selCust,   setSelCust]   = useState("");
  const [saving,    setSaving]    = useState(false);
  const [invErr,    setInvErr]    = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [pRes, aRes] = await Promise.all([
          fetch("/api/projects"),
          // fetch all project_portal_access rows for display
          fetch("/api/pm/portal-access?projectId=all").catch(() => ({ json: () => ({ access: [] }) })),
        ]);
        const pData = await pRes.json();
        // Flatten all projects from the projects API
        const projs: NSProject[] = (pData.projects ?? [])
          .filter((p: { isInternal?: boolean }) => !p.isInternal)
          .map((p: { id: number; entityid: string; client: string; goliveDate: string | null; budget_hours: number; rem: number; jobtype?: number; projectType?: string }) => ({
            id:              String(p.id),
            entityid:        p.entityid,
            companyname:     p.client,
            golive_date:     p.goliveDate,
            budget_hours:    String(p.budget_hours),
            remaining_hours: String(p.rem),
            jobtype:         p.projectType === "Implementation" ? "1" : "2",
          }));
        setProjects(projs);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Load access for each project individually when needed
  async function loadAccess(projectId: string) {
    const res = await fetch(`/api/pm/portal-access?projectId=${projectId}`);
    const data = await res.json();
    setAccess(prev => {
      const filtered = prev.filter(a => a.project_ns_id !== projectId);
      return [...filtered, ...(data.access ?? [])];
    });
  }

  async function sendInvite() {
    if (!inviting || !email || !selCust) return;
    setSaving(true); setInvErr(null);
    try {
      const cust = customers.find(c => String(c.id) === selCust);
      const res = await fetch("/api/portal/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          customerNsId:  selCust,
          customerName:  cust?.companyname ?? "",
          projectNsIds:  [inviting.project.id],
          projectNames:  { [inviting.project.id]: inviting.project.companyname },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await loadAccess(inviting.project.id);
      setInviting(null); setEmail(""); setSelCust("");
    } catch (e) {
      setInvErr(e instanceof Error ? e.message : "Failed to send invite");
    } finally {
      setSaving(false);
    }
  }

  async function revokeAccess(customerNsId: string, projectNsId: string) {
    await fetch(`/api/pm/portal-access?customerNsId=${customerNsId}&projectNsId=${projectNsId}`, { method: "DELETE" });
    setAccess(prev => prev.filter(a => !(a.customer_ns_id === customerNsId && a.project_ns_id === projectNsId)));
  }

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  }

  if (loading) return <div style={{ padding: "40px 0", textAlign: "center", color: C.textSub, fontSize: 13 }}>Loading projects…</div>;

  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 18, color: C.text, marginBottom: 6 }}>Projects</div>
      <div style={{ fontSize: 12, color: C.textSub, marginBottom: 20 }}>{projects.length} active projects — manage customer portal access below</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {projects.map(p => {
          const projAccess = access.filter(a => a.project_ns_id === p.id);
          const budgetH    = parseFloat(p.budget_hours ?? "0") || 0;
          const remH       = parseFloat(p.remaining_hours ?? "0") || 0;
          const usedH      = budgetH - remH;
          const burnPct    = budgetH > 0 ? Math.round((usedH / budgetH) * 100) : 0;

          return (
            <div key={p.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", boxShadow: C.sh }}>
              {/* Project header */}
              <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{p.companyname}</div>
                  <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>
                    #{p.entityid} · {p.jobtype === "1" ? "Implementation" : "Service"} · Go-live: {fmtDate(p.golive_date)}
                    · {usedH.toFixed(0)}h / {budgetH.toFixed(0)}h ({burnPct}%)
                  </div>
                </div>
                <button
                  onClick={() => { loadAccess(p.id); setInviting({ project: p, email: "", custId: "" }); setEmail(""); setSelCust(""); setInvErr(null); }}
                  style={{ padding: "5px 13px", fontSize: 11, fontWeight: 700, borderRadius: 7, cursor: "pointer", background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, fontFamily: C.font }}
                >
                  + Invite to Portal
                </button>
              </div>

              {/* Access rows */}
              {projAccess.length > 0 && (
                <div style={{ borderTop: `1px solid ${C.border}`, background: C.alt }}>
                  <div style={{ padding: "6px 18px", fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>Portal Access</div>
                  {projAccess.map(a => (
                    <div key={a.id} style={{ padding: "7px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${C.border}`, fontSize: 12 }}>
                      <div>
                        <span style={{ fontWeight: 600, color: C.text }}>{a.customer_portal_users?.email ?? a.customer_ns_id}</span>
                        {a.customer_portal_users?.display_name && (
                          <span style={{ color: C.textSub, marginLeft: 6 }}>({a.customer_portal_users.display_name})</span>
                        )}
                        <span style={{ color: C.textSub, marginLeft: 8 }}>Invited by {a.invited_by} · {fmtDate(a.invited_at)}</span>
                      </div>
                      <button
                        onClick={() => revokeAccess(a.customer_ns_id, a.project_ns_id)}
                        style={{ padding: "2px 8px", fontSize: 10, fontWeight: 700, borderRadius: 6, cursor: "pointer", background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, fontFamily: C.font }}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Invite modal */}
      {inviting && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => e.target === e.currentTarget && setInviting(null)}>
          <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>Invite Customer to Portal</div>
            <div style={{ fontSize: 12, color: C.textSub, marginBottom: 20 }}>Grant portal access to: <strong>{inviting.project.companyname}</strong></div>
            {invErr && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 7, padding: "8px 12px", color: C.red, fontSize: 12, marginBottom: 12 }}>{invErr}</div>}

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Customer Account</label>
              <select value={selCust} onChange={e => setSelCust(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontFamily: C.font, color: C.text, background: "#fff", outline: "none" }}>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={String(c.id)}>{c.companyname}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Contact Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@client.com"
                style={{ width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontFamily: C.font, color: C.text, outline: "none", boxSizing: "border-box" }} />
              <div style={{ fontSize: 11, color: C.textSub, marginTop: 4 }}>A magic-link invite will be emailed to this address.</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setInviting(null)} style={{ padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>Cancel</button>
              <button onClick={sendInvite} disabled={!selCust || !email || saving}
                style={{ padding: "7px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: (!selCust || !email || saving) ? "not-allowed" : "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, opacity: (!selCust || !email || saving) ? 0.6 : 1 }}>
                {saving ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function CustomersView() {
  const [activeTab, setActiveTab]     = useState<"healthchecks" | "msa" | "projects">("healthchecks");
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

      {/* ── Sub-tab switcher ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${C.border}`, marginBottom: 24 }}>
        {([
          { id: "healthchecks" as const, label: "🏥 Health Checks" },
          { id: "msa"          as const, label: "📋 MSA"           },
          { id: "projects"     as const, label: "🗂 Projects"       },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 20px", fontSize: 13, fontWeight: 700,
              background: "none", border: "none",
              borderBottom: activeTab === tab.id ? `2px solid ${C.blue}` : "2px solid transparent",
              marginBottom: -2,
              color: activeTab === tab.id ? C.blue : C.textSub,
              cursor: "pointer", fontFamily: C.font,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── MSA tab ──────────────────────────────────────────────────────────── */}
      {activeTab === "msa" && <MSAView />}

      {/* ── Projects tab ─────────────────────────────────────────────────────── */}
      {activeTab === "projects" && <CustomerProjectsView customers={customers} />}

      {/* ── Health Checks tab ────────────────────────────────────────────────── */}
      {activeTab === "healthchecks" && <>

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

      </> /* end healthchecks tab */}
    </div>
  );
}
