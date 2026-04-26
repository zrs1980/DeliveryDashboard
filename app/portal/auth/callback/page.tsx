"use client";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabasePortalClient } from "@/lib/supabase-portal";

function CallbackInner() {
  const router  = useRouter();
  const params  = useSearchParams();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    const tokenHash = params.get("token_hash");
    const type      = params.get("type") ?? "magiclink";
    const code      = params.get("code");
    const supabase  = getSupabasePortalClient();

    async function handle() {
      try {
        let session = null;

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          session = data.session;
        } else if (tokenHash) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as "magiclink" | "email",
          });
          if (error) throw error;
          session = data.session;
        } else {
          const { data } = await supabase.auth.getSession();
          session = data.session;
        }

        if (!session) {
          setErrMsg("No valid session found. The link may have expired.");
          setStatus("error");
          return;
        }

        // Upsert customer_portal_users using invite metadata
        const meta = session.user.user_metadata ?? {};
        if (meta.customer_ns_id) {
          await supabase.from("customer_portal_users").upsert({
            id:             session.user.id,
            customer_ns_id: meta.customer_ns_id,
            customer_name:  meta.customer_name ?? "",
            email:          session.user.email ?? "",
            display_name:   session.user.user_metadata?.full_name ?? null,
          }, { onConflict: "id" });
        }

        router.replace("/portal/projects");
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : "Authentication failed");
        setStatus("error");
      }
    }

    handle();
  }, [params, router]);

  if (status === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 15, color: "#4A5568", fontWeight: 600 }}>Signing you in…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 400, padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: "#0D1117", marginBottom: 8 }}>Sign-in failed</div>
        <div style={{ fontSize: 14, color: "#4A5568", marginBottom: 24 }}>{errMsg}</div>
        <p style={{ fontSize: 13, color: "#8A95A3" }}>
          Please contact your CEBA Solutions project manager for a new invitation link.
        </p>
      </div>
    </div>
  );
}

export default function PortalCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 15, color: "#4A5568", fontWeight: 600 }}>Loading…</div>
        </div>
      </div>
    }>
      <CallbackInner />
    </Suspense>
  );
}
