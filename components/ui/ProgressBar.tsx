"use client";
import { C } from "@/lib/constants";

interface Props {
  val: number;   // 0–1 completion
  burn: number;  // 0–1 burn rate marker
  color: string;
  h?: number;
}

export function ProgressBar({ val, burn, color, h = 6 }: Props) {
  const pct   = Math.min(Math.max(val,  0), 1) * 100;
  const bPct  = Math.min(Math.max(burn, 0), 1) * 100;

  return (
    <div
      style={{
        position: "relative",
        height: h,
        background: C.border,
        borderRadius: 3,
        overflow: "visible",
        width: "100%",
      }}
    >
      {/* Fill */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: "100%",
          width: `${pct}%`,
          background: color,
          borderRadius: 3,
          transition: "width 0.3s ease",
        }}
      />
      {/* Burn rate marker */}
      <div
        style={{
          position: "absolute",
          top: -2,
          left: `${bPct}%`,
          width: 2,
          height: h + 4,
          background: C.red,
          borderRadius: 1,
          transform: "translateX(-50%)",
        }}
        title={`Burn rate: ${Math.round(bPct)}%`}
      />
    </div>
  );
}
