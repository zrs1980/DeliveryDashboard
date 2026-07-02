import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, postRecord, getActiveJobResources, fetchRecord } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";
import type { NSAllocation } from "@/lib/types";

export const revalidate = 0;

export async function GET() {
  try {
    const [rows, jobResources] = await Promise.all([
      runSuiteQL<{
      id: string;
      employee_id: string;
      project_id: string;
      project_name: string;
      entity_id: string | null;
      remaining_hours: string | null;
      budget_hours: string | null;
      jobtype: string | null;
      jobtype_name: string | null;
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
        BUILTIN.DF(j.jobtype)                          AS jobtype_name,
        ra.startDate,
        ra.endDate,
        ra.allocationUnit,
        ra.percentOfTime,
        ra.numberHours
      FROM resourceallocation ra
      LEFT JOIN job j ON j.id = ra.project
      WHERE ra.endDate >= SYSDATE
      ORDER BY ra.allocationResource, ra.startDate
    `),
      getActiveJobResources().catch(() => ({} as Awaited<ReturnType<typeof getActiveJobResources>>)),
    ]);

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

    // Fetch classify flags via REST Record API (SuiteQL exposes these as NOT_EXPOSED for job)
    // Parallel fetch one record per unique project — typically 5-10 projects max
    const uniqueProjectIds = [...new Set(rows.map(r => r.project_id))];
    const classifyMap: Record<string, { utilized: boolean; productive: boolean }> = {};
    if (uniqueProjectIds.length > 0) {
      await Promise.all(uniqueProjectIds.map(async (pid, idx) => {
        try {
          const rec = await fetchRecord<Record<string, unknown>>("job", parseInt(pid));
          // Log raw field names on first project to aid debugging in Vercel logs
          if (idx === 0) {
            const classifyKeys = Object.keys(rec).filter(k => k.toLowerCase().includes("classify") || k.toLowerCase().includes("utilized") || k.toLowerCase().includes("productive"));
            console.log("[resources] job REST record classify-related fields:", classifyKeys, "values:", classifyKeys.reduce((o, k) => ({ ...o, [k]: rec[k] }), {}));
          }
          // NS REST API returns camelCase field names; checkbox values are booleans
          const utilized   = rec["classifyTimeAsUtilized"]   ?? rec["classifytimeasutilized"];
          const productive = rec["classifyTimeAsProductive"] ?? rec["classifytimeasproductive"];
          classifyMap[pid] = {
            utilized:   utilized   !== false && utilized   !== "F",
            productive: productive !== false && productive !== "F",
          };
        } catch {
          // Non-fatal — project defaults to utilized/productive = true
        }
      }));
    }

    // Look up names for any employee IDs not in the hardcoded constant
    const unknownEmpIds = [...new Set(
      rows.map(r => parseInt(r.employee_id)).filter(id => !EMPLOYEES[id])
    )];
    const empNameMap: Record<number, string> = { ...EMPLOYEES };
    if (unknownEmpIds.length > 0) {
      try {
        const empRows = await runSuiteQL<{ id: string; firstname: string; lastname: string }>(`
          SELECT id, firstname, lastname FROM employee WHERE id IN (${unknownEmpIds.join(",")})
        `);
        if (Array.isArray(empRows)) {
          for (const e of empRows as any[]) {
            const name = `${e.firstname ?? ""} ${e.lastname ?? ""}`.trim();
            if (name) empNameMap[parseInt(e.id)] = name;
          }
        }
      } catch {
        // Non-fatal — falls back to "Employee #ID"
      }
    }

    const allocations: NSAllocation[] = rows.map(r => {
      const empId = parseInt(r.employee_id);
      const jt = parseInt(r.jobtype ?? "0");
      const jtName = (r.jobtype_name ?? "").toLowerCase();
      const projectType = (jt === 1 || jtName.includes("consulting")) ? "Implementation" : jt === 2 ? "Service" : "Internal";
      return {
        id:             r.id,
        employeeId:     empId,
        employeeName:   empNameMap[empId] ?? `Employee #${r.employee_id}`,
        projectId:      parseInt(r.project_id) || 0,
        projectName:    r.project_name || "—",
        projectType,
        companyName:    r.entity_id ? (clientMap[String(r.entity_id)] || "") : "",
        startDate:      r.startdate,
        endDate:        r.enddate,
        allocationUnit: r.allocationunit ?? "H",
        percentOfMax:   parseFloat(r.percentoftime) || 0,
        hoursPerDay:    parseFloat(r.numberhours) || 0,
        remainingHours:    r.remaining_hours != null ? parseFloat(r.remaining_hours) : null,
        budgetHours:       r.budget_hours != null ? parseFloat(r.budget_hours) : null,
        targetUtilization:   jobResources[empId]?.targetUtilization ?? 0.75,
        classifyAsUtilized:   classifyMap[r.project_id]?.utilized   ?? true,
        classifyAsProductive: classifyMap[r.project_id]?.productive ?? true,
      };
    });

    // Build consultant roster (custentity10 IN (1,2)) for Forecast team targets
    // Includes all active consultants even if they have no current allocations
    const consultantRoster: Array<{ employeeId: number; name: string; targetUtilization: number }> = [];
    try {
      const rosterRows = await runSuiteQL<{ id: string; firstname: string; lastname: string; targetutilization: string | null }>(
        `SELECT id, firstname, lastname, targetutilization FROM employee WHERE isinactive = 'F' AND custentity10 IN (1, 2) ORDER BY lastname, firstname`
      );
      if (Array.isArray(rosterRows)) {
        for (const r of rosterRows as any[]) {
          const name = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
          if (!name) continue;
          const raw = r.targetutilization !== null && r.targetutilization !== "" ? parseFloat(r.targetutilization) : NaN;
          const tgt = !isNaN(raw) ? (raw > 1 ? raw / 100 : raw) : 0.75;
          consultantRoster.push({ employeeId: parseInt(r.id), name, targetUtilization: tgt });
        }
      }
    } catch {
      // Non-fatal — Forecast tab falls back to allocation-only data
    }

    return NextResponse.json({ allocations, consultantRoster, updatedAt: new Date().toISOString() });
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
