"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { C } from "@/lib/constants";

function LoginContent() {
  const params   = useSearchParams();
  const rawError = params.get("error") ?? params.get("cal_error");

  const ERROR_MESSAGES: Record<string, string> = {
    OAuthSignin:           "Error starting Google sign-in. Please try again.",
    OAuthCallback:         "Error completing sign-in. Please try again.",
    OAuthAccountNotLinked: "This email is linked to a different sign-in method.",
    AccessDenied:          "Your account is not authorised for this dashboard.",
    not_authorized:        "Your Google account is not authorised for this dashboard.",
    default:               "Something went wrong. Please try again.",
  };

  const errorMsg = rawError
    ? (ERROR_MESSAGES[rawError] ?? ERROR_MESSAGES.default)
    : null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0A0F1E 0%, #0D1B35 50%, #0A1628 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: C.font,
    }}>
      <div style={{
        background: "#111827",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "44px 48px",
        width: "min(400px, 92vw)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        textAlign: "center",
      }}>

        <img
          src="/ceba-logo.webp"
          alt="CEBA Solutions"
          style={{ height: 44, width: "auto", objectFit: "contain", marginBottom: 20 }}
        />

        <div style={{ color: "#F1F5F9", fontWeight: 700, fontSize: 19, marginBottom: 6 }}>
          Project Dashboard
        </div>
        <div style={{ color: "#475569", fontSize: 13, marginBottom: 32 }}>
          Sign in with your CEBA Google account
        </div>

        {errorMsg && (
          <div style={{
            background: "rgba(192,57,43,0.15)", border: "1px solid rgba(192,57,43,0.3)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 24,
            color: "#F87171", fontSize: 12, textAlign: "left",
          }}>
            ⚠ {errorMsg}
          </div>
        )}

        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          style={{
            width: "100%",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            background: "#fff", color: "#0D1117",
            border: "none", borderRadius: 10,
            padding: "13px 24px", fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: C.font,
            boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>

        <div style={{ marginTop: 20, fontSize: 11, color: "#334155" }}>
          Access is restricted to authorised CEBA accounts
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
