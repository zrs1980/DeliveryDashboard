import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateTaskStatus } from "@/lib/clickup";

export const revalidate = 0;

/**
 * POST /api/clickup/task-status
 * { taskId, status }
 *
 * → { taskId, status }   where `status` is what ClickUp reports AFTER the write.
 *
 * The response status is echoed back from ClickUp rather than from the request
 * so the grid renders what actually landed. A list automation reacting to the
 * change can return something other than what was asked for, and a grid showing
 * the requested value would then disagree with ClickUp until the next refresh.
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

  let body: { taskId?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const taskId = String(body?.taskId ?? "").trim();
  const status = String(body?.status ?? "").trim();

  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  if (!status) return NextResponse.json({ error: "status is required" }, { status: 400 });

  try {
    const applied = await updateTaskStatus(taskId, status);
    return NextResponse.json({ taskId, status: applied });
  } catch (err) {
    console.error("[/api/clickup/task-status]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
