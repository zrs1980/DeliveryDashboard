import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, fetchRecord } from "@/lib/netsuite";

export interface NSTask {
  id: number;
  title: string;
  budgetedHours: number;
  actualHours: number;
  remainingHours: number;
  status: string;
  parentId: number | null;
  startDate: string | null;
  endDate: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(val: unknown): string | null {
  if (!val || typeof val !== "string") return null;
  // NS REST returns dates in various formats — normalise to YYYY-MM-DD
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function fetchTaskDates(
  taskId: number
): Promise<{ startDate: string | null; endDate: string | null }> {
  try {
    const rec = await fetchRecord<Record<string, unknown>>("projecttask", taskId);
    return {
      startDate: parseDate(rec.startdate ?? rec.startDate),
      endDate:   parseDate(rec.enddate   ?? rec.endDate),
    };
  } catch {
    return { startDate: null, endDate: null };
  }
}

// ─── GET /api/projects/[id]/tasks ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  // 1. Try SuiteQL with parent column first
  let rows: Array<{
    id: string;
    title: string;
    estimatedwork: string;
    actualwork: string;
    status: string;
    parent: string | null;
  }> = [];

  let hasParent = true;
  try {
    rows = await runSuiteQL(`
      SELECT pt.id, pt.title, pt.estimatedwork, pt.actualwork, pt.status, pt.parent
      FROM projecttask pt
      WHERE pt.project = ?
      ORDER BY pt.id ASC
    `, [projectId]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If parent column is not exposed, retry without it
    if (msg.includes("NOT_EXPOSED") || msg.includes("parent")) {
      hasParent = false;
      rows = await runSuiteQL(`
        SELECT pt.id, pt.title, pt.estimatedwork, pt.actualwork, pt.status
        FROM projecttask pt
        WHERE pt.project = ?
        ORDER BY pt.id ASC
      `, [projectId]);
    } else {
      throw err;
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ tasks: [] });
  }

  // 2. Fetch start/end dates in parallel, batched in groups of 10
  const BATCH = 10;
  const dateMap = new Map<number, { startDate: string | null; endDate: string | null }>();

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(r => fetchTaskDates(parseInt(r.id, 10)))
    );
    results.forEach((result, idx) => {
      const taskId = parseInt(batch[idx].id, 10);
      if (result.status === "fulfilled") {
        dateMap.set(taskId, result.value);
      } else {
        dateMap.set(taskId, { startDate: null, endDate: null });
      }
    });
  }

  // 3. Build response
  const tasks: NSTask[] = rows.map(r => {
    const taskId = parseInt(r.id, 10);
    const budgetedHours = parseFloat(r.estimatedwork ?? "0") || 0;
    const actualHours   = parseFloat(r.actualwork    ?? "0") || 0;
    const dates = dateMap.get(taskId) ?? { startDate: null, endDate: null };

    let parentId: number | null = null;
    if (hasParent && r.parent) {
      const p = parseInt(r.parent, 10);
      if (!isNaN(p)) parentId = p;
    }

    return {
      id:             taskId,
      title:          r.title ?? "",
      budgetedHours,
      actualHours,
      remainingHours: budgetedHours - actualHours,
      status:         r.status ?? "1",
      parentId,
      startDate:      dates.startDate,
      endDate:        dates.endDate,
    };
  });

  return NextResponse.json({ tasks });
}
