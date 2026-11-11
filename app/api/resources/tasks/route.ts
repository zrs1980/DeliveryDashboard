import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL, postRecord } from "@/lib/netsuite";
import { TASK_ALLOCATION_PROJECT_IDS } from "@/lib/constants";

export const revalidate = 0;

/**
 * Tasks of a task-allocated project (TASK_ALLOCATION_PROJECT_IDS — today the
 * capacity-planning placeholder, 18414), for the Resource Allocation tab.
 *
 *   GET  ?projectId=18414         → { tasks: [{ id, title }] }
 *   POST { projectId, title }     → { id, title }   creates the task in NetSuite
 *
 * Both are limited to TASK_ALLOCATION_PROJECT_IDS, so this can't be used to read
 * or add tasks on a delivery project's plan.
 */

function allowedProject(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && TASK_ALLOCATION_PROJECT_IDS.has(id) ? id : null;
}

export async function GET(req: NextRequest) {
  const projectId = allowedProject(req.nextUrl.searchParams.get("projectId"));
  if (!projectId) return NextResponse.json({ error: "Tasks are only available for the capacity-planning project" }, { status: 400 });

  try {
    const rows = await runSuiteQL<{ id: string; title: string | null }>(`
      SELECT pt.id, pt.title
      FROM projecttask pt
      WHERE pt.project = ?
      ORDER BY pt.title
    `, [projectId]);
    const tasks = rows
      .map(r => ({ id: String(r.id), title: (r.title ?? "").trim() || `Task ${r.id}` }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    return NextResponse.json({ tasks });
  } catch (err) {
    console.error("[GET /api/resources/tasks]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { projectId?: unknown; title?: unknown };
  const projectId = allowedProject(body.projectId);
  const title     = String(body.title ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "Tasks can only be created on the capacity-planning project" }, { status: 400 });
  if (!title)     return NextResponse.json({ error: "Task name is required" }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: "Task name is too long (200 characters max)" }, { status: 400 });

  try {
    // Don't create a duplicate: a task with this name already on the project is
    // returned instead, so two people adding "Yaffe" end up on the same task.
    const existing = await runSuiteQL<{ id: string; title: string | null }>(`
      SELECT pt.id, pt.title FROM projecttask pt
      WHERE pt.project = ? AND LOWER(TRIM(pt.title)) = ?
      FETCH FIRST 1 ROW ONLY
    `, [projectId, title.toLowerCase()]);
    if (existing[0]) {
      return NextResponse.json({ id: String(existing[0].id), title: (existing[0].title ?? title).trim(), existed: true });
    }

    // The project reference is `project` on the REST record, same as the SuiteQL
    // column. Verified: sending `company` instead fails with FIELD_PARAM_REQD
    // "Please enter a value for [project]".
    const id = await postRecord("projectTask", { title, project: { id: String(projectId) } });

    console.log(`[resources/tasks] ${session.user.email ?? "unknown"} created task ${id} "${title}" on project ${projectId}`);
    return NextResponse.json({ id, title });
  } catch (err) {
    console.error("[POST /api/resources/tasks]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
