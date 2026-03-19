import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchRecord, runSuiteQL } from "@/lib/netsuite";

export interface EmployeeBalance {
  id: number;
  name: string;
  email: string;
  ptoHours: number;
  sickHours: number;
}

export interface TimeEntry {
  id: number;
  date: string;
  projectId: number;
  projectName: string;
  type: "pto" | "sick";
  hours: number;
  memo: string | null;
}

interface NsEmployeeRecord {
  id?: number;
  email?: string;
  firstname?: string;
  lastname?: string;
  custentity_ceba_pto_hours?: number | string | null;
  custentity_ceba_sick_hours?: number | string | null;
}

// Parse NS_EMPLOYEE_IDS env var: "email1:id1,email2:id2"
function getEmailIdMap(): Record<string, number> {
  const map: Record<string, number> = {};
  const raw = process.env.NS_EMPLOYEE_IDS ?? "";
  for (const pair of raw.split(",")) {
    const [e, id] = pair.trim().split(":");
    if (e && id && !isNaN(parseInt(id))) {
      map[e.toLowerCase().trim()] = parseInt(id.trim());
    }
  }
  return map;
}

export async function GET() {
  const session = await auth();
  const email   = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Look up NS employee ID from env var override map
    const emailIdMap = getEmailIdMap();
    const employeeId = emailIdMap[email];

    if (!employeeId) {
      return NextResponse.json({
        error: `Your email (${email}) is not mapped to a NetSuite employee ID. Add NS_EMPLOYEE_IDS=${email}:YOUR_NS_ID to Vercel environment variables. Find your NS ID at Lists → Employees → Employees → click your name → check the URL.`,
      }, { status: 404 });
    }

    // Fetch employee record via REST API
    let record: NsEmployeeRecord;
    try {
      record = await fetchRecord<NsEmployeeRecord>("employee", employeeId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("403")) {
        return NextResponse.json({
          error: "The NetSuite integration role lacks Employee record permission. Ask your NS admin to add 'Employee → View' under the integration role's List permissions.",
        }, { status: 403 });
      }
      throw e;
    }

    const ptoHours  = parseFloat(String(record.custentity_ceba_pto_hours  ?? "0")) || 0;
    const sickHours = parseFloat(String(record.custentity_ceba_sick_hours ?? "0")) || 0;

    const balance: EmployeeBalance = {
      id:        employeeId,
      name:      `${record.firstname ?? ""} ${record.lastname ?? ""}`.trim() || email,
      email,
      ptoHours,
      sickHours,
    };

    // Find PTO and Sick leave job records via SuiteQL
    const projectRows = await runSuiteQL<{ id: string; entityid: string; companyname: string }>(`
      SELECT id, entityid, companyname
      FROM job
      WHERE UPPER(entityid)    LIKE '%PTO%'
         OR UPPER(companyname) LIKE '%PTO%'
         OR UPPER(entityid)    LIKE '%SICK%'
         OR UPPER(companyname) LIKE '%SICK%'
    `);

    if (!projectRows || projectRows.length === 0) {
      return NextResponse.json({ balance, entries: [] });
    }

    const projectNameMap: Record<number, { name: string; type: "pto" | "sick" }> = {};
    for (const p of projectRows as any[]) {
      const id    = parseInt(p.id);
      const name  = p.companyname || p.entityid || String(id);
      const upper = `${p.entityid ?? ""} ${p.companyname ?? ""}`.toUpperCase();
      projectNameMap[id] = { name, type: upper.includes("SICK") ? "sick" : "pto" };
    }

    const allProjectIds = Object.keys(projectNameMap).map(Number);

    const timebillRows = await runSuiteQL<{
      id: string; trandate: string; customer: string; hours: string; memo: string;
    }>(`
      SELECT tb.id, tb.trandate, tb.customer, tb.hours, tb.memo
      FROM timebill tb
      WHERE tb.employee = ${employeeId}
        AND tb.customer IN (${allProjectIds.join(",")})
      ORDER BY tb.trandate DESC
    `);

    const entries: TimeEntry[] = (timebillRows ?? []).map((r: any) => {
      const projId = parseInt(r.customer);
      const proj   = projectNameMap[projId] ?? { name: String(projId), type: "pto" as const };
      return {
        id:          parseInt(r.id),
        date:        r.trandate ?? "",
        projectId:   projId,
        projectName: proj.name,
        type:        proj.type,
        hours:       parseFloat(r.hours ?? "0"),
        memo:        r.memo ?? null,
      };
    });

    return NextResponse.json({ balance, entries });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
