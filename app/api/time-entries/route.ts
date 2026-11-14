import { NextRequest, NextResponse } from "next/server";
import { runSuiteQLAll } from "@/lib/netsuite";
import { getStaffRoster, nameFor } from "@/lib/roster";

export const revalidate = 0;

/**
 * GET /api/time-entries?projectIds=1,2,3&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Individual time entries on the given projects — the Projects tab's Time
 * Entries section. Actual worked time only (`timetype = 'A'`): 'B' rows are
 * allocations and 'P' planned, neither of which anyone logged.
 *
 * The caller passes the project ids rather than this route choosing them, so the
 * section can only ever show projects the Projects tab itself is showing.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-02" → "11/02/2026", the literal format the other timebill routes use. */
function nsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

interface TimebillRow {
  id:         string;
  trandate:   string;           // YYYY-MM-DD via TO_CHAR
  project_id: string;
  employee:   string;
  task_id:    string | null;
  memo:       string | null;
  hours:      string;
  isbillable:   string | null;
  isutilized:   string | null;
  isproductive: string | null;
  approval_label: string | null;
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
  if (projectIds.length === 0) {
    return NextResponse.json({ entries: [], updatedAt: new Date().toISOString() });
  }

  try {
    const [rows, roster] = await Promise.all([
      runSuiteQLAll<TimebillRow>(`
        SELECT
          tb.id,
          TO_CHAR(tb.trandate, 'YYYY-MM-DD') AS trandate,
          tb.customer       AS project_id,
          tb.employee,
          tb.casetaskevent  AS task_id,
          tb.memo,
          tb.hours,
          tb.isbillable,
          tb.isutilized,
          tb.isproductive,
          BUILTIN.DF(tb.approvalstatus) AS approval_label
        FROM timebill tb
        WHERE tb.customer IN (${projectIds.join(",")})
          AND tb.timetype = 'A'
          AND tb.trandate >= TO_DATE('${nsDate(from)}', 'MM/DD/YYYY')
          AND tb.trandate <= TO_DATE('${nsDate(to)}',   'MM/DD/YYYY')
        ORDER BY tb.trandate DESC, tb.id DESC
      `),
      getStaffRoster(),
    ]);

    // Task/phase titles. timebill.casetaskevent maps to projecttask.id (verified in
    // /api/projects/[id]/tasks), and id/title are both exposed on projecttask.
    // Resolved separately rather than via BUILTIN.DF so a failure here costs the
    // Task/Phase column, not the whole table.
    const taskIds = [...new Set(rows.map(r => r.task_id).filter((t): t is string => !!t && /^\d+$/.test(t)))];
    const taskTitle: Record<string, string> = {};
    if (taskIds.length > 0) {
      try {
        const taskRows = await runSuiteQLAll<{ id: string; title: string | null }>(`
          SELECT id, title FROM projecttask WHERE id IN (${taskIds.join(",")})
        `);
        for (const t of taskRows) taskTitle[t.id] = (t.title ?? "").trim();
      } catch (err) {
        console.error("[/api/time-entries] task title lookup failed:", err);
      }

      // casetaskevent can also point at a support case (MSA time is usually logged
      // against one). Ids that aren't project tasks are looked up as cases and
      // shown as "Case #1178 — title".
      const caseIds = taskIds.filter(id => !(id in taskTitle));
      if (caseIds.length > 0) {
        try {
          const caseRows = await runSuiteQLAll<{ id: string; casenumber: string | null; title: string | null }>(`
            SELECT id, casenumber, title FROM supportcase WHERE id IN (${caseIds.join(",")})
          `);
          for (const c of caseRows) {
            const title = (c.title ?? "").trim();
            taskTitle[c.id] = c.casenumber ? `Case #${c.casenumber}${title ? ` — ${title}` : ""}` : title;
          }
        } catch (err) {
          console.error("[/api/time-entries] case title lookup failed:", err);
        }
      }
    }

    const entries = rows.map(r => ({
      id:           parseInt(r.id),
      date:         r.trandate,
      projectId:    parseInt(r.project_id),
      employeeId:   parseInt(r.employee),
      employeeName: nameFor(roster, r.employee),
      taskName:     r.task_id ? (taskTitle[r.task_id] || null) : null,
      memo:         (r.memo ?? "").trim(),
      hours:        parseFloat(r.hours) || 0,
      // `=== "T"`: SuiteQL omits a never-set checkbox entirely (see CLAUDE.md).
      isBillable:   r.isbillable   === "T",
      isUtilized:   r.isutilized   === "T",
      isProductive: r.isproductive === "T",
      approvalStatus: (r.approval_label ?? "").trim(),
    }));

    return NextResponse.json({
      entries,
      rosterFallback: roster.fallback,
      updatedAt:      new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/time-entries]", err);
    return NextResponse.json(
      { entries: [], error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
