import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, postRecord, getActiveJobResources, fetchBillableHours, fetchActualHours } from "@/lib/netsuite";
import { EMPLOYEES, isFixedFeeProject } from "@/lib/constants";
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
      is_utilized_time: string | null;
      is_productive_time: string | null;
      is_billable: string | null;
      job_billing_type: string | null;
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
        j.isutilizedtime                               AS is_utilized_time,
        j.isproductivetime                             AS is_productive_time,
        j.custentity_ceba_is_billable                  AS is_billable,
        j.jobbillingtype                               AS job_billing_type,
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

    // Billable time logged per project — the basis for remaining budget below.
    // Non-fatal: if this fails, every project reports 0 billable and remaining
    // budget reads as the full budget, which is visibly wrong rather than
    // subtly wrong, so it can't be mistaken for real headroom.
    const allocProjectIds = [...new Set(rows.map(r => parseInt(r.project_id)).filter(Boolean))];
    const billableByProject: Record<string, number> = {};
    const actualByProject:   Record<string, number> = {};
    try {
      const [bill, act] = await Promise.all([
        fetchBillableHours(allocProjectIds),
        fetchActualHours(allocProjectIds),
      ]);
      for (const b of bill) billableByProject[String(b.project_id)] = parseFloat(b.billable_hours) || 0;
      for (const a of act)  actualByProject[String(a.project_id)]   = parseFloat(a.actual_hours)   || 0;
    } catch {
      // leave empty
    }

    // The PM's allocation commentary, kept as a User Note on the NetSuite project
    // (Communication → User Notes) rather than on the allocation records themselves.
    //
    // ONLY notes titled "Resource Allocation Note" are read. The same table holds
    // client email threads, budget-approval requests and internal action items — none
    // of which belong on this tab, and some of which are customer correspondence. An
    // unfiltered read would publish them straight onto the dashboard.
    //
    // Non-fatal: on failure the notes are simply absent, which loses context but never
    // shows the wrong note against a project.
    const RESOURCE_NOTE_TITLE = "Resource Allocation Note";
    const noteByProject: Record<string, string> = {};
    if (allocProjectIds.length > 0) {
      try {
        const noteRows = await runSuiteQL<{ entity: string; note: string | null; title: string | null }>(`
          SELECT entity, title, note, notedate
          FROM entitynote
          WHERE entity IN (${allocProjectIds.join(",")})
            AND UPPER(TRIM(title)) = '${RESOURCE_NOTE_TITLE.toUpperCase()}'
          ORDER BY notedate DESC, id DESC
        `);
        if (Array.isArray(noteRows)) {
          // A project normally has exactly one. If a PM adds more, join them newest-first
          // rather than silently picking one and hiding the rest.
          const seen: Record<string, Set<string>> = {};
          for (const n of noteRows as any[]) {
            const body = (n.note ?? "").trim();
            if (!body) continue;
            const key = String(n.entity);
            (seen[key] ??= new Set());
            if (seen[key].has(body.toLowerCase())) continue;
            seen[key].add(body.toLowerCase());
            noteByProject[key] = noteByProject[key] ? `${noteByProject[key]} · ${body}` : body;
          }
        }
      } catch {
        // leave empty
      }
    }

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
      // Pass NetSuite's own jobtype display name straight through. The previous
      // mapping collapsed everything that wasn't jobtype 1 or 2 into "Internal",
      // which hid Managed Services Agreement, Technical Services and Training
      // inside the internal band. Falls back to the numeric jobtype only when the
      // display name is missing.
      const jt        = parseInt(r.jobtype ?? "0");
      const jtName    = (r.jobtype_name ?? "").trim();
      const projectType = jtName !== ""
        ? jtName
        : jt === 1 ? "Implementation" : jt === 2 ? "Service" : "Internal";

      const projectId     = parseInt(r.project_id);
      const billableHours = billableByProject[String(r.project_id)] ?? 0;
      const actualHours   = actualByProject[String(r.project_id)]   ?? 0;
      const isFixedFee    = isFixedFeeProject(projectId, r.job_billing_type);
      const consumedHours = isFixedFee ? actualHours : billableHours;

      return {
        id:             r.id,
        employeeId:     empId,
        employeeName:   empNameMap[empId] ?? `Employee #${r.employee_id}`,
        projectId:      parseInt(r.project_id) || 0,
        projectName:    r.project_name || "—",
        projectType,
        companyName:    r.entity_id ? (clientMap[String(r.entity_id)] || "") : "",
        // Project-level, so every allocation row of a project carries the same value.
        resourceNote:   noteByProject[String(r.project_id)] ?? null,
        startDate:      r.startdate,
        endDate:        r.enddate,
        allocationUnit: r.allocationunit ?? "H",
        percentOfMax:   parseFloat(r.percentoftime) || 0,
        hoursPerDay:    parseFloat(r.numberhours) || 0,
        // Remaining budget is DERIVED from time logged, not read from
        // custentity_project_remaining_hours. That field is hand-maintained and
        // drifts: project 268 carried -626h against a 0h budget. Where the field
        // is kept up to date the two agree exactly, so this mostly changes
        // nothing and corrects the stale ones.
        //
        // Which hours count depends on the engagement. On time & materials it's
        // billable hours. On a FIXED FEE project the client isn't billed per
        // hour, so consultants log time as non-billable by design — counting
        // billable only would mean nothing is ever consumed and the project
        // reads as fully unspent however much work goes in. There, all actual
        // time counts.
        //
        // Null budget stays null rather than becoming 0 − consumed: "no budget
        // set" and "nothing left" must not look the same.
        remainingHours:    r.budget_hours != null ? parseFloat(r.budget_hours) - consumedHours : null,
        budgetHours:       r.budget_hours != null ? parseFloat(r.budget_hours) : null,
        billableHours,
        actualHours,
        consumedHours,
        isFixedFee,
        targetUtilization:   jobResources[empId]?.targetUtilization ?? 0.75,
        // Time classification comes straight off the NetSuite project record — never
        // inferred from jobtype. A project's type says nothing about whether its time
        // counts as billable/utilized/productive (e.g. Managed Services Agreement 268
        // is typed "Internal" but is both utilized and productive).
        // NOTE: SuiteQL omits a checkbox column entirely when the field was never set,
        //       so an absent value is treated the same as "F".
        classifyAsUtilized:   r.is_utilized_time   === "T",
        classifyAsProductive: r.is_productive_time === "T",
        classifyAsBillable:   r.is_billable        === "T",
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
