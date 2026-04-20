import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL, runSuiteQLAll } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

export const revalidate = 0;

const ADMIN_EMAIL = "zabe@cebasolutions.com";

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
  if (dateStr.includes("-")) {
    const [y, m, dd] = dateStr.split("-").map(Number);
    if (!y || !m || !dd) return null;
    return new Date(y, m - 1, dd);
  }
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
}

function countBusinessDays(from: Date, to: Date): number {
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function clampDate(d: Date, min: Date, max: Date): Date {
  if (d < min) return min;
  if (d > max) return max;
  return d;
}

interface TimebillRow {
  employee: string;
  project_id: string | null;
  trandate: string;
  total_hours: string;
  billable_hours: string;
  utilized_hours: string;
}

interface JobRow {
  id: string;
  companyname: string;
  entityid: string;
}

interface AllocRow {
  employee_id: string;
  project_id: string;
  project_name: string;
  customer_name: string;
  startdate: string;
  enddate: string;
  numberhours: string;
  allocationunit: string;
  percentoftime: string;
}

interface PeriodBounds {
  from: Date;
  to: Date;
}

function calcAllocatedHours(allocs: AllocRow[], projectId: string, period: PeriodBounds): number {
  let total = 0;
  for (const a of allocs) {
    if (a.project_id !== projectId) continue;
    const aStart = parseNSDate(a.startdate);
    const aEnd   = parseNSDate(a.enddate);
    if (!aStart || !aEnd) continue;
    // Skip allocations that don't overlap the period at all
    if (aEnd < period.from || aStart > period.to) continue;
    const overlapStart = aStart > period.from ? aStart : period.from;
    const overlapEnd   = aEnd   < period.to   ? aEnd   : period.to;
    const days = countBusinessDays(overlapStart, overlapEnd);
    // Match ResourceAllocation component: use percentoftime if set, else hoursPerDay
    const pct = parseFloat(a.percentoftime || "0");
    const hoursPerDay = pct > 0
      ? (pct / 100) * 8
      : parseFloat(a.numberhours || "0");
    total += days * hoursPerDay;
  }
  return total;
}

export async function GET() {
  const session = await auth();
  if (session?.user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const employeeIds = Object.keys(EMPLOYEES).map(Number);
  const empList = employeeIds.join(", ");
  const now = new Date();

  const [timebillRows, jobRows, allocRows] = await Promise.all([
    runSuiteQLAll<TimebillRow>(`
      SELECT
        tb.employee,
        tb.customer                                                        AS project_id,
        tb.trandate,
        SUM(tb.hours)                                                      AS total_hours,
        SUM(CASE WHEN tb.isbillable = 'T' THEN tb.hours ELSE 0 END)       AS billable_hours,
        SUM(CASE WHEN tb.isutilized = 'T' THEN tb.hours ELSE 0 END)       AS utilized_hours
      FROM timebill tb
      WHERE tb.employee IN (${empList})
        AND tb.trandate >= ADD_MONTHS(SYSDATE, -6)
        AND tb.trandate <= SYSDATE
        AND tb.approvalstatus IS NOT NULL
      GROUP BY tb.employee, tb.customer, tb.trandate
      ORDER BY tb.employee, tb.customer, tb.trandate
    `),
    runSuiteQL<JobRow>(`
      SELECT id, companyname, entityid
      FROM job
      ORDER BY id ASC
    `),
    runSuiteQLAll<AllocRow>(`
      SELECT
        ra.allocationResource  AS employee_id,
        ra.project             AS project_id,
        BUILTIN.DF(ra.project) AS project_name,
        j.companyname          AS customer_name,
        ra.startDate,
        ra.endDate,
        ra.numberHours,
        ra.allocationUnit,
        ra.percentOfTime
      FROM resourceallocation ra
      JOIN job j ON j.id = ra.project AND j.entitystatus = 2
      WHERE ra.allocationResource IN (${empList})
        AND ra.endDate >= ADD_MONTHS(SYSDATE, -6)
      ORDER BY ra.allocationResource, ra.startDate
    `),
  ]);

  const jobMap: Record<string, { companyname: string; entityid: string }> = {};
  for (const j of jobRows) {
    jobMap[j.id] = { companyname: j.companyname, entityid: j.entityid };
  }

  const today        = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const thisMonday   = getMondayOfWeek(now);
  const lastMonday   = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday   = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1); lastSunday.setHours(23, 59, 59, 999);
  const firstOfMonth      = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMonth  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDayLastMonth  = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const currentQuarter    = Math.floor(now.getMonth() / 3);
  const firstOfThisQ      = new Date(now.getFullYear(), currentQuarter * 3, 1);
  const firstOfLastQ      = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
  const lastDayLastQ      = new Date(now.getFullYear(), currentQuarter * 3, 0, 23, 59, 59, 999);

  const PERIODS: Record<string, PeriodBounds> = {
    thisWeek:    { from: thisMonday,       to: today },
    lastWeek:    { from: lastMonday,       to: lastSunday },
    thisMonth:   { from: firstOfMonth,     to: today },
    lastMonth:   { from: firstOfLastMonth, to: lastDayLastMonth },
    thisQuarter: { from: firstOfThisQ,     to: today },
    lastQuarter: { from: firstOfLastQ,     to: lastDayLastQ },
  };

  const rowsByEmployee: Record<string, TimebillRow[]> = {};
  for (const row of timebillRows) {
    if (!rowsByEmployee[row.employee]) rowsByEmployee[row.employee] = [];
    rowsByEmployee[row.employee].push(row);
  }

  const allocsByEmployee: Record<string, AllocRow[]> = {};
  for (const a of allocRows) {
    if (!allocsByEmployee[a.employee_id]) allocsByEmployee[a.employee_id] = [];
    allocsByEmployee[a.employee_id].push(a);
  }

  const employees = employeeIds
    .filter(id => EMPLOYEES[id])
    .map(empId => {
      const empRows = rowsByEmployee[String(empId)] ?? [];
      const empAllocs = allocsByEmployee[String(empId)] ?? [];

      const periods: Record<string, {
        billable: number;
        utilizedNonBillable: number;
        nonUtilized: number;
        total: number;
        billablePct: number;
        utilizationPct: number;
        projects: Array<{
          projectId: number | null;
          projectName: string;
          companyName: string;
          billable: number;
          utilizedNonBillable: number;
          nonUtilized: number;
          total: number;
          allocatedHours: number;
          variance: number;
        }>;
      }> = {};

      for (const [periodKey, bounds] of Object.entries(PERIODS)) {
        const byProject: Record<string, {
          projectId: number | null;
          companyName: string;
          projectNumber: string | null;
          billable: number;
          utilized: number;
          total: number;
        }> = {};

        for (const r of empRows) {
          const d = parseNSDate(r.trandate);
          if (!d || d < bounds.from || d > bounds.to) continue;
          const pk = r.project_id ?? "__internal__";
          if (!byProject[pk]) {
            const job = r.project_id ? jobMap[r.project_id] : undefined;
            byProject[pk] = {
              projectId:     r.project_id ? parseInt(r.project_id) : null,
              companyName:   job?.companyname ?? (r.project_id ? `Unknown (#${r.project_id})` : "Internal / Admin"),
              projectNumber: job?.entityid ?? null,
              billable: 0, utilized: 0, total: 0,
            };
          }
          byProject[pk].total    += parseFloat(r.total_hours)    || 0;
          byProject[pk].billable += parseFloat(r.billable_hours) || 0;
          byProject[pk].utilized += parseFloat(r.utilized_hours) || 0;
        }

        const allAllocPks = new Set([
          ...empAllocs.map(a => a.project_id),
          ...Object.keys(byProject),
        ]);

        const projectList = Array.from(allAllocPks).map(pk => {
          const actual      = byProject[pk];
          const job         = pk !== "__internal__" ? jobMap[pk] : undefined;
          // Prefer allocation's customer_name (from job join), fall back to job map, then actual
          const allocForPk  = pk !== "__internal__" ? empAllocs.find(a => a.project_id === pk) : undefined;
          const customerName = allocForPk?.customer_name || job?.companyname || actual?.companyName || "";
          const displayName  = allocForPk?.project_name || job?.entityid || pk;
          const projectName  = customerName ? `${customerName} — ${displayName}` : displayName;

          const tot  = Math.round((actual?.total    ?? 0) * 100) / 100;
          const bill = Math.round((actual?.billable ?? 0) * 100) / 100;
          const util = Math.round((actual?.utilized ?? 0) * 100) / 100;
          const utilNonBill = Math.round(Math.max(0, util - bill) * 100) / 100;
          const nonUtil     = Math.round(Math.max(0, tot - util)  * 100) / 100;

          const allocatedHours = pk !== "__internal__"
            ? Math.round(calcAllocatedHours(empAllocs, pk, bounds) * 100) / 100
            : 0;
          const variance = Math.round((tot - allocatedHours) * 100) / 100;

          return {
            projectId:          actual?.projectId ?? (pk !== "__internal__" ? parseInt(pk) : null),
            projectName,
            companyName:        customerName,
            billable:           bill,
            utilizedNonBillable: utilNonBill,
            nonUtilized:        nonUtil,
            total:              tot,
            allocatedHours,
            variance,
          };
        }).filter(p => p.total > 0 || p.allocatedHours > 0)
          .sort((a, b) => b.total - a.total);

        const periodTotal    = Math.round(projectList.reduce((s, p) => s + p.total, 0) * 100) / 100;
        const periodBillable = Math.round(projectList.reduce((s, p) => s + p.billable, 0) * 100) / 100;
        const periodUtil     = Math.round(projectList.reduce((s, p) => s + p.utilizedNonBillable, 0) * 100) / 100;
        const periodNonUtil  = Math.round(projectList.reduce((s, p) => s + p.nonUtilized, 0) * 100) / 100;

        periods[periodKey] = {
          billable:            periodBillable,
          utilizedNonBillable: periodUtil,
          nonUtilized:         periodNonUtil,
          total:               periodTotal,
          billablePct:         periodTotal > 0 ? periodBillable / periodTotal : 0,
          utilizationPct:      periodTotal > 0 ? (periodBillable + periodUtil) / periodTotal : 0,
          projects:            projectList,
        };
      }

      const totalAcrossAllPeriods = Object.values(periods).reduce((s, p) => s + p.total, 0);

      return {
        employeeId:   empId,
        employeeName: EMPLOYEES[empId],
        periods,
        _total: totalAcrossAllPeriods,
      };
    })
    .filter(e => e._total > 0)
    .map(({ _total: _t, ...e }) => e);

  return NextResponse.json({ employees, updatedAt: new Date().toISOString() });
}
