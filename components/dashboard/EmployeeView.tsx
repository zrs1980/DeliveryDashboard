"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { C } from "@/lib/constants";
import type { EmployeeBalance, TimeEntry } from "@/app/api/employee/me/route";
import type { PTORequest } from "@/app/api/pto-requests/route";

const fmtDate = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtH = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1)) + "h";

function BalanceCard({
  label, hours, icon, color, bg, bd, sub,
}: { label: string; hours: number; icon: string; color: string; bg: string; bd: string; sub: string }) {
  return (
    <div style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 12, padding: "20px 24px", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      </div>
      <div style={{ fontSize: 36, fontWeight: 800, color, fontFamily: C.mono, lineHeight: 1 }}>{fmtH(hours)}</div>
      <div style={{ fontSize: 12, color, opacity: 0.7, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string; bd: string }> = {
  pending:  { label: "⏳ Pending",  bg: C.yellowBg, color: C.yellow, bd: C.yellowBd },
  approved: { label: "✅ Approved", bg: C.greenBg,  color: C.green,  bd: C.greenBd  },
  rejected: { label: "❌ Rejected", bg: C.redBg,    color: C.red,    bd: C.redBd    },
};

// ─── Request Form Modal ────────────────────────────────────────────────────────

function RequestModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const [type, setType]           = useState<"pto" | "sick">("pto");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [hours, setHours]         = useState("");
  const [reason, setReason]       = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const mdRef = { current: null as EventTarget | null };

  async function submit() {
    if (!startDate || !endDate || !hours) { setError("Please fill in all required fields."); return; }
    setSaving(true); setError(null);
    try {
      const res  = await fetch("/api/pto-requests", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, start_date: startDate, end_date: endDate, hours: parseFloat(hours), reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submit failed");
      onSubmitted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
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
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={e => { mdRef.current = e.target; }}
      onClick={e => { if (e.target === e.currentTarget && mdRef.current === e.currentTarget) onClose(); }}
    >
      <div style={{ background: C.surface, borderRadius: 14, padding: "28px 32px", width: 480, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.18)", fontFamily: C.font }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: C.text, marginBottom: 4 }}>Request Time Off</div>
        <div style={{ fontSize: 13, color: C.textSub, marginBottom: 22 }}>Your request will be sent to Zabe for approval.</div>

        {/* Type */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Type</label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["pto", "sick"] as const).map(t => (
              <button
                key={t}
                onClick={() => setType(t)}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: type === t ? (t === "pto" ? C.greenBg : C.blueBg) : C.alt,
                  color:      type === t ? (t === "pto" ? C.green   : C.blue)   : C.textMid,
                  border:     `1px solid ${type === t ? (t === "pto" ? C.greenBd : C.blueBd) : C.border}`,
                  fontFamily: C.font,
                }}
              >
                {t === "pto" ? "🌴 PTO" : "🏥 Sick Leave"}
              </button>
            ))}
          </div>
        </div>

        {/* Dates */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Start Date *</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>End Date *</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inp} />
          </div>
        </div>

        {/* Hours */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Hours *</label>
          <input type="number" min="0.5" step="0.5" value={hours} onChange={e => setHours(e.target.value)} placeholder="e.g. 8" style={inp} />
        </div>

        {/* Reason */}
        <div style={{ marginBottom: 22 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Reason <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} style={{ ...inp, resize: "vertical" }} placeholder="Any context for your request…" />
        </div>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "8px 12px", color: C.red, fontSize: 12, marginBottom: 14 }}>⚠ {error}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving} style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Submitting…" : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Review Modal (Approver) ───────────────────────────────────────────────────

function ReviewModal({ request, onClose, onDone }: { request: PTORequest; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes]   = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function decide(status: "approved" | "rejected") {
    setSaving(true); setError(null);
    try {
      const res  = await fetch(`/api/pto-requests/${request.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status, reviewer_notes: notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      onDone(); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = {
    width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 13, fontFamily: C.font, color: C.text, background: C.surface, outline: "none",
    boxSizing: "border-box", resize: "vertical",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.surface, borderRadius: 14, padding: "28px 32px", width: 460, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.18)", fontFamily: C.font }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: C.text, marginBottom: 4 }}>Review Request</div>
        <div style={{ fontSize: 13, color: C.textSub, marginBottom: 20 }}>{request.employee_name}</div>

        <div style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 18, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: C.textSub }}>Type</span>
            <span style={{ fontWeight: 600, color: C.text }}>{request.type === "pto" ? "🌴 PTO" : "🏥 Sick Leave"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: C.textSub }}>Dates</span>
            <span style={{ fontWeight: 600, color: C.text }}>{fmtDate(request.start_date)} → {fmtDate(request.end_date)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: request.reason ? 6 : 0 }}>
            <span style={{ color: C.textSub }}>Hours</span>
            <span style={{ fontWeight: 700, color: C.text, fontFamily: C.mono }}>{request.hours}h</span>
          </div>
          {request.reason && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, color: C.textMid, fontSize: 12 }}>{request.reason}</div>
          )}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 5 }}>Notes <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={inp} placeholder="Any notes for the employee…" />
        </div>

        {error && (
          <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: "8px 12px", color: C.red, fontSize: 12, marginBottom: 14 }}>⚠ {error}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: C.alt, color: C.textMid, border: `1px solid ${C.border}`, fontFamily: C.font }}>
            Cancel
          </button>
          <button onClick={() => decide("rejected")} disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, fontFamily: C.font }}>
            ❌ Reject
          </button>
          <button onClick={() => decide("approved")} disabled={saving} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.green, color: "#fff", border: "none", fontFamily: C.font }}>
            ✅ Approve
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function EmployeeView() {
  const { data: session }         = useSession();
  const [balance, setBalance]     = useState<EmployeeBalance | null>(null);
  const [entries, setEntries]     = useState<TimeEntry[]>([]);
  const [requests, setRequests]   = useState<PTORequest[]>([]);
  const [isApprover, setIsApprover] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "pto" | "sick">("all");
  const [showForm, setShowForm]   = useState(false);
  const [reviewReq, setReviewReq] = useState<PTORequest | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [meRes, reqRes] = await Promise.all([
        fetch("/api/employee/me"),
        fetch("/api/pto-requests"),
      ]);
      const [meData, reqData] = await Promise.all([meRes.json(), reqRes.json()]);
      if (meData.error) throw new Error(meData.error);
      setBalance(meData.balance);
      setEntries(meData.entries ?? []);
      setRequests(reqData.requests ?? []);
      setIsApprover(reqData.isApprover ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered   = typeFilter === "all" ? entries : entries.filter(e => e.type === typeFilter);
  const ptoUsed    = entries.filter(e => e.type === "pto").reduce((s, e) => s + e.hours, 0);
  const sickUsed   = entries.filter(e => e.type === "sick").reduce((s, e) => s + e.hours, 0);
  const myRequests       = requests.filter(r => r.employee_email === session?.user?.email);
  const pendingApprovals = isApprover ? requests.filter(r => r.status === "pending") : [];
  const allApprovals     = isApprover ? requests : [];

  if (loading) {
    return (
      <div style={{ padding: "60px 24px", textAlign: "center", color: C.textSub, fontFamily: C.font }}>
        <div style={{ fontSize: 22, marginBottom: 10 }}>⏳</div>
        Loading your employee data from NetSuite…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: "14px 18px", color: C.red, fontSize: 13, fontFamily: C.font }}>
        ⚠ {error}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: C.font }}>

      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>My Leave Balances</div>
          {balance && (
            <div style={{ fontSize: 13, color: C.textSub, marginTop: 3 }}>
              {balance.name} · {balance.email}
              {balance.periodStart && (
                <span style={{ marginLeft: 10, background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, borderRadius: 6, padding: "1px 8px", fontSize: 11, fontWeight: 600 }}>
                  Period from {fmtDate(balance.periodStart)}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{
            padding: "9px 20px", borderRadius: 9, fontSize: 13, fontWeight: 700,
            background: C.blue, color: "#fff", border: "none", cursor: "pointer",
            fontFamily: C.font, flexShrink: 0,
            boxShadow: "0 2px 8px rgba(26,86,219,0.35)",
          }}
        >
          + Request Time Off
        </button>
      </div>

      {/* Balance cards */}
      {balance && (
        <div style={{ display: "flex", gap: 16, marginBottom: 28 }}>
          <BalanceCard
            label="PTO Remaining"
            hours={Math.max(0, balance.ptoHours - ptoUsed)}
            icon="🌴"
            color={C.green}
            bg={C.greenBg}
            bd={C.greenBd}
            sub={`${fmtH(balance.ptoHours)} allocated · ${fmtH(ptoUsed)} used`}
          />
          <BalanceCard
            label="Sick Leave Remaining"
            hours={Math.max(0, balance.sickHours - sickUsed)}
            icon="🏥"
            color={C.blue}
            bg={C.blueBg}
            bd={C.blueBd}
            sub={`${fmtH(balance.sickHours)} allocated · ${fmtH(sickUsed)} used`}
          />
          <div style={{ flex: 1, background: C.alt, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Total Time Off Logged</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: C.text, fontFamily: C.mono, lineHeight: 1 }}>{fmtH(ptoUsed + sickUsed)}</div>
            <div style={{ fontSize: 12, color: C.textSub, marginTop: 6 }}>{entries.length} time entries on record</div>
          </div>
        </div>
      )}

      {/* ── Approver panel (Zabe only) ─────────────────────────────────────── */}
      {isApprover && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            Pending Approvals
            {pendingApprovals.length > 0 && (
              <span style={{ background: C.redBg, color: C.red, border: `1px solid ${C.redBd}`, borderRadius: 9, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>
                {pendingApprovals.length}
              </span>
            )}
          </div>

          {allApprovals.length === 0 ? (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
              No leave requests submitted yet.
            </div>
          ) : (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Employee", "Type", "Dates", "Hours", "Reason", "Status", "Action"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", background: C.alt, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allApprovals.map((r, i) => {
                    const st = STATUS_STYLE[r.status];
                    return (
                      <tr key={r.id} style={{ background: i % 2 === 0 ? C.surface : C.alt, borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "10px 16px" }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{r.employee_name}</div>
                          <div style={{ fontSize: 11, color: C.textSub }}>{r.employee_email}</div>
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: r.type === "pto" ? C.greenBg : C.blueBg, color: r.type === "pto" ? C.green : C.blue, border: `1px solid ${r.type === "pto" ? C.greenBd : C.blueBd}` }}>
                            {r.type === "pto" ? "🌴 PTO" : "🏥 Sick"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 16px", fontSize: 12, fontFamily: C.mono, color: C.text, whiteSpace: "nowrap" }}>
                          {fmtDate(r.start_date)}<br /><span style={{ color: C.textSub }}>→ {fmtDate(r.end_date)}</span>
                        </td>
                        <td style={{ padding: "10px 16px", fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text }}>{r.hours}h</td>
                        <td style={{ padding: "10px 16px", fontSize: 12, color: C.textSub, maxWidth: 180 }}>{r.reason || "—"}</td>
                        <td style={{ padding: "10px 16px" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: st.bg, color: st.color, border: `1px solid ${st.bd}`, whiteSpace: "nowrap" }}>{st.label}</span>
                          {r.reviewer_notes && <div style={{ fontSize: 11, color: C.textSub, marginTop: 3 }}>{r.reviewer_notes}</div>}
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          {r.status === "pending" && (
                            <button
                              onClick={() => setReviewReq(r)}
                              style={{ padding: "4px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}`, fontFamily: C.font, whiteSpace: "nowrap" }}
                            >
                              Review
                            </button>
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
      )}

      {/* ── My Requests (non-approver) ─────────────────────────────────────── */}
      {!isApprover && myRequests.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 14 }}>My Requests</div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Type", "Dates", "Hours", "Reason", "Status", "Submitted"].map(h => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", background: C.alt, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myRequests.map((r, i) => {
                  const st = STATUS_STYLE[r.status];
                  return (
                    <tr key={r.id} style={{ background: i % 2 === 0 ? C.surface : C.alt, borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: r.type === "pto" ? C.greenBg : C.blueBg, color: r.type === "pto" ? C.green : C.blue, border: `1px solid ${r.type === "pto" ? C.greenBd : C.blueBd}` }}>
                          {r.type === "pto" ? "🌴 PTO" : "🏥 Sick"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 12, fontFamily: C.mono, color: C.text, whiteSpace: "nowrap" }}>
                        {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text }}>{r.hours}h</td>
                      <td style={{ padding: "10px 16px", fontSize: 12, color: C.textSub, maxWidth: 220 }}>{r.reason || "—"}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: st.bg, color: st.color, border: `1px solid ${st.bd}`, whiteSpace: "nowrap" }}>{st.label}</span>
                        {r.reviewer_notes && <div style={{ fontSize: 11, color: C.textSub, marginTop: 3 }}>{r.reviewer_notes}</div>}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 11, fontFamily: C.mono, color: C.textSub, whiteSpace: "nowrap" }}>{fmtDate(r.submitted_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Time Entries ───────────────────────────────────────────────────── */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.alt }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Time Entries</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["all", "pto", "sick"] as const).map(f => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: C.font, background: typeFilter === f ? C.blue : C.alt, color: typeFilter === f ? "#fff" : C.textMid, border: `1px solid ${typeFilter === f ? C.blue : C.border}`, textTransform: "capitalize" }}
              >
                {f === "all" ? "All" : f === "pto" ? "🌴 PTO" : "🏥 Sick"}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: C.textSub, fontSize: 14 }}>
            <div style={{ fontSize: 22, marginBottom: 10 }}>📋</div>
            No time entries found.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Type", "Project", "Hours", "Notes"].map(h => (
                  <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", background: C.alt, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={e.id} style={{ background: i % 2 === 0 ? "#fff" : C.alt, borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontFamily: C.mono, color: C.text, whiteSpace: "nowrap" }}>{fmtDate(e.date)}</td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: e.type === "pto" ? C.greenBg : C.blueBg, color: e.type === "pto" ? C.green : C.blue, border: `1px solid ${e.type === "pto" ? C.greenBd : C.blueBd}` }}>
                      {e.type === "pto" ? "🌴 PTO" : "🏥 Sick"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: C.textMid }}>{e.projectName}</td>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontFamily: C.mono, fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>{fmtH(e.hours)}</td>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: C.textSub, maxWidth: 320 }}>{e.memo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: C.alt, borderTop: `2px solid ${C.border}` }}>
                <td colSpan={3} style={{ padding: "9px 16px", fontSize: 12, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total</td>
                <td style={{ padding: "9px 16px", fontSize: 13, fontFamily: C.mono, fontWeight: 800, color: C.text }}>{fmtH(filtered.reduce((s, e) => s + e.hours, 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Modals */}
      {showForm && (
        <RequestModal onClose={() => setShowForm(false)} onSubmitted={load} />
      )}
      {reviewReq && (
        <ReviewModal request={reviewReq} onClose={() => setReviewReq(null)} onDone={load} />
      )}
    </div>
  );
}
