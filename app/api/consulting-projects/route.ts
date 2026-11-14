import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import { getStaffRoster, nameFor } from "@/lib/roster";

export const revalidate = 0;

/**
 * In-Progress consulting projects — "General Consulting Agreement" (jobtype 5)
 * and "Consulting Services" (jobtype 6). Not in Active Projects
 * (Implementation/Service only); loaded for the Projects tab's Time Entries
 * section, alongside MSAs and Internal projects.
 *
 * Matched on the jobtype name, the same way /api/msa and /api/internal-projects
 * do, so a renumbered type still resolves.
 */
export async function GET() {
  try {
    const [rows, roster] = await Promise.all([
      runSuiteQL<{
        id: string; entityid: string; companyname: string | null;
        customer_name: string | null; projectmanager: string | null;
      }>(`
        SELECT id, entityid, companyname, BUILTIN.DF(customer) AS customer_name, projectmanager
        FROM job
        WHERE entitystatus = 2
          AND LOWER(BUILTIN.DF(jobtype)) LIKE '%consulting%'
        ORDER BY customer_name ASC
      `),
      getStaffRoster(),
    ]);

    const projects = rows.map(r => ({
      id:           parseInt(r.id, 10),
      projectName:  (r.companyname || r.entityid || r.id).trim(),
      customerName: (r.customer_name ?? "").trim(),
      pm:           r.projectmanager ? nameFor(roster, r.projectmanager) : "",
    }));

    return NextResponse.json({ projects });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
