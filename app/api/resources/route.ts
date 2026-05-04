import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, postRecord } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";
import type { NSAllocation } from "@/lib/types";

export const revalidate = 0;

export async function GET() {
  try {
    const rows = await runSuiteQL<{
      id: string;
      employee_id: string;
      project_id: string;
      project_name: string;
      entity_id: string | null;
      remaining_hours: string | null;
      budget_hours: string | null;
      jobtype: string | null;
      startdate: string;
      enddate: string;
      allocationunit: string;
      percentoftime: string;
      numberhours: string;
    }>(`
      SELECT
        ra.id,
        ra.allocationResource                          AS employee_id,
        ra.project                                     AS project_id,
        BUILTIN.DF(ra.project)                         AS project_name,
        j.customer                                     AS entity_id,
        j.custentity_project_remaining_hours           AS remaining_hours,
        j.custentity_ceba_project_budget_hours         AS budget_hours,
        j.jobtype                                      AS jobtype,
        ra.startDate,
        ra.endDate,
        ra.allocationUnit,
        ra.percentOfTime,
        ra.numberHours
      FROM resourceallocation ra
      LEFT JOIN job j ON j.id = ra.project
      WHERE ra.endDate >= SYSDATE
      ORDER BY ra.allocationResource, ra.startDate
    `);

    // Look up client company names for all unique customer IDs
    const entityIds = [...new Set(rows.map(r => r.entity_id).filter(Boolean))] as string[];
    const clientMap: Record<string, string> = {};
    if (entityIds.length > 0) {
      try {
        const custRows = await runSuiteQL<{ id: string; companyname: string }>(`
          SELECT id, companyname FROM customer WHERE id IN (${entityIds.join(",")})
        `);
        if (Array.isArray(custRows)) {
          for (const c of custRows as any[]) {
            clientMap[String(c.id)] = c.companyname || "";
          }
        }
      } catch {
        // Non-fatal — allocations still show without client name prefix
      }
    }

    const allocations: NSAllocation[] = rows.map(r => {
      const empId = parseInt(r.employee_id);
      const jt = parseInt(r.jobtype ?? "0");
      const projectType = jt === 1 ? "Implementation" : jt === 2 ? "Service" : "Internal";
      return {
        id:             r.id,
        employeeId:     empId,
        employeeName:   EMPLOYEES[empId] ?? `Employee #${r.employee_id}`,
        projectId:      parseInt(r.project_id) || 0,
        projectName:    r.project_name || "—",
        projectType,
        companyName:    r.entity_id ? (clientMap[String(r.entity_id)] || "") : "",
        startDate:      r.startdate,
        endDate:        r.enddate,
        allocationUnit: r.allocationunit ?? "H",
        percentOfMax:   parseFloat(r.percentoftime) || 0,
        hoursPerDay:    parseFloat(r.numberhours) || 0,
        remainingHours: r.remaining_hours != null ? parseFloat(r.remaining_hours) : null,
        budgetHours:    r.budget_hours != null ? parseFloat(r.budget_hours) : null,
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

export async function POST(req: NextRequest) {
  try {
    const { employeeId, projectId, startDate, endDate, weeklyHours } = await req.json() as {
      employeeId:  number;
      projectId:   number;
      startDate:   string;   // YYYY-MM-DD
      endDate:     string;   // YYYY-MM-DD
      weeklyHours: number;
    };

    const pct = (weeklyHours / 40) * 100;

    const newId = await postRecord("resourceallocation", {
      allocationResource: { id: String(employeeId) },
      project:            { id: String(projectId)  },
      startDate,
      endDate,
      allocationUnit:     { id: "P" },
      allocationAmount:   pct,
    });

    return NextResponse.json({ id: newId, success: true });
  } catch (err) {
    console.error("[POST /api/resources]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
