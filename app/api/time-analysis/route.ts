import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, runSuiteQLAll, getActiveJobResources } from "@/lib/netsuite";

export const revalidate = 0;

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(d.getDate() + diff);
  return mon;
}

function parseNSDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
}

interface ProjectRow {
  employee: string;
  project_id: string | null;
  trandate: string;
  total_hours: string;
  billable_hours: string;
  utilized_hours: string;
  productive_hours: string;
}

interface EntryRow {
  id: string;
  employee: string;
  project_id: string | null;
  trandate: string;
  hours: string;
  memo: string | null;
  isbillable: string;
  isutilized: string;
}

interface JobRow {
  id:           string;
  client_name:  string;   // BUILTIN.DF(customer) — the customer/company
  project_name: string;   // companyname — the project name
  entityid:     string;
}

// Aggregated totals keyed by trandate, derived from project rows
interface DayTotals {
  total: number;
  billable: number;
  utilized: number;
  productive: number;
}

const HOURS_PER_DAY = 7.5;

function countBusinessDays(from: Date, to: Date): number {
  let count = 0;
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  const e = new Date(to);   e.setHours(0, 0, 0, 0);
  while (d <= e) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function sumPeriod(byDate: Map<string, DayTotals>, from: Date, to: Date, availableHours?: number) {
  let total = 0, billable = 0, utilized = 0, productive = 0;
  for (const [dateStr, v] of byDate) {
    const d = parseNSDate(dateStr);
    if (!d || d < from || d > to) continue;
    total      += v.total;
    billable   += v.billable;
    utilized   += v.utilized;
    productive += v.productive;
  }
  const denom = availableHours ?? total;
  return {
    total:         Math.round(total * 100) / 100,
    billable:      Math.round(billable * 100) / 100,
    utilized:      Math.round(utilized * 100) / 100,
    productive:    Math.round(productive * 100) / 100,
    billablePct:   denom > 0 ? billable   / denom : 0,
    utilizedPct:   denom > 0 ? utilized   / denom : 0,
    productivePct: denom > 0 ? productive / denom : 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromParam       = searchParams.get("from");
    const toParam         = searchParams.get("to");
    const departmentParam = searchParams.get("department"); // e.g. "Consulting"

    const allEmployees = await getActiveJobResources();
    const deptFilter = departmentParam
      ? departmentParam.split(",").map(d => d.trim().toLowerCase()).filter(Boolean)
      : null;
    const EMPLOYEES = deptFilter
      ? Object.fromEntries(
          Object.entries(allEmployees).filter(([, v]) =>
            deptFilter.includes(v.department.toLowerCase())
          )
        )
      : allEmployees;
    const employeeIds = Object.keys(EMPLOYEES).map(Number);
    const now = new Date();

    // Debug: log distinct department values so we can match the right string
    if (departmentParam && employeeIds.length === 0) {
      const allDepts = [...new Set(Object.values(allEmployees).map(e => e.department))].sort();
      console.warn("[time-analysis] No employees matched department filter:", departmentParam, "— available values:", allDepts);
      return NextResponse.json({ employees: [], _deptDebug: allDepts, updatedAt: new Date().toISOString() });
    }

    if (employeeIds.length === 0) {
      return NextResponse.json({ employees: [], updatedAt: new Date().toISOString() });
    }

    const empList = employeeIds.join(", ");

    const [projectRows, entryRows, jobRows] = await Promise.all([
      runSuiteQLAll<ProjectRow>(`
        SELECT
          tb.employee,
          tb.customer                                                          AS project_id,
          tb.trandate,
          SUM(tb.hours)                                                        AS total_hours,
          SUM(CASE WHEN tb.isbillable   = 'T' THEN tb.hours ELSE 0 END)       AS billable_hours,
          SUM(CASE WHEN tb.isutilized   = 'T' THEN tb.hours ELSE 0 END)       AS utilized_hours,
          SUM(CASE WHEN tb.isproductive = 'T' THEN tb.hours ELSE 0 END)       AS productive_hours
        FROM timebill tb
        WHERE tb.employee IN (${empList})
          AND tb.trandate >= ADD_MONTHS(SYSDATE, -6)
          AND tb.trandate <= SYSDATE
          AND tb.approvalstatus IS NOT NULL
        GROUP BY tb.employee, tb.customer, tb.trandate
        ORDER BY tb.employee, tb.customer, tb.trandate
      `),
      runSuiteQLAll<EntryRow>(`
        SELECT tb.id, tb.employee, tb.customer AS project_id, tb.trandate,
               tb.hours, tb.memo, tb.isbillable, tb.isutilized
        FROM timebill tb
        WHERE tb.employee IN (${empList})
          AND tb.trandate >= ADD_MONTHS(SYSDATE, -6)
          AND tb.trandate <= SYSDATE
          AND tb.approvalstatus IS NOT NULL
        ORDER BY tb.employee, tb.customer, tb.trandate DESC, tb.id DESC
      `),
      runSuiteQL<JobRow>(`
        SELECT id, BUILTIN.DF(customer) AS client_name, companyname AS project_name, entityid
        FROM job
        ORDER BY id ASC
      `),
    ]);

    const jobMap: Record<string, { clientName: string; projectName: string; entityid: string }> = {};
    for (const j of jobRows) {
      jobMap[j.id] = { clientName: j.client_name ?? "", projectName: j.project_name ?? "", entityid: j.entityid ?? "" };
    }

    // Index individual entries by employee → project
    const entriesByEmpProj: Record<string, Record<string, EntryRow[]>> = {};
    for (const e of entryRows) {
      const emp  = e.employee;
      const proj = e.project_id ?? "__internal__";
      if (!entriesByEmpProj[emp]) entriesByEmpProj[emp] = {};
      if (!entriesByEmpProj[emp][proj]) entriesByEmpProj[emp][proj] = [];
      entriesByEmpProj[emp][proj].push(e);
    }

    // Group project rows by employee
    const projectsByEmployee: Record<string, ProjectRow[]> = {};
    for (const row of projectRows) {
      if (!projectsByEmployee[row.employee]) projectsByEmployee[row.employee] = [];
      projectsByEmployee[row.employee].push(row);
    }

    // Custom range (if provided)
    const customFrom = fromParam ? new Date(fromParam + "T00:00:00") : null;
    const customTo   = toParam   ? new Date(toParam   + "T23:59:59") : null;

    // Period boundaries
    const todayStart     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const today          = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yesterdayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    const thisMonday    = getMondayOfWeek(now);
    const lastMonday    = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday    = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1); lastSunday.setHours(23, 59, 59, 999);
    const firstOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLastMonth  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMonth  = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const currentQuarter      = Math.floor(now.getMonth() / 3);
    const firstOfThisQuarter  = new Date(now.getFullYear(), currentQuarter * 3, 1);
    const firstOfLastQuarter  = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
    const lastDayLastQuarter  = new Date(now.getFullYear(), currentQuarter * 3, 0, 23, 59, 59, 999);

    // Full-period boundaries (unclipped to today) for available-hours calculation
    const lastDayThisMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const lastDayThisQuarter = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0, 23, 59, 59, 999);
    const thisFriday         = new Date(thisMonday); thisFriday.setDate(thisMonday.getDate() + 4);

    const periodAvailableHours: Record<string, number> = {
      today:       HOURS_PER_DAY,
      yesterday:   HOURS_PER_DAY,
      thisWeek:    countBusinessDays(thisMonday,          thisFriday)         * HOURS_PER_DAY,
      lastWeek:    countBusinessDays(lastMonday,          lastSunday)         * HOURS_PER_DAY,
      thisMonth:   countBusinessDays(firstOfMonth,        lastDayThisMonth)   * HOURS_PER_DAY,
      lastMonth:   countBusinessDays(firstOfLastMonth,    lastDayLastMonth)   * HOURS_PER_DAY,
      thisQuarter: countBusinessDays(firstOfThisQuarter,  lastDayThisQuarter) * HOURS_PER_DAY,
      lastQuarter: countBusinessDays(firstOfLastQuarter,  lastDayLastQuarter) * HOURS_PER_DAY,
    };
    if (customFrom && customTo) {
      periodAvailableHours["custom"] = countBusinessDays(customFrom, customTo) * HOURS_PER_DAY;
    }

    const weeks: Date[] = [];
    for (let i = 11; i >= 0; i--) {
      const w = new Date(thisMonday);
      w.setDate(thisMonday.getDate() - i * 7);
      weeks.push(w);
    }

    const result = employeeIds
      .filter(id => EMPLOYEES[id] && projectsByEmployee[String(id)])
      .map(empId => {
        const empProjRows = projectsByEmployee[String(empId)] ?? [];

        // Derive daily totals from project rows — single source of truth
        // Skip any future-dated entries (belt-and-suspenders beyond the SQL upper bound)
        const byDate = new Map<string, DayTotals>();
        for (const r of empProjRows) {
          const rd = parseNSDate(r.trandate);
          if (!rd || rd > today) continue;          // exclude future dates
          const existing = byDate.get(r.trandate);
          const t = parseFloat(r.total_hours)      || 0;
          const b = parseFloat(r.billable_hours)   || 0;
          const u = parseFloat(r.utilized_hours)   || 0;
          const p = parseFloat(r.productive_hours) || 0;
          if (existing) {
            existing.total      += t;
            existing.billable   += b;
            existing.utilized   += u;
            existing.productive += p;
          } else {
            byDate.set(r.trandate, { total: t, billable: b, utilized: u, productive: p });
          }
        }

        const weeklyTrend = weeks.map(weekStart => {
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
          return { weekStart: weekStart.toISOString().slice(0, 10), ...sumPeriod(byDate, weekStart, weekEnd) };
        });

        const periods2: Record<string, [Date, Date]> = {
          today:        [todayStart,          today],
          yesterday:    [yesterdayStart,      yesterdayEnd],
          thisWeek:     [thisMonday,          today],
          lastWeek:     [lastMonday,          lastSunday],
          thisMonth:    [firstOfMonth,        today],
          lastMonth:    [firstOfLastMonth,    lastDayLastMonth],
          thisQuarter:  [firstOfThisQuarter,  today],
          lastQuarter:  [firstOfLastQuarter,  lastDayLastQuarter],
        };
        if (customFrom && customTo) periods2["custom"] = [customFrom, customTo];

        const projectBreakdown = Object.fromEntries(
          Object.entries(periods2).map(([key, [from, to]]) => {
            const byProj: Record<string, {
              projectId: number | null; clientName: string; projectName: string; projectNumber: string | null;
              total: number; billable: number; utilized: number; productive: number;
            }> = {};

            for (const r of empProjRows) {
              const d = parseNSDate(r.trandate);
              if (!d || d < from || d > to) continue;
              const key2 = r.project_id ?? "__internal__";
              if (!byProj[key2]) {
                const job = r.project_id ? jobMap[r.project_id] : undefined;
                byProj[key2] = {
                  projectId:    r.project_id ? parseInt(r.project_id) : null,
                  clientName:   job?.clientName ?? (r.project_id ? `#${r.project_id}` : "Internal / Admin"),
                  projectName:  job?.projectName ?? "",
                  projectNumber: job?.entityid ?? null,
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
              .map(p => {
                const projKey  = p.projectId ? String(p.projectId) : "__internal__";
                const rawEntries = (entriesByEmpProj[String(empId)]?.[projKey] ?? [])
                  .filter(e => { const d = parseNSDate(e.trandate); return d && d >= from && d <= to; })
                  .map(e => ({
                    id:       parseInt(e.id),
                    date:     e.trandate,
                    hours:    Math.round((parseFloat(e.hours) || 0) * 100) / 100,
                    memo:     e.memo ?? "",
                    billable: e.isbillable === "T",
                    utilized: e.isutilized === "T",
                  }));
                return {
                  projectId:    p.projectId,
                  clientName:   p.clientName,
                  projectName:  p.projectName,
                  total:        Math.round(p.total * 100) / 100,
                  billable:     Math.round(p.billable * 100) / 100,
                  utilized:     Math.round(p.utilized * 100) / 100,
                  productive:   Math.round(p.productive * 100) / 100,
                  billablePct:  p.total > 0 ? p.billable / p.total : 0,
                  entries:      rawEntries,
                };
              });
            return [key, list];
          })
        );

        return {
          employeeId:        empId,
          employeeName:      EMPLOYEES[empId]?.name ?? `Employee #${empId}`,
          employeeType:      EMPLOYEES[empId]?.employeeType ?? "",
          targetUtilization: EMPLOYEES[empId]?.targetUtilization ?? 0.75,
          periods: {
            today:       sumPeriod(byDate, todayStart,         today,                periodAvailableHours.today),
            yesterday:   sumPeriod(byDate, yesterdayStart,     yesterdayEnd,         periodAvailableHours.yesterday),
            thisWeek:    sumPeriod(byDate, thisMonday,         today,                periodAvailableHours.thisWeek),
            lastWeek:    sumPeriod(byDate, lastMonday,         lastSunday,           periodAvailableHours.lastWeek),
            thisMonth:   sumPeriod(byDate, firstOfMonth,       today,                periodAvailableHours.thisMonth),
            lastMonth:   sumPeriod(byDate, firstOfLastMonth,   lastDayLastMonth,     periodAvailableHours.lastMonth),
            thisQuarter: sumPeriod(byDate, firstOfThisQuarter, today,                periodAvailableHours.thisQuarter),
            lastQuarter: sumPeriod(byDate, firstOfLastQuarter, lastDayLastQuarter,   periodAvailableHours.lastQuarter),
            ...(customFrom && customTo ? { custom: sumPeriod(byDate, customFrom, customTo, periodAvailableHours.custom) } : {}),
          },
          weeklyTrend,
          projectBreakdown,
        };
      });

    return NextResponse.json({ employees: result, periodAvailableHours, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/time-analysis]", err);
    return NextResponse.json({
      employees: [],
      error: err instanceof Error ? err.message : "Unknown error",
      updatedAt: new Date().toISOString(),
    });
  }
}
