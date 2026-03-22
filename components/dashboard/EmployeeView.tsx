"use client";
import { useState, useEffect } from "react";
import { C } from "@/lib/constants";
import type { EmployeeBalance, TimeEntry } from "@/app/api/employee/me/route";

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

export function EmployeeView() {
  const [balance, setBalance]   = useState<EmployeeBalance | null>(null);
  const [entries, setEntries]   = useState<TimeEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "pto" | "sick">("all");

  useEffect(() => {
    fetch("/api/employee/me")
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setBalance(d.balance);
        setEntries(d.entries ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = typeFilter === "all" ? entries : entries.filter(e => e.type === typeFilter);

  const ptoUsed  = entries.filter(e => e.type === "pto").reduce((s, e) => s + e.hours, 0);
  const sickUsed = entries.filter(e => e.type === "sick").reduce((s, e) => s + e.hours, 0);

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
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>My Leave Balances</div>
        {balance && (
          <div style={{ fontSize: 13, color: C.textSub, marginTop: 3 }}>
            {balance.name} · {balance.email}
          </div>
        )}
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

      {/* Time entries */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>

        {/* Table header */}
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
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 9,
                      background: e.type === "pto" ? C.greenBg : C.blueBg,
                      color:      e.type === "pto" ? C.green   : C.blue,
                      border:     `1px solid ${e.type === "pto" ? C.greenBd : C.blueBd}`,
                    }}>
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
    </div>
  );
}
