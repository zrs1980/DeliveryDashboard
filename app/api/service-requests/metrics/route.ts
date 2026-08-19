import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

// Always hit NetSuite. Every other data route in this app declares this; without
// it a CDN can serve a response cached before a metric definition changed.
export const revalidate = 0;

const QUOTA = 3;

/**
 * Opportunity status labels are free-form and inconsistently prefixed in this
 * account — "0 - Closed Lost", "1- Nurturing", "1 - -On Hold", "85 - Pending SOW
 * Approval", but plain "Closed Won". Strip any leading number-dash and all
 * punctuation so a comparison survives that.
 */
function normalizeStatus(label: string): string {
  return label.toLowerCase().replace(/^\s*\d+\s*-\s*/, "").replace(/[^a-z]/g, "");
}

/**
 * Statuses that do NOT count toward a consultant's SR quota.
 *
 * CLOSED WON IS DELIBERATELY ABSENT. The quota counts service requests a
 * consultant IDENTIFIED; winning the deal is the success case, so excluding it
 * meant the best possible outcome silently deleted the credit. Seven closed-won
 * SRs were being hidden across 2026 — Jason Tutanes read 6 YTD instead of 11,
 * Sam Balido 3 instead of 5.
 *
 * The route previously carried TWO exclusions that were not the same rule:
 * `entitystatus <> 14` in the SQL and a "closed won" label test in JS. 14 is
 * Closed LOST in this account, not Closed Won, so the pair dropped both — almost
 * certainly not what was intended, since the label test reads as a more reliable
 * restatement of the numeric one.
 */
const QUOTA_EXCLUDED_STATUSES = new Set(["closedlost"]);

function isQuotaExcluded(label: string): boolean {
  return QUOTA_EXCLUDED_STATUSES.has(normalizeStatus(label));
}

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
             t.custbody_sr_indentified_by, t.custbody_ceba_sales_pipeline, t.projectedTotal,
             BUILTIN.DF(t.entitystatus) AS entitystatus_label
      FROM transaction t
      WHERE t.type = 'Opprtnty'
      AND t.custbody_sr_indentified_by IS NOT NULL
      ORDER BY t.tranDate DESC
    `);

    // Filter by label, not by numeric id — the ids are account-specific and the
    // two filters that used to sit here disagreed about what they excluded.
    const filteredRows = rows.filter(
      (r: any) => !isQuotaExcluded(r.entitystatus_label ?? ""),
    );

    // Resolve customer names
    const entityIds = [...new Set(filteredRows.map(r => r.entity).filter(Boolean))];
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

    for (const row of filteredRows) {
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
