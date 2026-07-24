import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, postRecord, getActiveJobResources, fetchRecord } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";
import type { NSAllocation } from "@/lib/types";

export const revalidate = 0;

export async function GET() {
  try {
    const [rowsRaw, jobResources] = await Promise.all([
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

    // Drop allocation records belonging to inactive employees. Departed staff
    // (e.g. Adam Filsinger) can still have resourceallocation records with a
    // future endDate; those should not surface on the dashboard.
    // NOTE: don't JOIN the employee table in SuiteQL (documented restriction) —
    //       do a standalone status lookup and filter in code instead.
    const allocEmpIds = [...new Set(rowsRaw.map(r => parseInt(r.employee_id)).filter(Boolean))];
    const inactiveEmpIds = new Set<number>();
    if (allocEmpIds.length > 0) {
      try {
        const statusRows = await runSuiteQL<{ id: string; isinactive: string }>(
          `SELECT id, isinactive FROM employee WHERE id IN (${allocEmpIds.join(",")})`
        );
        if (Array.isArray(statusRows)) {
          for (const e of statusRows as any[]) {
            if (e.isinactive === "T" || e.isinactive === true) inactiveEmpIds.add(parseInt(e.id));
          }
        }
      } catch {
        // Non-fatal — if the status lookup fails, show all allocations rather
        // than incorrectly hiding active resources.
      }
    }
    const rows = rowsRaw.filter(r => !inactiveEmpIds.has(parseInt(r.employee_id)));

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
          // Log ALL field keys on first project so we can identify the correct classify field names
          if (idx === 0) {
            console.log("[resources] job REST fields (all):", Object.keys(rec).sort().join(", "));
          }
          // Try multiple possible camelCase field names for the Preferences tab checkboxes
          const utilizedRaw   = rec["classifyTimeAsUtilized"]   ?? rec["classifytimeasutilized"]
                              ?? rec["classifyTimeasUtilized"]   ?? rec["classifytime"];
          const productiveRaw = rec["classifyTimeAsProductive"] ?? rec["classifytimeasproductive"]
                              ?? rec["classifyTimeasProductive"];
          console.log(`[resources] project ${pid} classify fields: utilized=${utilizedRaw} productive=${productiveRaw}`);
          // Only populate classifyMap if we actually found the fields (undefined = field not in response)
          if (utilizedRaw !== undefined || productiveRaw !== undefined) {
            classifyMap[pid] = {
              utilized:   utilizedRaw   !== false && utilizedRaw   !== "F",
              productive: productiveRaw !== false && productiveRaw !== "F",
            };
          }
          // If neither field found, classifyMap stays empty for this project → falls back to project-type default below
        } catch (e) {
          console.warn(`[resources] REST fetch failed for job ${pid}:`, e instanceof Error ? e.message : e);
        }
      }));
    }

    // Build consultant roster first — used both for Forecast team targets and to resolve employee names
    const consultantRoster: Array<{ employeeId: number; name: string; targetUtilization: number }> = [];
    const empNameMap: Record<number, string> = { ...EMPLOYEES };
    try {
      const rosterRows = await runSuiteQL<{ id: string; firstname: string; lastname: string; targetutilization: string | null }>(
        `SELECT id, firstname, lastname, targetutilization FROM employee WHERE isinactive = 'F' AND custentity10 IN (1, 2) ORDER BY lastname, firstname`
      );
      if (Array.isArray(rosterRows)) {
        for (const r of rosterRows as any[]) {
          const name = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
          if (!name) continue;
          const empId = parseInt(r.id);
          empNameMap[empId] = name;
          const raw = r.targetutilization !== null && r.targetutilization !== "" ? parseFloat(r.targetutilization) : NaN;
          const tgt = !isNaN(raw) ? (raw > 1 ? raw / 100 : raw) : 0.75;
          consultantRoster.push({ employeeId: empId, name, targetUtilization: tgt });
        }
      }
    } catch {
      // Non-fatal — falls back to EMPLOYEES constant for name lookup
    }

    // Look up names for any allocation employees still not resolved (non-consultant staff, vendors, etc.)
    const unknownEmpIds = [...new Set(
      rows.map(r => parseInt(r.employee_id)).filter(id => !empNameMap[id])
    )];
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
        // Default: Internal projects are NOT utilized/productive; client projects are
        classifyAsUtilized:   classifyMap[r.project_id]?.utilized   ?? (projectType !== "Internal"),
        classifyAsProductive: classifyMap[r.project_id]?.productive ?? (projectType !== "Internal"),
      };
    });

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
