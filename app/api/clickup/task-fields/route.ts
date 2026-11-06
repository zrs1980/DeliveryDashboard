import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateTaskFields } from "@/lib/clickup";

export const revalidate = 0;

/**
 * POST /api/clickup/task-fields
 * { taskId, priority?, dueDate? }
 *
 *   priority — 1 urgent · 2 high · 3 normal · 4 low · null to clear
 *   dueDate  — Unix ms · null to clear
 *
 * Omit a field to leave it unchanged. → { taskId, priority, due_date } as
 * ClickUp reports them after the write (see /api/clickup/task-status for why).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.CLICKUP_API_TOKEN) {
    return NextResponse.json(
      { error: "CLICKUP_API_TOKEN is not configured. Add it in Vercel and redeploy." },
      { status: 503 },
    );
  }

  let body: { taskId?: unknown; priority?: unknown; dueDate?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const taskId = String(body?.taskId ?? "").trim();
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const fields: { priority?: number | null; dueDate?: number | null } = {};

  if ("priority" in body) {
    const p = body.priority;
    if (p !== null && !(Number.isInteger(p) && (p as number) >= 1 && (p as number) <= 4)) {
      return NextResponse.json({ error: "priority must be 1–4 or null" }, { status: 400 });
    }
    fields.priority = p as number | null;
  }

  if ("dueDate" in body) {
    const d = body.dueDate;
    if (d !== null && !(typeof d === "number" && Number.isFinite(d) && d > 0)) {
      return NextResponse.json({ error: "dueDate must be Unix ms or null" }, { status: 400 });
    }
    fields.dueDate = d as number | null;
  }

  if (fields.priority === undefined && fields.dueDate === undefined) {
    return NextResponse.json({ error: "Nothing to update — send priority and/or dueDate" }, { status: 400 });
  }

  try {
    const applied = await updateTaskFields(taskId, fields);
    return NextResponse.json({ taskId, ...applied });
  } catch (err) {
    console.error("[/api/clickup/task-fields]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
