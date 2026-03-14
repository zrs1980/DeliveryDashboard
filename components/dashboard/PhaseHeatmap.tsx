"use client";
import { C } from "@/lib/constants";
import { isPhaseRow, canonicalPhase } from "@/lib/health";
import type { ProjectPhase } from "@/lib/types";

const PHASES = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "PM"];

interface Props {
  phases: ProjectPhase[];
  projects: { id: number; client: string; entityid: string }[];
}

function cellBg(pct: number | null): string {
  if (pct === null) return "transparent";
  if (pct === 0)    return "#F3F4F6";
  if (pct >= 0.9)   return "#DCFCE7";
  if (pct >= 0.5)   return "#FEF9C3";
  return "#FEE2E2";
}

export function PhaseHeatmap({ phases, projects }: Props) {
  // Build map: projectId → phase label → avg pct
  const map: Record<number, Record<string, { budget: number; actual: number; count: number }>> = {};

  for (const ph of phases) {
    if (!map[ph.projectId]) map[ph.projectId] = {};
    const key = ph.phaseName;
    if (!map[ph.projectId][key]) map[ph.projectId][key] = { budget: 0, actual: 0, count: 0 };
    map[ph.projectId][key].budget += ph.budgetedHours;
    map[ph.projectId][key].actual += ph.actualHours;
    map[ph.projectId][key].count  += 1;
  }

  const th: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: C.textSub,
    textTransform: "uppercase" as const,
    borderBottom: `1px solid ${C.border}`,
    textAlign: "center" as const,
    letterSpacing: "0.04em",
  };

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 10, fontFamily: C.font }}>
        Phase Completion Heatmap
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
          <thead>
            <tr style={{ background: C.alt }}>
              <th style={{ ...th, textAlign: "left" }}>Client — Project</th>
              {PHASES.map(ph => <th key={ph} style={th}>{ph}</th>)}
            </tr>
          </thead>
          <tbody>
            {projects.map((proj, i) => {
              const phaseData = map[proj.id] ?? {};
              return (
                <tr key={proj.id} style={{ background: i % 2 === 0 ? C.surface : C.alt }}>
                  <td style={{ padding: "8px 10px", fontSize: 12, color: C.text, fontWeight: 500, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
                    {proj.client} <span style={{ color: C.textSub }}>#{proj.entityid}</span>
                  </td>
                  {PHASES.map(ph => {
                    const d = phaseData[ph];
                    if (!d) {
                      return (
                        <td key={ph} style={{ padding: "8px 10px", textAlign: "center", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textSub }}>
                          —
                        </td>
                      );
                    }
                    const pct = d.budget > 0 ? Math.min(d.actual / d.budget, 1) : 0;
                    const bg  = cellBg(pct);
                    return (
                      <td
                        key={ph}
                        style={{
                          padding: "8px 10px",
                          textAlign: "center",
                          background: bg,
                          borderBottom: `1px solid ${C.border}`,
                          fontFamily: C.mono,
                          fontSize: 12,
                          fontWeight: 600,
                          color: C.textMid,
                        }}
                        title={`${ph}: ${d.actual}h / ${d.budget}h budgeted`}
                      >
                        {Math.round(pct * 100)}%
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, color: C.textSub }}>
        <span>🟢 ≥90%</span>
        <span>🟡 50–89%</span>
        <span>🔴 &lt;50% active</span>
        <span>⬜ Not started</span>
        <span>— No tasks</span>
      </div>
    </div>
  );
}
