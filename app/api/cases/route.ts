import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import { getStaffRoster, nameFor } from "@/lib/roster";

export const revalidate = 0;

export async function GET() {
  try {
    // JOIN customer table for company name (BUILTIN.DF on company/assigned returns raw IDs in SuiteQL).
    // assigned_id is the raw employee FK — mapped server-side via the live roster.
    const rows = await runSuiteQL<{
      id: string;
      casenumber: string;
      title: string;
      status: string;
      priority: string;
      cust_name: string;
      assigned_id: string;
      createddate: string;
      lastmodifieddate: string;
    }>(`
      SELECT
        sc.id,
        sc.casenumber,
        sc.title,
        BUILTIN.DF(sc.status)   AS status,
        BUILTIN.DF(sc.priority) AS priority,
        e.altname               AS cust_name,
        sc.assigned             AS assigned_id,
        sc.createddate,
        sc.lastmodifieddate
      FROM supportcase sc
      LEFT JOIN entity e ON e.id = sc.company
      WHERE sc.isinactive = 'F'
      ORDER BY sc.lastmodifieddate DESC
    `);

    // Fetch latest message per case (best-effort — silently skip if table unavailable)
    let lastNoteMap: Record<string, string> = {};
    try {
      if (rows.length > 0) {
        const caseIds = rows.map(r => r.id).join(", ");
        const msgs = await runSuiteQL<{
          supportcase: string;
          note: string;
          notedate: string;
        }>(`
          SELECT scm.supportcase, scm.note, scm.notedate
          FROM supportcasemessage scm
          WHERE scm.supportcase IN (${caseIds})
          ORDER BY scm.supportcase, scm.notedate DESC
        `);

        // Keep only the first (most recent) message per case
        for (const m of msgs) {
          if (!lastNoteMap[m.supportcase]) {
            lastNoteMap[m.supportcase] = m.note ?? "";
          }
        }
      }
    } catch {
      // supportcasemessage unavailable — continue without last notes
    }

    // Cases can be assigned to anyone, not only consultants, so this is the full roster.
    const roster = await getStaffRoster();

    const cases = rows.map(r => {
      const empId    = parseInt(r.assigned_id);
      const assigned = r.assigned_id ? nameFor(roster, empId) : "Unassigned";

      return {
        id:           r.id,
        caseNumber:   r.casenumber || r.id,
        title:        r.title || "(No title)",
        status:       r.status  || "Unknown",
        priority:     r.priority || "—",
        stage:        "",
        company:      r.cust_name || "—",
        assigned,
        createdDate:  r.createddate,
        lastModified: r.lastmodifieddate,
        lastNote:     lastNoteMap[r.id] || "",
      };
    });

    return NextResponse.json({ cases, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/cases]", err);
    return NextResponse.json({
      cases: [],
      error: err instanceof Error ? err.message : "Unknown error",
      updatedAt: new Date().toISOString(),
    });
  }
}
