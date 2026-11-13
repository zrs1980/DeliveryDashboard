import type { ProjectPhase } from "./types";

// Project status (On Track / At Risk / Critical) is set by hand on the Projects
// tab — see supabase/project-status.sql. There is no computed health score.

export function phaseTimelineRAG(
  phase: { phaseStart: string | null; phaseEnd: string | null; pctComplete: number },
  today: Date
): "green" | "yellow" | "red" | "grey" {
  if (!phase.phaseStart || !phase.phaseEnd) return "grey";
  const start = new Date(phase.phaseStart);
  const end   = new Date(phase.phaseEnd);
  if (start > today)              return "grey";
  if (phase.pctComplete >= 1.0)   return "green";
  if (end < today)                return "red";
  const daysLeft  = (end.getTime() - today.getTime()) / 86400000;
  const totalDays = (end.getTime() - start.getTime()) / 86400000;
  const timeElapsedPct = 1 - daysLeft / totalDays;
  if (daysLeft <= 7)                                 return "yellow";
  if (timeElapsedPct > 0.75 && phase.pctComplete < 0.5) return "yellow";
  return "green";
}

export function phaseBudgetRAG(
  phase: { budgetedHours: number; actualHours: number }
): "green" | "yellow" | "red" | "grey" {
  if (!phase.budgetedHours || phase.budgetedHours === 0) return "grey";
  const ratio = phase.actualHours / phase.budgetedHours;
  if (ratio <= 0.9)  return "green";
  if (ratio <= 1.10) return "yellow";
  return "red";
}

// ─── Phase name → canonical phase number ─────────────────────────────────────

const PHASE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /phase\s*1|planning|design/i,      label: "Phase 1" },
  { re: /phase\s*2|config|testing/i,       label: "Phase 2" },
  { re: /phase\s*3|training|uat/i,         label: "Phase 3" },
  { re: /phase\s*4|readiness/i,            label: "Phase 4" },
  { re: /phase\s*5|go.?live/i,             label: "Phase 5" },
  { re: /pm|project\s*management/i,        label: "PM" },
];

export function canonicalPhase(title: string): string | null {
  for (const { re, label } of PHASE_PATTERNS) {
    if (re.test(title)) return label;
  }
  return null;
}

export function isPhaseRow(title: string): boolean {
  return canonicalPhase(title) !== null;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export const fmtN   = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(1);
export const fmtH   = (n: number) => fmtN(n) + "h";
export const fmtPct = (n: number) => Math.round(n * 100) + "%";
export const fmtD   = (n: number | null) =>
  n === null ? "No date" :
  n < 0  ? `${Math.abs(n)}d overdue` :
  n === 0 ? "Today" : `${n}d left`;
