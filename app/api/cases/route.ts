import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export const revalidate = 0;

export async function GET() {
  try {
    const rows = await runSuiteQL<{
      id: string;
      casenumber: string;
      title: string;
      status: string;
      priority: string;
      stage: string;
      company: string;
      assigned: string;
      createddate: string;
      lastmodifieddate: string;
    }>(`
      SELECT
        sc.id,
        sc.casenumber,
        sc.title,
        sc.status,
        sc.priority,
        sc.stage,
        sc.company,
        sc.assigned,
        sc.createddate,
        sc.lastmodifieddate
      FROM supportcase sc
      WHERE sc.stage != 3
      ORDER BY sc.lastmodifieddate DESC
    `);

    const cases = rows.map(r => ({
      id: r.id,
      caseNumber: r.casenumber || r.id,
      title: r.title || "(No title)",
      status: r.status || "Unknown",
      priority: r.priority || "Medium",
      stage: r.stage,
      company: r.company || "—",
      assigned: r.assigned || "Unassigned",
      createdDate: r.createddate,
      lastModified: r.lastmodifieddate,
    }));

    return NextResponse.json({ cases, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/cases]", err);
    // Return empty array rather than error — cases may not be configured
    return NextResponse.json({ cases: [], error: err instanceof Error ? err.message : "Unknown error", updatedAt: new Date().toISOString() });
  }
}
