import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL } from "@/lib/netsuite";

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

export async function GET() {
  const session = await auth();
  const email   = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Look up employee by email
    const empRows = await runSuiteQL<{
      id: string;
      firstname: string;
      lastname: string;
      custentity_ceba_pto_hours: string;
      custentity_ceba_sick_hours: string;
    }>(`
      SELECT id, firstname, lastname,
             custentity_ceba_pto_hours,
             custentity_ceba_sick_hours
      FROM employee
      WHERE email = '${email.replace(/'/g, "''")}'
    `);

    if (!empRows || empRows.length === 0) {
      return NextResponse.json({ error: `No NetSuite employee found for ${email}` }, { status: 404 });
    }

    const emp = empRows[0] as any;
    const empId    = parseInt(emp.id);
    const ptoHours  = parseFloat(emp.custentity_ceba_pto_hours  ?? "0") || 0;
    const sickHours = parseFloat(emp.custentity_ceba_sick_hours ?? "0") || 0;

    const balance: EmployeeBalance = {
      id:        empId,
      name:      `${emp.firstname ?? ""} ${emp.lastname ?? ""}`.trim(),
      email,
      ptoHours,
      sickHours,
    };

    // Find PTO and Sick leave projects (jobs)
    const projectRows = await runSuiteQL<{ id: string; entityid: string; companyname: string }>(`
      SELECT id, entityid, companyname
      FROM job
      WHERE UPPER(entityid)   LIKE '%PTO%'
         OR UPPER(companyname) LIKE '%PTO%'
         OR UPPER(entityid)   LIKE '%SICK%'
         OR UPPER(companyname) LIKE '%SICK%'
    `);

    if (!projectRows || projectRows.length === 0) {
      return NextResponse.json({ balance, entries: [] });
    }

    const ptoIds  = (projectRows as any[]).filter(p =>
      (p.entityid ?? "").toUpperCase().includes("PTO") ||
      (p.companyname ?? "").toUpperCase().includes("PTO")
    ).map(p => parseInt(p.id));

    const sickIds = (projectRows as any[]).filter(p =>
      (p.entityid ?? "").toUpperCase().includes("SICK") ||
      (p.companyname ?? "").toUpperCase().includes("SICK")
    ).map(p => parseInt(p.id));

    const allProjectIds = [...new Set([...ptoIds, ...sickIds])];
    if (allProjectIds.length === 0) {
      return NextResponse.json({ balance, entries: [] });
    }

    // Build a name map for project IDs
    const projectNameMap: Record<number, { name: string; type: "pto" | "sick" }> = {};
    for (const p of projectRows as any[]) {
      const id   = parseInt(p.id);
      const name = p.companyname || p.entityid || String(id);
      const upper = `${p.entityid ?? ""} ${p.companyname ?? ""}`.toUpperCase();
      projectNameMap[id] = {
        name,
        type: upper.includes("SICK") ? "sick" : "pto",
      };
    }

    // Fetch time entries for this employee on PTO/Sick projects
    const timebillRows = await runSuiteQL<{
      id: string;
      trandate: string;
      customer: string;
      hours: string;
      memo: string;
    }>(`
      SELECT tb.id, tb.trandate, tb.customer, tb.hours, tb.memo
      FROM timebill tb
      WHERE tb.employee = ${empId}
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
