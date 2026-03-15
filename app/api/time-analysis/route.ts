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
    const allEmployeeIds = Object.keys(EMPLOYEES).map(Number);

    // Filter to active employees only
    const activeRows = await runSuiteQL<{ id: string }>(`
      SELECT id FROM employee
      WHERE id IN (${allEmployeeIds.join(", ")})
        AND isInactive = 'F'
    `);
    const employeeIds = activeRows.map(r => parseInt(r.id));

    if (employeeIds.length === 0) {
      return NextResponse.json({ employees: [], updatedAt: new Date().toISOString() });
    }

    // Start from ~6 months ago to stay well under the 1000-row SuiteQL limit.
    // With ~130 working days × 6 employees = ~780 rows max — safely under limit.
    // The 12-week trend chart and MTD/last-month periods are fully covered.
    const rows = await runSuiteQL<DayRow>(`
      SELECT
        tb.employee,
        tb.tranDate,
        SUM(tb.hours)                                                      AS total_hours,
        SUM(CASE WHEN tb.isBillable   = 'T' THEN tb.hours ELSE 0 END)     AS billable_hours,
        SUM(CASE WHEN tb.isUtilized   = 'T' THEN tb.hours ELSE 0 END)     AS utilized_hours,
        SUM(CASE WHEN tb.isProductive = 'T' THEN tb.hours ELSE 0 END)     AS productive_hours
      FROM timebill tb
      WHERE tb.employee IN (${employeeIds.join(", ")})
        AND tb.tranDate >= TO_DATE('10/01/2025', 'MM/DD/YYYY')
        AND tb.tranDate <= SYSDATE
      GROUP BY tb.employee, tb.tranDate
      ORDER BY tb.employee, tb.tranDate
    `);

    // Group rows by employee
    const byEmployee: Record<string, DayRow[]> = {};
    for (const row of rows) {
      if (!byEmployee[row.employee]) byEmployee[row.employee] = [];
      byEmployee[row.employee].push(row);
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

    const result = employeeIds.filter(id => EMPLOYEES[id]).map(empId => {
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
