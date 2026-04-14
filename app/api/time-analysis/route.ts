import { NextResponse } from "next/server";
import { runSuiteQL, runSuiteQLAll } from "@/lib/netsuite";
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
}

interface ProjectRow {
  employee: string;
  project_id: string | null;
  trandate: string;
  total_hours: string;
}

interface JobRow {
  id: string;
  companyname: string;
  entityid: string;
}

function sumPeriod(rows: DayRow[], from: Date, to: Date) {
  let total = 0;
  for (const r of rows) {
    const d = parseNSDate(r.trandate);
    if (!d || d < from || d > to) continue;
    total += parseFloat(r.total_hours) || 0;
  }
  // billable/utilized/productive are not exposed in SuiteQL timebill —
  // default to total so the frontend doesn't render empty metrics.
  return {
    total,
    billable:      total,
    utilized:      total,
    productive:    total,
    billablePct:   1,
    utilizedPct:   1,
    productivePct: 1,
  };
}

export async function GET() {
  try {
    const employeeIds = Object.keys(EMPLOYEES).map(Number);

    const now = new Date();
    const empList = employeeIds.join(", ");

    // Run all three queries in parallel.
    // NOTE: Cannot JOIN job table from timebill in SuiteQL (same restriction as employee).
    // Fetch job names separately and cross-reference by ID in code.
    const [rows, projectRows, jobRows] = await Promise.all([
      runSuiteQLAll<DayRow>(`
        SELECT tb.employee, tb.trandate, SUM(tb.hours) AS total_hours
        FROM timebill tb
        WHERE tb.employee IN (${empList})
          AND tb.trandate >= ADD_MONTHS(SYSDATE, -3)
        GROUP BY tb.employee, tb.trandate
        ORDER BY tb.employee, tb.trandate
      `),
      runSuiteQLAll<ProjectRow>(`
        SELECT tb.employee, tb.customer AS project_id, tb.trandate, SUM(tb.hours) AS total_hours
        FROM timebill tb
        WHERE tb.employee IN (${empList})
          AND tb.trandate >= ADD_MONTHS(SYSDATE, -3)
        GROUP BY tb.employee, tb.customer, tb.trandate
        ORDER BY tb.employee, tb.customer, tb.trandate
      `),
      runSuiteQL<JobRow>(`
        SELECT id, companyname, entityid
        FROM job
        WHERE entitystatus = 2
        ORDER BY id ASC
      `),
    ]);

    // Build a lookup map: project internal ID → { companyname, entityid }
    const jobMap: Record<string, { companyname: string; entityid: string }> = {};
    for (const j of jobRows) {
      jobMap[j.id] = { companyname: j.companyname, entityid: j.entityid };
    }

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
    const today      = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
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

      const empProjRows = projectsByEmployee[String(empId)] ?? [];
      const periods2 = {
        thisWeek:  [thisMonday,        today],
        lastWeek:  [lastMonday,        lastSunday],
        thisMonth: [firstOfMonth,      today],
        lastMonth: [firstOfLastMonth,  lastDayLastMonth],
      } as const;

      const projectBreakdown = Object.fromEntries(
        (Object.entries(periods2) as [string, readonly [Date, Date]][]).map(([key, [from, to]]) => {
          const byProj: Record<string, { projectId: number | null; companyName: string; projectNumber: string | null; total: number }> = {};
          for (const r of empProjRows) {
            const d = parseNSDate(r.trandate);
            if (!d || d < from || d > to) continue;
            const key2 = r.project_id ?? "__internal__";
            if (!byProj[key2]) {
              const job = r.project_id ? jobMap[r.project_id] : undefined;
              byProj[key2] = {
                projectId:     r.project_id ? parseInt(r.project_id) : null,
                companyName:   job?.companyname ?? "Internal / Admin",
                projectNumber: job?.entityid ?? null,
                total: 0,
              };
            }
            byProj[key2].total += parseFloat(r.total_hours) || 0;
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
              billable:     Math.round(p.total * 100) / 100,
              utilized:     Math.round(p.total * 100) / 100,
              productive:   Math.round(p.total * 100) / 100,
              billablePct:  1,
            }));
          return [key, list];
        })
      );

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
