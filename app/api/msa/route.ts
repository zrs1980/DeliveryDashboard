import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export const revalidate = 0;

export interface MSAProject {
  id: number;
  projectNumber: string;
  companyname: string;
  customerId: number | null;
  jobtypeName: string;
  msaHours: number;          // custentity9 — contracted monthly MSA hours
  mtdHours: number;          // timebill hours logged this calendar month
  remainingHours: number;    // msaHours - mtdHours
  startDate: string | null;
  goLiveDate: string | null;
}

// Normalize M/D/YYYY → YYYY-MM-DD
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split("/");
  if (parts.length === 3) {
    const [m, d, y] = parts;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return raw;
}

export async function GET() {
  try {
    // 1. Fetch all active projects — filter by jobtype display name containing "Managed"
    const projectRows = await runSuiteQL<{
      id: string;
      entityid: string;
      companyname: string | null;
      customer: string | null;
      jobtype_name: string | null;
      msa_hours: string | null;
      startdate: string | null;
      golive_date: string | null;
    }>(`
      SELECT
        id,
        entityid,
        companyname,
        customer,
        BUILTIN.DF(jobtype)                  AS jobtype_name,
        custentity9                          AS msa_hours,
        startdate,
        custentity_project_golive_date       AS golive_date
      FROM job
      WHERE entitystatus = 2
        AND LOWER(BUILTIN.DF(jobtype)) LIKE '%managed%'
      ORDER BY companyname ASC
    `);

    if (projectRows.length === 0) {
      return NextResponse.json({ projects: [] });
    }

    const projectIds = projectRows.map(r => parseInt(r.id, 10));

    // 2. Fetch MTD timebill hours for these projects
    const placeholders = projectIds.map(() => "?").join(", ");
    const mtdRows = await runSuiteQL<{ project_id: string; mtd_hours: string }>(`
      SELECT tb.customer AS project_id, SUM(tb.hours) AS mtd_hours
      FROM timebill tb
      WHERE tb.customer IN (${placeholders})
        AND tb.tranDate >= TRUNC(SYSDATE, 'MM')
        AND tb.tranDate <= SYSDATE
      GROUP BY tb.customer
    `, projectIds);

    const mtdMap: Record<number, number> = {};
    for (const r of mtdRows) {
      mtdMap[parseInt(r.project_id, 10)] = parseFloat(r.mtd_hours) || 0;
    }

    // 3. Build response
    const projects: MSAProject[] = projectRows.map(r => {
      const id        = parseInt(r.id, 10);
      const msaHours  = parseFloat(r.msa_hours ?? "0") || 0;
      const mtdHours  = mtdMap[id] ?? 0;
      return {
        id,
        projectNumber:    r.entityid ?? "",
        companyname:      r.companyname || r.entityid || String(id),
        customerId:       r.customer ? parseInt(r.customer, 10) : null,
        jobtypeName:      r.jobtype_name ?? "",
        msaHours,
        mtdHours:         Math.round(mtdHours * 100) / 100,
        remainingHours:   Math.round((msaHours - mtdHours) * 100) / 100,
        startDate:        normalizeDate(r.startdate),
        goLiveDate:       normalizeDate(r.golive_date),
      };
    });

    return NextResponse.json({ projects });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
