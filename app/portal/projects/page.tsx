"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabasePortalClient } from "@/lib/supabase-portal";

interface PortalProject {
  id: number;
  entityid: string;
  companyname: string;
  jobtype: number;
  goliveDate: string | null;
  budgetHours: number;
  actualHours: number;
  remainingHours: number;
  burnRate: number;
}

export default function PortalProjectsPage() {
  const router = useRouter();
  const [projects,     setProjects]     = useState<PortalProject[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabasePortalClient();

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Your session has expired. Please request a new invitation link.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/portal/projects", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to load projects"); setLoading(false); return; }
      setProjects(data.projects ?? []);
      setCustomerName(data.customerName ?? "");
      setLoading(false);
    }

    load();
  }, []);

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  }

  async function signOut() {
    const supabase = getSupabasePortalClient();
    await supabase.auth.signOut();
    router.replace("/portal/auth/callback");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#EEF1F5", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>

      {/* Header */}
      <header style={{ background: "linear-gradient(135deg,#0A0F1E,#0D1B35)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "0 28px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/ceba-logo.webp" alt="CEBA Solutions" style={{ height: 30, objectFit: "contain" }} />
            <span style={{ color: "#64748B", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Client Portal</span>
          </div>
          {customerName && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, color: "#94A3B8" }}>
                {customerName}
              </span>
              <button onClick={signOut} style={{ background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#64748B", cursor: "pointer" }}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 28px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#8A95A3", fontSize: 14 }}>
            Loading your projects…
          </div>
        )}

        {error && (
          <div style={{ background: "#FEF0EF", border: "1px solid #F5B8B5", borderRadius: 10, padding: "16px 20px", color: "#C0392B", fontSize: 14 }}>
            ⚠ {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#0D1117", marginBottom: 6 }}>Your Projects</div>
            <div style={{ fontSize: 13, color: "#8A95A3", marginBottom: 28 }}>
              {projects.length} project{projects.length !== 1 ? "s" : ""} available
            </div>

            {projects.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 12, padding: "48px 24px", textAlign: "center", border: "1px solid #E2E5EA" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 600, fontSize: 16, color: "#0D1117", marginBottom: 6 }}>No projects yet</div>
                <div style={{ fontSize: 13, color: "#8A95A3" }}>Your CEBA Solutions PM will share projects with you shortly.</div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {projects.map(p => {
                const burnPct  = Math.round(p.burnRate * 100);
                const isOver   = p.goliveDate && new Date(p.goliveDate) < new Date();
                const daysLeft = p.goliveDate
                  ? Math.round((new Date(p.goliveDate).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <div
                    key={p.id}
                    onClick={() => router.push(`/portal/projects/${p.id}`)}
                    style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2E5EA", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", padding: "20px 24px", cursor: "pointer", transition: "box-shadow 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.1)")}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.05)")}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: "#0D1117" }}>{p.companyname}</div>
                        <div style={{ fontSize: 12, color: "#8A95A3", marginTop: 2 }}>
                          {p.jobtype === 1 ? "Implementation" : "Service"} · Project #{p.entityid}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        {p.goliveDate && (
                          <div style={{ fontSize: 12, fontWeight: 600, color: isOver ? "#C0392B" : "#4A5568", background: isOver ? "#FEF0EF" : "#F7F9FC", border: `1px solid ${isOver ? "#F5B8B5" : "#E2E5EA"}`, borderRadius: 8, padding: "3px 10px" }}>
                            {isOver
                              ? `⚠ ${Math.abs(daysLeft!)}d overdue`
                              : daysLeft === 0 ? "Go-live: Today"
                              : `Go-live: ${fmtDate(p.goliveDate)}`}
                          </div>
                        )}
                        <span style={{ fontSize: 11, color: "#8A95A3" }}>
                          {p.actualHours.toFixed(0)}h of {p.budgetHours.toFixed(0)}h used
                        </span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: 6, background: "#E2E5EA", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, burnPct)}%`, background: burnPct > 90 ? "#C0392B" : burnPct > 70 ? "#92600A" : "#0C6E44", borderRadius: 3, transition: "width 0.3s" }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#8A95A3", marginTop: 6 }}>
                      {burnPct}% of budget consumed
                    </div>

                    <div style={{ marginTop: 14, fontSize: 13, color: "#1A56DB", fontWeight: 600 }}>
                      View tasks →
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
