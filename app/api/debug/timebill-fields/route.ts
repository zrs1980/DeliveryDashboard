import { NextResponse } from "next/server";
import { runSuiteQLAll } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

export const revalidate = 0;

export async function GET() {
  const empList = Object.keys(EMPLOYEES).join(", ");
  try {
    const rows = await runSuiteQLAll<{ timetype: string; cnt: string }>(`
      SELECT tb.timetype, COUNT(*) AS cnt
      FROM timebill tb
      WHERE tb.employee IN (${empList})
      GROUP BY tb.timetype
      ORDER BY cnt DESC
    `);
    return NextResponse.json({ distinct_timetypes: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
