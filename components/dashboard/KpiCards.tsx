"use client";
import { C } from "@/lib/constants";
import type { Project } from "@/lib/types";

interface Props {
  projects: Project[];
}

export function KpiCards({ projects }: Props) {
  const red     = projects.filter(p => p.health === "red").length;
  const yellow  = projects.filter(p => p.health === "yellow").length;
  const blocked = projects.reduce((s, p) => s + p.blocked.length, 0);
  const client  = projects.reduce((s, p) => s + p.clientPending.length, 0);

  const cards = [
    {
      label: "Active Projects",
      value: projects.length,
      color: C.blue,
      bg:    C.blueBg,
      bd:    C.blueBd,
      icon:  "📊",
    },
    {
      label: "Critical",
      value: red,
      color: red > 0 ? C.red : C.textSub,
      bg:    red > 0 ? C.redBg : C.alt,
      bd:    red > 0 ? C.redBd : C.border,
      icon:  "🔴",
    },
    {
      label: "At Risk",
      value: yellow,
      color: yellow > 0 ? C.yellow : C.textSub,
      bg:    yellow > 0 ? C.yellowBg : C.alt,
      bd:    yellow > 0 ? C.yellowBd : C.border,
      icon:  "🟡",
    },
    {
      label: "Blocked Tasks",
      value: blocked,
      color: blocked > 0 ? C.red : C.textSub,
      bg:    blocked > 0 ? C.redBg : C.alt,
      bd:    blocked > 0 ? C.redBd : C.border,
      icon:  "⚠",
    },
    {
      label: "Client Pending",
      value: client,
      color: client > 0 ? C.orange : C.textSub,
      bg:    client > 0 ? C.orangeBg : C.alt,
      bd:    client > 0 ? C.orangeBd : C.border,
      icon:  "👤",
    },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(5, 1fr)",
      gap: 12,
      marginBottom: 20,
    }}>
      {cards.map(c => (
        <div
          key={c.label}
          style={{
            background: c.bg,
            border: `1px solid ${c.bd}`,
            borderRadius: 8,
            padding: "14px 16px",
            boxShadow: C.sh,
          }}
        >
          <div style={{ fontSize: 20, marginBottom: 4 }}>{c.icon}</div>
          <div style={{ fontFamily: C.mono, fontSize: 24, fontWeight: 700, color: c.color }}>
            {c.value}
          </div>
          <div style={{ fontSize: 12, color: C.textMid, fontWeight: 500, marginTop: 2 }}>
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
}
