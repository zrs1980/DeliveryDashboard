import { NextResponse } from "next/server";
import { runSuiteQL, fetchRecord } from "@/lib/netsuite";

export async function GET() {
  // Get task IDs with their SuiteQL status values
  const rows = await runSuiteQL<{ id: string; status: string; status_label: string }>(`
    SELECT pt.id, pt.status, BUILTIN.DF(pt.status) AS status_label
    FROM projecttask pt
    ORDER BY pt.id ASC
  `).catch(() => [] as { id: string; status: string; status_label: string }[]);

  // Show unique SuiteQL statuses
  const uniqueSuiteQL = Array.from(
    new Map(rows.map(r => [r.status, { id: r.status, label: r.status_label }])).values()
  );

  // Fetch first task via REST to see raw status shape
  const firstTask = rows[0] ? await fetchRecord<Record<string, unknown>>("projecttask", parseInt(rows[0].id)).catch(() => null) : null;

  return NextResponse.json({
    uniqueSuiteQLStatuses: uniqueSuiteQL,
    firstTaskRestStatus: firstTask?.status ?? null,
    firstTaskRestStatusRaw: JSON.stringify(firstTask?.status),
  });
}
