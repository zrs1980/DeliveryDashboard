import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

const QUOTA = 3;

function parseMonthKey(dateStr: string): string | null {
  if (!dateStr) return null;
  const mdy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}`;
  const iso = dateStr.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return null;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short" }) + " " + y.slice(2);
}

export async function GET() {
  try {
    const empRows = await runSuiteQL<{ id: string; firstname: string; lastname: string }>(`
      SELECT e.id, e.firstname, e.lastname
      FROM employee e
      WHERE e.custentity10 IN (1, 2)
      AND e.isinactive = 'F'
      ORDER BY e.lastname ASC
    `);

    const employeeMap: Record<number, string> = {};
    for (const e of empRows) {
      employeeMap[parseInt(e.id)] = `${e.firstname} ${e.lastname}`.trim();
    }
    const employeeIds = Object.keys(employeeMap).map(Number);

    const rows = await runSuiteQL<{
      id: string;
      tranid: string;
      title: string;
      entity: string;
      trandate: string;
      custbody_sr_indentified_by: string;
      custbody_ceba_sales_pipeline: string;
      projectedtotal: string;
    }>(`
      SELECT t.id, t.tranId, t.title, t.entity, t.tranDate,
             t.custbody_sr_indentified_by, t.custbody_ceba_sales_pipeline, t.projectedTotal
      FROM transaction t
      WHERE t.type = 'Opprtnty'
      AND t.custbody_sr_indentified_by IS NOT NULL
      AND t.entitystatus <> 14
      AND t.entitystatus <> 15
      ORDER BY t.tranDate DESC
    `);

    // Resolve customer names
    const entityIds = [...new Set(rows.map(r => r.entity).filter(Boolean))];
    const clientMap: Record<string, string> = {};
    if (entityIds.length > 0) {
      const custRows = await runSuiteQL<{ id: string; companyname: string }>(`
        SELECT id, companyname FROM customer WHERE id IN (${entityIds.join(",")})
      `);
      for (const c of custRows) clientMap[c.id] = c.companyname ?? `Entity ${c.id}`;
    }

    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const thisMonth = months[months.length - 1];
    const lastMonth = months[months.length - 2];
    const thisYear  = String(now.getFullYear());

    const byConsultant: Record<number, Record<string, number>> = {};
    const oppsByConsultant: Record<number, Record<string, Array<{ id: number; title: string; client: string; nsUrl: string; date: string }>>> = {};
    for (const id of employeeIds) {
      byConsultant[id]  = {};
      oppsByConsultant[id] = {};
    }

    for (const row of rows) {
      const empId = parseInt(row.custbody_sr_indentified_by);
      if (!employeeIds.includes(empId)) continue;
      const mk = parseMonthKey(row.trandate);
      if (!mk) continue;
      byConsultant[empId][mk] = (byConsultant[empId][mk] ?? 0) + 1;
      if (!oppsByConsultant[empId][mk]) oppsByConsultant[empId][mk] = [];
      oppsByConsultant[empId][mk].push({
        id:     parseInt(row.id),
        title:  row.title ?? "(Untitled)",
        client: clientMap[row.entity] ?? `Entity ${row.entity}`,
        nsUrl:  `https://3550424.app.netsuite.com/app/accounting/transactions/opprtnty.nl?id=${row.id}`,
        date:   row.trandate,
      });
    }

    const consultants = employeeIds.map(id => {
      const monthly        = byConsultant[id];
      const thisMonthCount = monthly[thisMonth] ?? 0;
      const lastMonthCount = monthly[lastMonth] ?? 0;
      const ytd            = Object.entries(monthly)
        .filter(([k]) => k.startsWith(thisYear))
        .reduce((s, [, v]) => s + v, 0);
      const history = months.map(m => ({ key: m, label: monthLabel(m), count: monthly[m] ?? 0 }));
      const rag     = thisMonthCount >= QUOTA ? "green" : thisMonthCount >= 2 ? "yellow" : "red";
      return { id, name: employeeMap[id] ?? `Employee ${id}`, quota: QUOTA, thisMonth: thisMonthCount, lastMonth: lastMonthCount, ytd, history, rag };
    });

    const teamThisMonth = consultants.reduce((s, c) => s + c.thisMonth, 0);
    const teamLastMonth = consultants.reduce((s, c) => s + c.lastMonth, 0);
    const teamYTD       = consultants.reduce((s, c) => s + c.ytd, 0);
    const teamQuota     = employeeIds.length * QUOTA;
    const attainmentPct = teamQuota > 0 ? Math.round((teamThisMonth / teamQuota) * 100) : 0;

    const monthHistory = months.map(m => ({
      key:   m,
      label: monthLabel(m),
      total: employeeIds.reduce((s, id) => s + (byConsultant[id][m] ?? 0), 0),
      byConsultant: Object.fromEntries(employeeIds.map(id => [id, byConsultant[id][m] ?? 0])),
    }));

    return NextResponse.json({ consultants, teamThisMonth, teamLastMonth, teamYTD, teamQuota, attainmentPct, monthHistory, months, employeeIds, oppsByConsultant });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
