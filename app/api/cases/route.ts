import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export const revalidate = 0;

export async function GET() {
  try {
    // Main cases query — BUILTIN.DF() converts internal IDs to display names
    const rows = await runSuiteQL<{
      id: string;
      casenumber: string;
      title: string;
      status: string;
      priority: string;
      company: string;
      assigned: string;
      createddate: string;
      lastmodifieddate: string;
    }>(`
      SELECT
        sc.id,
        sc.casenumber,
        sc.title,
        BUILTIN.DF(sc.status)   AS status,
        BUILTIN.DF(sc.priority) AS priority,
        BUILTIN.DF(sc.company)  AS company,
        BUILTIN.DF(sc.assigned) AS assigned,
        sc.createddate,
        sc.lastmodifieddate
      FROM supportcase sc
      WHERE sc.isinactive = 'F'
        AND sc.closedate IS NULL
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

    const cases = rows.map(r => ({
      id:           r.id,
      caseNumber:   r.casenumber || r.id,
      title:        r.title || "(No title)",
      status:       r.status  || "Unknown",
      priority:     r.priority || "—",
      stage:        "",
      company:      r.company  || "—",
      assigned:     r.assigned || "Unassigned",
      createdDate:  r.createddate,
      lastModified: r.lastmodifieddate,
      lastNote:     lastNoteMap[r.id] || "",
    }));

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
