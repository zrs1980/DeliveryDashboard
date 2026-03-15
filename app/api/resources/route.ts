import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";
import type { NSAllocation } from "@/lib/types";

export const revalidate = 0;

export async function GET() {
  try {
    const rows = await runSuiteQL<{
      id: string;
      employee_id: string;
      project_name: string;
      startDate: string;
      endDate: string;
      allocationUnit: string;
      percentOfTime: string;
      numberHours: string;
    }>(`
      SELECT
        ra.id,
        ra.allocationResource      AS employee_id,
        BUILTIN.DF(ra.project)     AS project_name,
        ra.startDate,
        ra.endDate,
        ra.allocationUnit,
        ra.percentOfTime,
        ra.numberHours
      FROM resourceallocation ra
      WHERE ra.endDate >= SYSDATE
      ORDER BY ra.allocationResource, ra.startDate
    `);

    const allocations: NSAllocation[] = rows.map(r => {
      const empId = parseInt(r.employee_id);
      return {
        id:             r.id,
        employeeId:     empId,
        employeeName:   EMPLOYEES[empId] ?? `Employee #${r.employee_id}`,
        projectName:    r.project_name || "—",
        startDate:      r.startDate,
        endDate:        r.endDate,
        allocationUnit: r.allocationUnit ?? "1",
        percentOfMax:   parseFloat(r.percentOfTime) || 0,
        hoursPerDay:    parseFloat(r.numberHours) || 0,
      };
    });

    return NextResponse.json({ allocations, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/resources]", err);
    return NextResponse.json({
      allocations: [],
      error: err instanceof Error ? err.message : "Unknown error",
      updatedAt: new Date().toISOString(),
    });
  }
}
