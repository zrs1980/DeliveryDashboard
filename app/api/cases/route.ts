import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import { getStaffRoster, nameFor } from "@/lib/roster";
import { fetchCustomerProjectIndex } from "@/lib/cs-customers";

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
      company_id: string | null;
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
        -- The id, not just the label. sc.company is a customer id OR a job id
        -- (596 of 1080 are jobs), and dropping it meant a case could never be
        -- attributed to an account programmatically — entity.altname renders
        -- as "Customer : Job Name", which reads fine and joins to nothing.
        sc.company              AS company_id,
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

    // sc.company resolves to a customer two ways: it IS a customer id, or it is
    // one of that customer's jobs. Without the second path more than half the
    // cases in this account attribute to nobody — Yield Engineering's 142 all
    // hang off its Managed Services Agreement job.
    //
    // Non-fatal: if the index cannot be built the tab still renders with names,
    // exactly as it did before, just without the id.
    let projectIndex: Awaited<ReturnType<typeof fetchCustomerProjectIndex>> | null = null;
    try { projectIndex = await fetchCustomerProjectIndex(); }
    catch { projectIndex = null; }

    const customerOf = (companyId: string | null): string | null => {
      if (!companyId) return null;
      const key = String(companyId);
      return projectIndex?.byProject[key]?.customerNsId ?? key;
    };

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
        customerNsId: customerOf(r.company_id),
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
