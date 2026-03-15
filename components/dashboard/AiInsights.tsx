"use client";
import { useState, useEffect } from "react";
import type { Project } from "@/lib/types";
import { C } from "@/lib/constants";

interface Props {
  projects: Project[];
}

export function AiInsights({ projects }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [text, setText]       = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const target = selectedId ? projects.filter(p => p.id === selectedId) : projects;

  useEffect(() => {
    setText(null);
  }, [selectedId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setText(data.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function renderLine(line: string, i: number) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const isBullet = /^[-•*]|^\d+\./.test(trimmed);
    const isHeader = trimmed.endsWith(":") || /^\*\*.+\*\*$/.test(trimmed);

    if (isHeader) {
      return (
        <p key={i} style={{ fontWeight: 700, color: "#F1F5F9", marginTop: 10, marginBottom: 4, fontSize: 13 }}>
          {trimmed.replace(/\*\*/g, "")}
        </p>
      );
    }

    if (isBullet) {
      return (
        <p key={i} style={{ display: "flex", gap: 6, margin: "3px 0", fontSize: 13, color: "#CBD5E1" }}>
          <span style={{ color: "#60A5FA", flexShrink: 0 }}>→</span>
          <span>{trimmed.replace(/^[-•*]\s*|^\d+\.\s*/, "")}</span>
        </p>
      );
    }

    return (
      <p key={i} style={{ fontSize: 13, color: "#CBD5E1", margin: "3px 0" }}>
        {trimmed}
      </p>
    );
  }

  const selectedProject = selectedId ? projects.find(p => p.id === selectedId) : null;
  const titleLabel = selectedProject ? selectedProject.client : "Portfolio";

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0F172A, #1A3052)",
        borderRadius: 10,
        padding: "16px 20px",
        marginBottom: 20,
        border: "1px solid #1E3A5F",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>✨</span>
          <span style={{ fontWeight: 700, color: "#F1F5F9", fontSize: 14, fontFamily: C.font }}>
            AI Insights — {titleLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={selectedId ?? ""}
            onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 5,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.text,
              fontFamily: C.font,
              cursor: "pointer",
            }}
          >
            <option value="">Portfolio (All Projects)</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.client}</option>
            ))}
          </select>
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              background: loading ? "#1E3A5F" : "#1A56DB",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: C.font,
            }}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ color: "#F87171", fontSize: 13 }}>Error: {error}</p>
      )}

      {!text && !loading && !error && (
        <p style={{ color: "#64748B", fontSize: 13, fontStyle: "italic" }}>
          Click Refresh to generate AI insights for {selectedId ? "this project" : "the full portfolio"}.
        </p>
      )}

      {loading && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{
            width: 12, height: 12, borderRadius: "50%",
            border: "2px solid #60A5FA", borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }} />
          <span style={{ color: "#94A3B8", fontSize: 13 }}>Analyzing…</span>
        </div>
      )}

      {text && !loading && (
        <div>
          {text.split("\n").map((line, i) => renderLine(line, i))}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
