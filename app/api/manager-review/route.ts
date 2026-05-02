import { NextRequest, NextResponse } from "next/server";
import { runSuiteQLAll } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

export const revalidate = 0;

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(d.getDate() + diff);
  return mon;
}

function toNSDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

interface EntryRow {
  id:             string;
  employee:       string;
  project_id:     string | null;
  date:           string;
  hours:          string;
  memo:           string | null;
  isbillable:     string;
  approvalstatus: string | null;
}

interface AllocRow {
  id:           string;
  employee_id:  string;
  project_id:   string;
  company_name: string | null;  // BUILTIN.DF(customer) — client name
  project_name: string | null;  // job.companyname — project name
  start_date:   string;
  end_date:     string;
  pct:          string;   // percentOfTime
  hrs:          string;   // numberHours (per day)
}

interface JobRow {
  id:          string;
  companyname: string;   // BUILTIN.DF(customer) — client name
  projectname: string;   // raw companyname — project name
  entityid:    string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period    = searchParams.get("period") ?? "thisMonth";
  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const thisMonday         = getMondayOfWeek(now);
  const lastMonday         = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday         = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1); lastSunday.setHours(23, 59, 59, 999);
  const firstOfMonth       = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMonth   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDayLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const currentQuarter     = Math.floor(now.getMonth() / 3);
  const firstOfThisQuarter = new Date(now.getFullYear(), currentQuarter * 3, 1);

  const periodRanges: Record<string, [Date, Date]> = {
    thisWeek:    [thisMonday,         today],
    lastWeek:    [lastMonday,         lastSunday],
    thisMonth:   [firstOfMonth,       today],
    lastMonth:   [firstOfLastMonth,   lastDayLastMonth],
    thisQuarter: [firstOfThisQuarter, today],
  };

  let from: Date, to: Date;
  if (fromParam && toParam) {
    from = new Date(fromParam + "T00:00:00");
    to   = new Date(toParam   + "T23:59:59");
  } else {
    [from, to] = periodRanges[period] ?? periodRanges.thisMonth;
  }

  const empList = Object.keys(EMPLOYEES).join(", ");

  try {
    const [entryRows, allocRows, jobRows] = await Promise.all([
      // Individual time entries — used for both actuals aggregation and drill-down
      runSuiteQLAll<EntryRow>(`
        SELECT
          tb.id,
          tb.employee,
          tb.customer       AS project_id,
          tb.trandate       AS date,
          tb.hours,
          tb.memo,
          tb.isbillable,
          tb.approvalstatus
        FROM timebill tb
        WHERE tb.employee IN (${empList})
          AND tb.trandate >= TO_DATE('${toNSDate(from)}', 'MM/DD/YYYY')
          AND tb.trandate <= TO_DATE('${toNSDate(to)}',   'MM/DD/YYYY')
          AND tb.timetype = 'A'
        ORDER BY tb.employee, tb.trandate ASC, tb.id ASC
      `),
      // Allocations that overlap the period (not just future ones)
      runSuiteQLAll<AllocRow>(`
        SELECT
          ra.id,
          ra.allocationResource       AS employee_id,
          ra.project                  AS project_id,
          BUILTIN.DF(j.customer)      AS company_name,
          j.companyname               AS project_name,
          ra.startDate                AS start_date,
          ra.endDate                  AS end_date,
          ra.percentOfTime            AS pct,
          ra.numberHours              AS hrs
        FROM resourceallocation ra
        LEFT JOIN job j ON j.id = ra.project
        WHERE ra.allocationResource IN (${empList})
          AND ra.startDate <= TO_DATE('${toNSDate(to)}',   'MM/DD/YYYY')
          AND ra.endDate   >= TO_DATE('${toNSDate(from)}', 'MM/DD/YYYY')
        ORDER BY ra.allocationResource, ra.startDate
      `),
      runSuiteQLAll<JobRow>(`SELECT id, BUILTIN.DF(customer) AS companyname, companyname AS projectname, entityid FROM job ORDER BY id ASC`),
    ]);

    const jobMap: Record<string, { company: string; name: string }> = {};
    for (const j of jobRows) jobMap[j.id] = { company: j.companyname, name: j.projectname };

    function projectLabel(projectId: string | null, companyName?: string | null, projectName?: string | null): string {
      if (!projectId) return "Internal / Admin";
      // Prefer inline fields from the JOIN; fall back to jobMap for timebill rows
      const company = companyName || jobMap[projectId]?.company;
      const name    = projectName || jobMap[projectId]?.name;
      if (company) return `${company}${name ? ` — ${name}` : ""}`;
      if (name) return name;
      return `Project #${projectId}`;
    }

    // Build entry map + actuals map together from individual rows
    const entryMap: Record<string, Record<string, Array<{
      id: number; date: string; hours: number; memo: string; billable: boolean; approved: boolean;
    }>>> = {};
    const actuals: Record<string, Record<string, { total: number; billable: number }>> = {};

    for (const e of entryRows) {
      const emp  = e.employee;
      const proj = e.project_id ?? "__internal__";

      const hours   = Math.round((parseFloat(e.hours) || 0) * 100) / 100;
      const billable = e.isbillable === "T";

      // actuals map
      if (!actuals[emp]) actuals[emp] = {};
      if (!actuals[emp][proj]) actuals[emp][proj] = { total: 0, billable: 0 };
      actuals[emp][proj].total    = Math.round((actuals[emp][proj].total    + hours)            * 100) / 100;
      actuals[emp][proj].billable = Math.round((actuals[emp][proj].billable + (billable ? hours : 0)) * 100) / 100;

      // entry map
      if (!entryMap[emp]) entryMap[emp] = {};
      if (!entryMap[emp][proj]) entryMap[emp][proj] = [];
      entryMap[emp][proj].push({
        id:       parseInt(e.id),
        date:     e.date,
        hours,
        memo:     e.memo ?? "",
        billable,
        approved: e.approvalstatus === "Approved" || e.approvalstatus === "1",
      });
    }

    // Build allocation map: empId → projectId → AllocRow[]
    const allocMap: Record<string, Record<string, AllocRow[]>> = {};
    for (const r of allocRows) {
      const emp = r.employee_id;
      const proj = r.project_id;
      if (!allocMap[emp]) allocMap[emp] = {};
      if (!allocMap[emp][proj]) allocMap[emp][proj] = [];
      allocMap[emp][proj].push(r);
    }

    // Return structured data; allocated-hours calculation happens client-side
    // using the period dates we return here
    const employees = Object.keys(EMPLOYEES)
      .filter(id => actuals[id] || allocMap[id])
      .map(id => {
        const empActuals  = actuals[id]  ?? {};
        const empAllocs   = allocMap[id] ?? {};

        // All project IDs touched (actual or allocated)
        const allProjectIds = new Set([
          ...Object.keys(empActuals),
          ...Object.keys(empAllocs),
        ]);

        const projects = [...allProjectIds].map(projId => {
          const allocList = empAllocs[projId] ?? [];
          // Use inline company/num from first allocation row if available
          const firstAlloc = allocList[0];
          return {
            projectId:    projId === "__internal__" ? null : parseInt(projId),
            projectName:  projectLabel(
              projId === "__internal__" ? null : projId,
              firstAlloc?.company_name,
              firstAlloc?.project_name,
            ),
            actualHours:  empActuals[projId]?.total    ?? 0,
            billableHours: empActuals[projId]?.billable ?? 0,
            entries:      entryMap[id]?.[projId] ?? [],
            allocations:  allocList.map(a => ({
              id:        a.id,
              startDate: a.start_date,
              endDate:   a.end_date,
              pct:       parseFloat(a.pct)  || 0,
              hrsPerDay: parseFloat(a.hrs)  || 0,
            })),
          };
        });

        const totalHours    = projects.reduce((s, p) => s + p.actualHours,   0);
        const billableHours = projects.reduce((s, p) => s + p.billableHours, 0);

        return {
          employeeId:   parseInt(id),
          employeeName: EMPLOYEES[parseInt(id)],
          totalHours:   Math.round(totalHours    * 100) / 100,
          billableHours: Math.round(billableHours * 100) / 100,
          projects,
        };
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    return NextResponse.json({
      employees,
      rangeFrom:  from.toISOString().slice(0, 10),
      rangeTo:    to.toISOString().slice(0, 10),
      updatedAt:  new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/manager-review]", err);
    return NextResponse.json(
      { employees: [], error: err instanceof Error ? err.message : "Unknown error", updatedAt: new Date().toISOString() },
      { status: 500 }
    );
  }
}
