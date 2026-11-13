"use client";
import { C } from "@/lib/constants";
import type { ProjectHealth } from "@/lib/types";

interface Props {
  health: ProjectHealth;
  size?: "sm" | "md";
}

const LABELS: Record<ProjectHealth, string> = {
  green:  "On Track",
  yellow: "At Risk",
  red:    "Critical",
  unset:  "Not set",
};

const DOTS: Record<ProjectHealth, string> = {
  green: "🟢", yellow: "🟡", red: "🔴", unset: "⚪",
};

/** Colours for a status. "unset" is neutral grey so nothing reads green by accident. */
export function healthColors(health: ProjectHealth): { color: string; bg: string; bd: string } {
  switch (health) {
    case "green":  return { color: C.green,   bg: C.greenBg,  bd: C.greenBd };
    case "yellow": return { color: C.yellow,  bg: C.yellowBg, bd: C.yellowBd };
    case "red":    return { color: C.red,     bg: C.redBg,    bd: C.redBd };
    default:       return { color: C.textSub, bg: C.alt,      bd: C.border };
  }
}

export const healthLabel = (h: ProjectHealth) => LABELS[h];

function badgeStyle(health: ProjectHealth, size: "sm" | "md"): React.CSSProperties {
  const { color, bg, bd } = healthColors(health);
  return {
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
  };
}

export function HealthBadge({ health, size = "md" }: Props) {
  return (
    <span style={badgeStyle(health, size)}>
      {DOTS[health]} {LABELS[health]}
    </span>
  );
}

/** The badge as a dropdown, for setting the status by hand. */
export function HealthSelect({
  health, onChange, disabled, title, size = "sm",
}: {
  health: ProjectHealth;
  onChange: (h: ProjectHealth) => void;
  disabled?: boolean;
  title?: string;
  size?: "sm" | "md";
}) {
  return (
    <select
      value={health}
      disabled={disabled}
      title={title}
      onChange={e => onChange(e.target.value as ProjectHealth)}
      onClick={e => e.stopPropagation()}
      style={{ ...badgeStyle(health, size), cursor: disabled ? "default" : "pointer", fontFamily: C.font, opacity: disabled ? 0.6 : 1 }}
    >
      {(["green", "yellow", "red", "unset"] as ProjectHealth[]).map(h => (
        <option key={h} value={h}>{DOTS[h]} {LABELS[h]}</option>
      ))}
    </select>
  );
}
