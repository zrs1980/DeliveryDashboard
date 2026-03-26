import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, fetchRecord, fetchFieldSelectOptions } from "@/lib/netsuite";

export interface NSTask {
  id: number;
  title: string;
  budgetedHours: number;
  actualHours: number;
  remainingHours: number;
  status: string;        // SuiteQL raw status ID
  statusLabel: string;   // display name from REST record refName
  statusRestId: string;  // ID as returned by REST record (use this for PATCH)
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

async function fetchTaskDetails(
  taskId: number
): Promise<{ startDate: string | null; endDate: string | null; statusRestId: string; statusLabel: string }> {
  try {
    const rec = await fetchRecord<Record<string, unknown>>("projecttask", taskId);
    // status comes back as { id: "...", refName: "..." } from REST
    const statusObj = rec.status as Record<string, string> | string | null | undefined;
    const statusRestId = typeof statusObj === "object" && statusObj !== null
      ? (statusObj.id ?? "")
      : String(statusObj ?? "");
    const statusLabel = typeof statusObj === "object" && statusObj !== null
      ? (statusObj.refName ?? statusRestId)
      : statusRestId;
    return {
      startDate:   parseDate(rec.startdate ?? rec.startDate),
      endDate:     parseDate(rec.enddate   ?? rec.endDate),
      statusRestId,
      statusLabel,
    };
  } catch {
    return { startDate: null, endDate: null, statusRestId: "", statusLabel: "" };
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
    return NextResponse.json({ tasks: [], allStatuses: [] });
  }

  // Fetch ALL possible status options from the NS metadata catalog
  // (not just statuses currently used — ensures Completed etc. always appear)
  let allStatuses: { id: string; label: string }[] = [];
  try {
    allStatuses = await fetchFieldSelectOptions("projecttask", "status");
  } catch {
    // Non-fatal — fall back to per-task statuses derived from REST records in the component
  }

  // 2. Fetch start/end dates sequentially in small batches to avoid NS concurrency limits
  const BATCH = 3;
  const DELAY = 300; // ms between batches
  const detailMap = new Map<number, { startDate: string | null; endDate: string | null; statusRestId: string; statusLabel: string }>();

  for (let i = 0; i < rows.length; i += BATCH) {
    if (i > 0) await new Promise(r => setTimeout(r, DELAY));
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(r => fetchTaskDetails(parseInt(r.id, 10)))
    );
    results.forEach((result, idx) => {
      const taskId = parseInt(batch[idx].id, 10);
      if (result.status === "fulfilled") {
        detailMap.set(taskId, result.value);
      } else {
        detailMap.set(taskId, { startDate: null, endDate: null, statusRestId: "", statusLabel: "" });
      }
    });
  }

  // 3. Build response
  const tasks: NSTask[] = rows.map(r => {
    const taskId = parseInt(r.id, 10);
    const budgetedHours = parseFloat(r.estimatedwork ?? "0") || 0;
    const actualHours   = parseFloat(r.actualwork    ?? "0") || 0;
    const details = detailMap.get(taskId) ?? { startDate: null, endDate: null, statusRestId: r.status ?? "", statusLabel: "" };

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
      status:         r.status ?? "",
      statusRestId:   details.statusRestId || r.status || "",
      statusLabel:    details.statusLabel  || r.status || "",
      parentId,
      startDate:      details.startDate,
      endDate:        details.endDate,
    };
  });

  return NextResponse.json({ tasks, allStatuses });
}
