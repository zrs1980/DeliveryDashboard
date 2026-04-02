import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

export const revalidate = 0;

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(d.getDate() + diff);
  return mon;
}

function parseNSDate(dateStr: string): Date | null {
  // Format: "M/D/YYYY"
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
}

interface DayRow {
  employee: string;
  trandate: string;
  total_hours: string;
  billable_hours: string;
  utilized_hours: string;
  productive_hours: string;
}

interface ProjectRow {
  employee: string;
  project_id: string | null;
  company_name: string | null;
  project_number: string | null;
  trandate: string;
  total_hours: string;
  billable_hours: string;
  utilized_hours: string;
  productive_hours: string;
}

function sumPeriod(rows: DayRow[], from: Date, to: Date) {
  let total = 0, billable = 0, utilized = 0, productive = 0;
  for (const r of rows) {
    const d = parseNSDate(r.trandate);
    if (!d || d < from || d > to) continue;
    total      += parseFloat(r.total_hours)      || 0;
    billable   += parseFloat(r.billable_hours)   || 0;
    utilized   += parseFloat(r.utilized_hours)   || 0;
    productive += parseFloat(r.productive_hours) || 0;
  }
  return {
    total, billable, utilized, productive,
    billablePct:    total > 0 ? billable   / total : 0,
    utilizedPct:    total > 0 ? utilized   / total : 0,
    productivePct:  total > 0 ? productive / total : 0,
  };
}

export async function GET() {
  try {
    // Use all known employees — no need to query the employee table since
    // it is not accessible via SuiteQL. Employees with no timebill records
    // in the window are filtered out naturally at the result-building step.
    const employeeIds = Object.keys(EMPLOYEES).map(Number);

    // Run both queries in parallel
    const [rows, projectRows] = await Promise.all([
    runSuiteQL<DayRow>(`
      SELECT
        tb.employee,
        tb.tranDate,
        SUM(tb.hours)                                                      AS total_hours,
        SUM(CASE WHEN tb.isBillable   = 'T' THEN tb.hours ELSE 0 END)     AS billable_hours,
        SUM(CASE WHEN tb.isUtilized   = 'T' THEN tb.hours ELSE 0 END)     AS utilized_hours,
        SUM(CASE WHEN tb.isProductive = 'T' THEN tb.hours ELSE 0 END)     AS productive_hours
      FROM timebill tb
      WHERE tb.employee IN (${employeeIds.join(", ")})
        AND tb.tranDate >= ADD_MONTHS(SYSDATE, -3)
        AND tb.tranDate <= SYSDATE
      GROUP BY tb.employee, tb.tranDate
      ORDER BY tb.employee, tb.tranDate
    `),
    runSuiteQL<ProjectRow>(`
      SELECT
        tb.employee,
        tb.customer                                                          AS project_id,
        j.companyname                                                        AS company_name,
        j.entityid                                                           AS project_number,
        tb.tranDate,
        SUM(tb.hours)                                                        AS total_hours,
        SUM(CASE WHEN tb.isBillable   = 'T' THEN tb.hours ELSE 0 END)       AS billable_hours,
        SUM(CASE WHEN tb.isUtilized   = 'T' THEN tb.hours ELSE 0 END)       AS utilized_hours,
        SUM(CASE WHEN tb.isProductive = 'T' THEN tb.hours ELSE 0 END)       AS productive_hours
      FROM timebill tb
      LEFT JOIN job j ON j.id = tb.customer
      WHERE tb.employee IN (${employeeIds.join(", ")})
        AND tb.tranDate >= ADD_MONTHS(SYSDATE, -3)
        AND tb.tranDate <= SYSDATE
      GROUP BY tb.employee, tb.customer, j.companyname, j.entityid, tb.tranDate
      ORDER BY tb.employee, tb.customer, tb.tranDate
    `),
    ]);

    // Group daily rows by employee
    const byEmployee: Record<string, DayRow[]> = {};
    for (const row of rows) {
      if (!byEmployee[row.employee]) byEmployee[row.employee] = [];
      byEmployee[row.employee].push(row);
    }

    // Group project rows by employee
    const projectsByEmployee: Record<string, ProjectRow[]> = {};
    for (const row of projectRows) {
      if (!projectsByEmployee[row.employee]) projectsByEmployee[row.employee] = [];
      projectsByEmployee[row.employee].push(row);
    }

    // Period boundaries (all at midnight local)
    const now       = new Date();
    const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const thisMonday = getMondayOfWeek(now);

    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);

    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);
    lastSunday.setHours(23, 59, 59, 999);

    const firstOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // Build last 12 Mon-starting weeks
    const weeks: Date[] = [];
    for (let i = 11; i >= 0; i--) {
      const w = new Date(thisMonday);
      w.setDate(thisMonday.getDate() - i * 7);
      weeks.push(w);
    }

    // Only include employees with at least one timebill entry in the window —
    // inactive employees won't have recent records so they're naturally excluded.
    const result = employeeIds.filter(id => EMPLOYEES[id] && byEmployee[String(id)]).map(empId => {
      const empRows = byEmployee[String(empId)] ?? [];

      const weeklyTrend = weeks.map(weekStart => {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        return {
          weekStart: weekStart.toISOString().slice(0, 10),
          ...sumPeriod(empRows, weekStart, weekEnd),
        };
      });

      // Build project breakdown for each period by filtering daily project rows
      const empProjRows = projectsByEmployee[String(empId)] ?? [];
      const periods2 = {
        thisWeek:  [thisMonday,        today],
        lastWeek:  [lastMonday,        lastSunday],
        thisMonth: [firstOfMonth,      today],
        lastMonth: [firstOfLastMonth,  lastDayLastMonth],
      } as const;

      const projectBreakdown = Object.fromEntries(
        (Object.entries(periods2) as [string, readonly [Date, Date]][]).map(([key, [from, to]]) => {
          // Accumulate hours per project for this period
          const byProj: Record<string, { projectId: number | null; companyName: string; projectNumber: string | null; total: number; billable: number; utilized: number; productive: number }> = {};
          for (const r of empProjRows) {
            const d = parseNSDate(r.trandate);
            if (!d || d < from || d > to) continue;
            const key2 = r.project_id ?? "__internal__";
            if (!byProj[key2]) {
              byProj[key2] = {
                projectId:     r.project_id ? parseInt(r.project_id) : null,
                companyName:   r.company_name ?? "Internal / Admin",
                projectNumber: r.project_number ?? null,
                total: 0, billable: 0, utilized: 0, productive: 0,
              };
            }
            byProj[key2].total      += parseFloat(r.total_hours)      || 0;
            byProj[key2].billable   += parseFloat(r.billable_hours)   || 0;
            byProj[key2].utilized   += parseFloat(r.utilized_hours)   || 0;
            byProj[key2].productive += parseFloat(r.productive_hours) || 0;
          }
          const list = Object.values(byProj)
            .filter(p => p.total > 0)
            .sort((a, b) => b.total - a.total)
            .map(p => ({
              projectId:   p.projectId,
              projectName: p.projectNumber
                ? `${p.companyName} — #${p.projectNumber}`
                : p.companyName,
              companyName:  p.companyName,
              total:        Math.round(p.total * 100) / 100,
              billable:     Math.round(p.billable * 100) / 100,
              utilized:     Math.round(p.utilized * 100) / 100,
              productive:   Math.round(p.productive * 100) / 100,
              billablePct:  p.total > 0 ? p.billable / p.total : 0,
            }));
          return [key, list];
        })
      ) as Record<string, { projectId: number | null; projectName: string; companyName: string; total: number; billable: number; utilized: number; productive: number; billablePct: number }[]>;

      return {
        employeeId:   empId,
        employeeName: EMPLOYEES[empId],
        periods: {
          thisWeek:  sumPeriod(empRows, thisMonday,        today),
          lastWeek:  sumPeriod(empRows, lastMonday,        lastSunday),
          thisMonth: sumPeriod(empRows, firstOfMonth,      today),
          lastMonth: sumPeriod(empRows, firstOfLastMonth,  lastDayLastMonth),
        },
        weeklyTrend,
        projectBreakdown,
      };
    });

    return NextResponse.json({ employees: result, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/time-analysis]", err);
    return NextResponse.json({
      employees: [],
      error: err instanceof Error ? err.message : "Unknown error",
      updatedAt: new Date().toISOString(),
    });
  }
}
