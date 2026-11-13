import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import { getStaffRoster, nameFor } from "@/lib/roster";

export const revalidate = 0;

/**
 * In-Progress Internal projects (jobtype 4) — admin, PTO, sick, marketing,
 * internal meetings and the like. Not in Active Projects (Implementation/Service
 * only); loaded for the Projects tab's Time Entries section, alongside MSAs.
 *
 * Matched on the jobtype name rather than id 4, the same way /api/msa matches
 * "managed", so a renumbered type still resolves.
 */
export async function GET() {
  try {
    const [rows, roster] = await Promise.all([
      runSuiteQL<{ id: string; entityid: string; companyname: string | null; projectmanager: string | null }>(`
        SELECT id, entityid, companyname, projectmanager
        FROM job
        WHERE entitystatus = 2
          AND LOWER(BUILTIN.DF(jobtype)) = 'internal'
        ORDER BY companyname ASC
      `),
      getStaffRoster(),
    ]);

    const projects = rows.map(r => ({
      id:          parseInt(r.id, 10),
      projectName: (r.companyname || r.entityid || r.id).trim(),
      pm:          r.projectmanager ? nameFor(roster, r.projectmanager) : "",
    }));

    return NextResponse.json({ projects });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
