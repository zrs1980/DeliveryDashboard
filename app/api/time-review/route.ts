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

function toNSDateLiteral(d: Date): string {
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

interface TimebillRow {
  id: string;
  employee: string;
  project_id: string | null;
  trandate: string;
  hours: string;
  memo: string | null;
  isbillable: string;
  isutilized: string;
  isproductive: string;
  approvalstatus: string | null;
}

interface JobRow {
  id:          string;
  client_name: string;   // BUILTIN.DF(customer)
  project_name: string;  // raw companyname
  entityid:    string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period    = searchParams.get("period")   ?? "thisMonth";
  const fromParam = searchParams.get("from");   // ISO YYYY-MM-DD
  const toParam   = searchParams.get("to");     // ISO YYYY-MM-DD

  const now     = new Date();
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
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
    const [rows, jobRows] = await Promise.all([
      runSuiteQLAll<TimebillRow>(`
        SELECT
          tb.id,
          tb.employee,
          tb.customer       AS project_id,
          tb.trandate,
          tb.hours,
          tb.memo,
          tb.isbillable,
          tb.isutilized,
          tb.isproductive,
          tb.approvalstatus
        FROM timebill tb
        WHERE tb.employee IN (${empList})
          AND tb.trandate >= TO_DATE('${toNSDateLiteral(from)}', 'MM/DD/YYYY')
          AND tb.trandate <= TO_DATE('${toNSDateLiteral(to)}',   'MM/DD/YYYY')
          AND tb.isutilized = 'T'
        ORDER BY tb.employee, tb.trandate DESC, tb.id DESC
      `),
      runSuiteQLAll<JobRow>(`
        SELECT id, BUILTIN.DF(customer) AS client_name, companyname AS project_name, entityid
        FROM job
        ORDER BY id ASC
      `),
    ]);

    const jobMap: Record<string, { client_name: string; project_name: string }> = {};
    for (const j of jobRows) jobMap[j.id] = { client_name: j.client_name, project_name: j.project_name };

    const byEmployee: Record<string, {
      employeeId:    number;
      employeeName:  string;
      totalHours:    number;
      billableHours: number;
      entries: Array<{
        id: number; date: string; projectId: number | null; projectName: string;
        hours: number; memo: string;
        isBillable: boolean; isUtilized: boolean; isProductive: boolean;
        approvalStatus: string;
      }>;
    }> = {};

    for (const row of rows) {
      const empId = parseInt(row.employee);
      if (!EMPLOYEES[empId]) continue;

      const key = String(empId);
      if (!byEmployee[key]) {
        byEmployee[key] = { employeeId: empId, employeeName: EMPLOYEES[empId], totalHours: 0, billableHours: 0, entries: [] };
      }

      const hours = parseFloat(row.hours) || 0;
      const job   = row.project_id ? jobMap[row.project_id] : undefined;
      const projectName = job
        ? `${job.client_name || job.project_name}${job.project_name && job.client_name ? ` — ${job.project_name}` : ""}`
        : row.project_id ? `Project #${row.project_id}` : "Internal / Admin";

      byEmployee[key].totalHours    += hours;
      byEmployee[key].billableHours += row.isbillable === "T" ? hours : 0;
      byEmployee[key].entries.push({
        id: parseInt(row.id), date: row.trandate,
        projectId: row.project_id ? parseInt(row.project_id) : null,
        projectName, hours,
        memo:           row.memo ?? "",
        isBillable:     row.isbillable   === "T",
        isUtilized:     row.isutilized   === "T",
        isProductive:   row.isproductive === "T",
        approvalStatus: row.approvalstatus ?? "",
      });
    }

    const employees = Object.values(byEmployee)
      .map(e => ({ ...e, totalHours: Math.round(e.totalHours * 100) / 100, billableHours: Math.round(e.billableHours * 100) / 100 }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    // Return effective range so the component can generate consistent date columns
    return NextResponse.json({
      employees,
      rangeFrom:  from.toISOString().slice(0, 10),
      rangeTo:    to.toISOString().slice(0, 10),
      updatedAt:  new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/time-review]", err);
    return NextResponse.json(
      { employees: [], error: err instanceof Error ? err.message : "Unknown error", updatedAt: new Date().toISOString() },
      { status: 500 }
    );
  }
}
