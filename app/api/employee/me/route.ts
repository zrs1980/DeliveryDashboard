import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL } from "@/lib/netsuite";

export interface EmployeeBalance {
  id: number;
  name: string;
  email: string;
  ptoHours: number;
  sickHours: number;
  periodStart: string;   // ISO date — most recent hire anniversary
  hireDate: string;      // ISO date — original hire date
}

/** Returns the most recent anniversary of hireDate on or before today (YYYY-MM-DD). */
function lastAnniversary(hireDate: string): string {
  const hire  = new Date(hireDate + "T00:00:00");
  const today = new Date();
  let year = today.getFullYear();
  // Try this year's anniversary; if it's in the future, use last year's
  let ann = new Date(year, hire.getMonth(), hire.getDate());
  if (ann > today) ann = new Date(year - 1, hire.getMonth(), hire.getDate());
  return ann.toISOString().slice(0, 10);
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
  const email   = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Step 1: look up employee ID by email via SuiteQL (fast single query)
    let matchedId: number | null = null;
    let matchMethod = "";

    try {
      const suiteqlRows = await runSuiteQL<{ id: string }>(
        `SELECT id FROM employee WHERE email = '${email.replace(/'/g, "''")}'`
      );
      if (suiteqlRows && suiteqlRows.length > 0) {
        matchedId = parseInt(suiteqlRows[0].id);
        matchMethod = "suiteql";
      }
    } catch {
      // SuiteQL employee lookup failed — fall through to REST API
    }

    if (!matchedId) {
      return NextResponse.json({ error: `No NetSuite employee found matching ${email}` }, { status: 404 });
    }

    // Step 2: fetch balance fields + name + hire date via SuiteQL
    const empRows = await runSuiteQL<{
      firstname: string; lastname: string; hiredate: string | null;
      custentity_ceba_pto_hours: string | null;
      custentity_ceba_sick_hours: string | null;
    }>(`SELECT firstname, lastname, hiredate, custentity_ceba_pto_hours, custentity_ceba_sick_hours FROM employee WHERE id = ${matchedId}`);

    const empRow    = empRows?.[0];
    const ptoHours  = parseFloat(empRow?.custentity_ceba_pto_hours  ?? "0") || 0;
    const sickHours = parseFloat(empRow?.custentity_ceba_sick_hours ?? "0") || 0;
    const hireDateRaw = empRow?.hiredate ?? null;
    const periodStart = hireDateRaw ? lastAnniversary(hireDateRaw) : new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

    const balance: EmployeeBalance = {
      id:   matchedId,
      name: `${empRow?.firstname ?? ""} ${empRow?.lastname ?? ""}`.trim() || email,
      email,
      ptoHours,
      sickHours,
      periodStart,
      hireDate: hireDateRaw ?? "",
    };

    // Step 3: look up PTO/Sick projects by known entityids
    const PTO_ENTITY_IDS  = ["117", "373"];
    const SICK_ENTITY_IDS = ["118", "371"];
    const allEntityIds    = [...PTO_ENTITY_IDS, ...SICK_ENTITY_IDS];

    const projectRows = await runSuiteQL<{ id: string; entityid: string; companyname: string }>(`
      SELECT id, entityid, companyname
      FROM job
      WHERE entityid IN (${allEntityIds.map(e => `'${e}'`).join(",")})
    `);

    if (!projectRows || projectRows.length === 0) {
      return NextResponse.json({
        balance,
        entries: [],
        _debug: {
          matchedId,
          matchMethod,
          projectRows: [],
          note: "No job rows found for entityids: " + allEntityIds.join(", "),
        },
      });
    }

    const projectNameMap: Record<number, { name: string; type: "pto" | "sick" }> = {};
    for (const p of projectRows as any[]) {
      const id   = parseInt(p.id);
      const name = p.companyname || p.entityid || String(id);
      const type = SICK_ENTITY_IDS.includes(p.entityid) ? "sick" : "pto";
      projectNameMap[id] = { name, type };
    }

    const allProjectIds = Object.keys(projectNameMap).map(Number);

    // Step 4: fetch timebill entries for this employee on PTO/Sick projects from period start
    const timebillRows = await runSuiteQL<{
      id: string; trandate: string; customer: string; hours: string; memo: string;
    }>(`
      SELECT tb.id, tb.trandate, tb.customer, tb.hours, tb.memo
      FROM timebill tb
      WHERE tb.employee = ${matchedId}
        AND tb.customer IN (${allProjectIds.join(",")})
        AND tb.trandate >= '${periodStart}'
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

    return NextResponse.json({
      balance,
      entries,
      _debug: {
        matchedId,
        matchMethod,
        rawPtoField:  empRow?.custentity_ceba_pto_hours,
        rawSickField: empRow?.custentity_ceba_sick_hours,
        projectRows,
        timebillCount: timebillRows?.length ?? 0,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
