import { NextResponse } from "next/server";
import { runSuiteQL, fetchRecord } from "@/lib/netsuite";

export async function GET() {
  // Try plain query first (no BUILTIN.DF)
  let rows: { id: string; status: string }[] = [];
  let queryError: string | null = null;
  try {
    rows = await runSuiteQL<{ id: string; status: string }>(`
      SELECT pt.id, pt.status FROM projecttask pt ORDER BY pt.id ASC
    `);
  } catch (e) {
    queryError = e instanceof Error ? e.message : String(e);
  }

  const uniqueSuiteQL = Array.from(new Map(rows.map(r => [r.status, r.status])).values());

  // Try fetching first task via REST
  let firstTaskStatus: unknown = null;
  let restError: string | null = null;
  if (rows[0]) {
    try {
      const rec = await fetchRecord<Record<string, unknown>>("projecttask", parseInt(rows[0].id));
      firstTaskStatus = rec.status;
    } catch (e) {
      restError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    rowCount: rows.length,
    queryError,
    uniqueSuiteQLStatuses: uniqueSuiteQL,
    firstTaskId: rows[0]?.id ?? null,
    firstTaskRestStatus: firstTaskStatus,
    restError,
  });
}
