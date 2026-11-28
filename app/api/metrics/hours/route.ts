import { NextRequest, NextResponse } from "next/server";
import { runSuiteQLAll } from "@/lib/netsuite";

export const revalidate = 0;

/**
 * GET /api/metrics/hours?projectIds=1,2,3&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Actual time (timetype 'A') on the given projects, summed per project and month
 * (billable / non-billable) — the Projects tab's Metrics/KPIs subtab. Aggregated in
 * SuiteQL so a 12-month window over every project stays a few thousand rows
 * rather than every individual entry /api/time-entries would return.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-02" → "11/02/2026", the literal format the other timebill routes use. */
function nsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? "";
  const to   = searchParams.get("to")   ?? "";
  // Interpolated into SQL, so integers only — anything else is dropped, not escaped.
  const projectIds = (searchParams.get("projectIds") ?? "")
    .split(",").map(s => s.trim()).filter(s => /^\d+$/.test(s));

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  }
  if (projectIds.length === 0) return NextResponse.json({ rows: [] });

  try {
    // Grouped per day (the shape /api/admin/utilization already runs) and rolled
    // up to months below. `= 'T'`: SuiteQL omits a never-set checkbox entirely
    // (see CLAUDE.md), so anything else is non-billable.
    const raw = await runSuiteQLAll<{
      project_id: string; day: string; total_hours: string; billable_hours: string;
    }>(`
      SELECT
        tb.customer                                                  AS project_id,
        TO_CHAR(tb.trandate, 'YYYY-MM-DD')                           AS day,
        SUM(tb.hours)                                                AS total_hours,
        SUM(CASE WHEN tb.isbillable = 'T' THEN tb.hours ELSE 0 END) AS billable_hours
      FROM timebill tb
      WHERE tb.customer IN (${projectIds.join(",")})
        AND tb.timetype = 'A'
        AND tb.trandate >= TO_DATE('${nsDate(from)}', 'MM/DD/YYYY')
        AND tb.trandate <= TO_DATE('${nsDate(to)}',   'MM/DD/YYYY')
      GROUP BY tb.customer, tb.trandate
    `);

    const byKey = new Map<string, { projectId: number; month: string; billable: number; nonBillable: number }>();
    for (const r of raw) {
      const month = (r.day ?? "").slice(0, 7);
      const key   = `${r.project_id}|${month}`;
      const row   = byKey.get(key) ?? { projectId: parseInt(r.project_id), month, billable: 0, nonBillable: 0 };
      const total    = parseFloat(r.total_hours) || 0;
      const billable = parseFloat(r.billable_hours) || 0;
      row.billable    += billable;
      row.nonBillable += total - billable;
      byKey.set(key, row);
    }

    return NextResponse.json({ rows: [...byKey.values()] });
  } catch (err) {
    console.error("[/api/metrics/hours]", err);
    return NextResponse.json(
      { rows: [], error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
