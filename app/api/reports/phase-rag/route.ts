import { NextResponse } from "next/server";
import { fetchAllPhases } from "@/lib/netsuite";
import { phaseBudgetRAG, isPhaseRow, canonicalPhase } from "@/lib/health";
import type { ProjectPhase } from "@/lib/types";

export const revalidate = 0;

export async function GET() {
  try {
    const rows = await fetchAllPhases();

    const phases: ProjectPhase[] = rows
      .filter(r => isPhaseRow(r.phase_name))
      .map(r => {
        const budgetedHours = parseFloat(r.budgeted_hours) || 0;
        const actualHours   = parseFloat(r.actual_hours)   || 0;

        const phase: ProjectPhase = {
          phaseId:       parseInt(r.phase_id),
          projectId:     parseInt(r.project_id),
          projectNumber: r.project_number,
          client:        r.client,
          phaseName:     canonicalPhase(r.phase_name) ?? r.phase_name,
          phaseStart:    null,  // not available via SuiteQL
          phaseEnd:      null,  // not available via SuiteQL
          budgetedHours,
          actualHours,
          remainingHours: budgetedHours - actualHours,
          pctComplete:   0,     // not available via SuiteQL
          phaseStatus:   r.phase_status,
          timelineRAG:   "grey", // requires REST Record API
          budgetRAG:     phaseBudgetRAG({ budgetedHours, actualHours }),
        };

        return phase;
      });

    return NextResponse.json({ phases, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/reports/phase-rag]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
