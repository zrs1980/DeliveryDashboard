"use client";
import { C } from "@/lib/constants";

type Health = "green" | "yellow" | "red";

interface Props {
  health: Health;
  score?: number;
  size?: "sm" | "md";
}

const LABELS: Record<Health, string> = {
  green:  "On Track",
  yellow: "At Risk",
  red:    "Critical",
};

export function HealthBadge({ health, score, size = "md" }: Props) {
  const color = health === "green" ? C.green : health === "yellow" ? C.yellow : C.red;
  const bg    = health === "green" ? C.greenBg : health === "yellow" ? C.yellowBg : C.redBg;
  const bd    = health === "green" ? C.greenBd : health === "yellow" ? C.yellowBd : C.redBd;
  const dot   = health === "green" ? "🟢" : health === "yellow" ? "🟡" : "🔴";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: 600,
        color,
        background: bg,
        border: `1px solid ${bd}`,
        borderRadius: 4,
        padding: size === "sm" ? "1px 5px" : "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {dot} {LABELS[health]}{score !== undefined ? ` (${score})` : ""}
    </span>
  );
}
