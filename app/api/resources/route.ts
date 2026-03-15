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
      startdate: string;
      enddate: string;
      allocationunit: string;
      percentofmax: string;
      numberofunits: string;
    }>(`
      SELECT
        ra.id,
        ra.resource                AS employee_id,
        BUILTIN.DF(ra.project)     AS project_name,
        ra.startdate,
        ra.enddate,
        ra.allocationunit,
        ra.percentofmax,
        ra.numberofunits
      FROM resourceallocation ra
      WHERE ra.enddate >= SYSDATE
      ORDER BY ra.resource, ra.startdate
    `);

    const allocations: NSAllocation[] = rows.map(r => {
      const empId = parseInt(r.employee_id);
      return {
        id:             r.id,
        employeeId:     empId,
        employeeName:   EMPLOYEES[empId] ?? `Employee #${r.employee_id}`,
        projectName:    r.project_name || "—",
        startDate:      r.startdate,
        endDate:        r.enddate,
        allocationUnit: r.allocationunit ?? "1",
        percentOfMax:   parseFloat(r.percentofmax) || 0,
        hoursPerDay:    parseFloat(r.numberofunits) || 0,
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
