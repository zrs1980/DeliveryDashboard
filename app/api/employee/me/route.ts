import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchRecord, searchRecords, runSuiteQL } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

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

export async function GET() {
  const session = await auth();
  const email   = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    let matchedId: number | null = null;
    let matchedRecord: NsEmployeeRecord | null = null;

    // Attempt 1: REST Record API search by email
    try {
      const hits = await searchRecords<NsEmployeeRecord & { id: number }>(
        "employee",
        `email IS "${email}"`,
        1,
      );
      if (hits.length > 0) {
        const hit = hits[0];
        matchedId = hit.id ?? null;
        // Fetch full record to get custom fields
        if (matchedId) {
          matchedRecord = await fetchRecord<NsEmployeeRecord>("employee", matchedId);
        }
      }
    } catch {
      // Fall through to secondary lookup
    }

    // Attempt 2: fetch each known employee record and match by email
    if (!matchedId) {
      const empIds = Object.keys(EMPLOYEES).map(Number);
      const results = await Promise.allSettled(
        empIds.map(id => fetchRecord<NsEmployeeRecord>("employee", id))
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled" && r.value.email?.toLowerCase() === email) {
          matchedId     = empIds[i];
          matchedRecord = r.value;
          break;
        }
      }
    }

    if (!matchedId || !matchedRecord) {
      return NextResponse.json({ error: `No NetSuite employee found matching ${email}` }, { status: 404 });
    }

    const ptoHours  = parseFloat(String(matchedRecord.custentity_ceba_pto_hours  ?? "0")) || 0;
    const sickHours = parseFloat(String(matchedRecord.custentity_ceba_sick_hours ?? "0")) || 0;

    const balance: EmployeeBalance = {
      id:        matchedId,
      name:      `${matchedRecord.firstname ?? ""} ${matchedRecord.lastname ?? ""}`.trim() || EMPLOYEES[matchedId],
      email,
      ptoHours,
      sickHours,
    };

    // Find PTO and Sick leave job records via SuiteQL (job table is accessible)
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

    // Fetch timebill entries for this employee on PTO/Sick projects
    const timebillRows = await runSuiteQL<{
      id: string; trandate: string; customer: string; hours: string; memo: string;
    }>(`
      SELECT tb.id, tb.trandate, tb.customer, tb.hours, tb.memo
      FROM timebill tb
      WHERE tb.employee = ${matchedId}
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
