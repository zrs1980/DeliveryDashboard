import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL } from "@/lib/netsuite";
import { getSupabaseAdmin } from "@/lib/supabase";
import { HIRE_DATES, PTO_APPROVER_EMAILS } from "@/lib/constants";
import type { EmployeeBalance, TimeEntry } from "@/app/api/employee/me/route";


function parseNsDate(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.slice(0, 10) + "T00:00:00");
  const parts = s.split("/");
  if (parts.length === 3) return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
  return new Date(s);
}

function lastAnniversary(hireDate: string): string {
  const hire  = parseNsDate(hireDate);
  if (isNaN(hire.getTime())) throw new Error(`Cannot parse hire date: "${hireDate}"`);
  const today = new Date();
  let ann = new Date(today.getFullYear(), hire.getMonth(), hire.getDate());
  if (ann > today) ann = new Date(today.getFullYear() - 1, hire.getMonth(), hire.getDate());
  return ann.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const callerEmail = session?.user?.email?.toLowerCase();
  if (!callerEmail || !PTO_APPROVER_EMAILS.includes(callerEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nsId = parseInt(req.nextUrl.searchParams.get("nsId") ?? "");
  if (!nsId || isNaN(nsId)) {
    return NextResponse.json({ error: "nsId query param required" }, { status: 400 });
  }

  try {
    // Fetch balance fields for this employee
    const empRows = await runSuiteQL<{
      firstname: string; lastname: string; email: string | null; hiredate: string | null;
      custentity_ceba_pto_hours: string | null;
      custentity_ceba_sick_hours: string | null;
    }>(`SELECT firstname, lastname, email, hiredate, custentity_ceba_pto_hours, custentity_ceba_sick_hours FROM employee WHERE id = ${nsId}`);

    const empRow    = empRows?.[0];
    if (!empRow) return NextResponse.json({ error: `No employee found for NS id ${nsId}` }, { status: 404 });

    const empEmail  = (empRow.email ?? "").toLowerCase();
    const ptoHours  = parseFloat(empRow.custentity_ceba_pto_hours  ?? "0") || 0;
    const sickHours = parseFloat(empRow.custentity_ceba_sick_hours ?? "0") || 0;

    // Resolve hire date: NS → Supabase → constants → Jan 1
    let hireDateRaw: string | null = empRow.hiredate ?? null;
    if (!hireDateRaw && empEmail) {
      try {
        const supabase = getSupabaseAdmin();
        const { data } = await supabase
          .from("employee_hire_dates")
          .select("hire_date")
          .eq("email", empEmail)
          .single();
        if (data?.hire_date) hireDateRaw = data.hire_date;
      } catch { /* Supabase unavailable */ }
    }
    if (!hireDateRaw && empEmail) hireDateRaw = HIRE_DATES[empEmail] ?? null;
    const periodStart = hireDateRaw
      ? lastAnniversary(hireDateRaw)
      : new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

    const balance: EmployeeBalance = {
      id:          nsId,
      name:        `${empRow.firstname ?? ""} ${empRow.lastname ?? ""}`.trim() || `Employee ${nsId}`,
      email:       empEmail,
      ptoHours,
      sickHours,
      periodStart,
      hireDate:    hireDateRaw ?? "",
    };

    // Fetch timebill entries for PTO/Sick projects
    const PTO_ENTITY_IDS  = ["117", "373"];
    const SICK_ENTITY_IDS = ["118", "371"];
    const allEntityIds    = [...PTO_ENTITY_IDS, ...SICK_ENTITY_IDS];

    const projectRows = await runSuiteQL<{ id: string; entityid: string; companyname: string }>(`
      SELECT id, entityid, companyname
      FROM job
      WHERE entityid IN (${allEntityIds.map(e => `'${e}'`).join(",")})
    `);

    if (!projectRows || projectRows.length === 0) {
      return NextResponse.json({ balance, entries: [] });
    }

    const projectNameMap: Record<number, { name: string; type: "pto" | "sick" }> = {};
    for (const p of projectRows as any[]) {
      const id   = parseInt(p.id);
      const name = p.companyname || p.entityid || String(id);
      const type = SICK_ENTITY_IDS.includes(p.entityid) ? "sick" : "pto";
      projectNameMap[id] = { name, type };
    }

    const allProjectIds = Object.keys(projectNameMap).map(Number);

    const timebillRows = await runSuiteQL<{
      id: string; trandate: string; customer: string; hours: string; memo: string;
    }>(`
      SELECT tb.id, tb.trandate, tb.customer, tb.hours, tb.memo
      FROM timebill tb
      WHERE tb.employee = ${nsId}
        AND tb.customer IN (${allProjectIds.join(",")})
        AND tb.trandate >= TO_DATE('${periodStart}', 'YYYY-MM-DD')
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
