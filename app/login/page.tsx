"use client";
import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const json = await res.json();
        setError(json.error ?? "Incorrect password");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0A0F1E 0%, #0D1B35 50%, #0A1628 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans','Segoe UI',sans-serif",
    }}>
      <div style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        padding: "40px 44px",
        width: "100%",
        maxWidth: 380,
        boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
      }}>
        {/* Logo / title */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src="/ceba-logo.webp"
            alt="CEBA Solutions"
            style={{ height: 40, marginBottom: 16, objectFit: "contain" }}
          />
          <div style={{ color: "#F1F5F9", fontWeight: 700, fontSize: 18 }}>
            Project Dashboard
          </div>
          <div style={{ color: "#64748B", fontSize: 13, marginTop: 4 }}>
            Enter your password to continue
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            style={{
              width: "100%",
              padding: "11px 16px",
              fontSize: 14,
              background: "rgba(255,255,255,0.06)",
              border: `1px solid ${error ? "#EF4444" : "rgba(255,255,255,0.12)"}`,
              borderRadius: 8,
              color: "#F1F5F9",
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
              marginBottom: error ? 8 : 16,
              transition: "border-color 0.15s",
            }}
          />

          {error && (
            <div style={{ color: "#F87171", fontSize: 12, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: "100%",
              padding: "11px 0",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "inherit",
              background: loading || !password
                ? "rgba(26,86,219,0.4)"
                : "linear-gradient(135deg, #1A56DB, #2563EB)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: loading || !password ? "not-allowed" : "pointer",
              boxShadow: loading || !password ? "none" : "0 4px 14px rgba(26,86,219,0.4)",
              transition: "opacity 0.15s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {loading ? (
              <>
                <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                Checking…
              </>
            ) : "Sign In"}
          </button>
        </form>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } * { box-sizing: border-box; }`}</style>
    </div>
  );
}
