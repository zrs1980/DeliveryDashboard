import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/auth";
import {
  applyPhase,
  createTask,
  fetchListFields,
  fetchListMembers,
  fetchTaskFieldValue,
  phaseFieldOptions,
  resolveClickUpListId,
  PHASE_FIELD_NAME,
  type PhaseFieldTarget,
} from "@/lib/clickup";

export const revalidate = 0;
export const maxDuration = 60;

/** Same settle time as /api/clickup/action-items — see AUTOMATION_SETTLE_MS there. */
const AUTOMATION_SETTLE_MS = 15_000;

const NO_TOKEN = "CLICKUP_API_TOKEN is not configured. Add it in Vercel and redeploy.";
const NO_LIST  = "This project has no usable ClickUp list. Set custentity20 on the NetSuite project to the project's ClickUp list URL.";

/**
 * The list a task goes into. The Tasks tab sends the list id its loaded tasks
 * already carry (resolved by ClickUp itself) and falls back to the project's
 * custentity20 URL, which may be a view URL needing the API to resolve.
 */
async function listIdFrom(listId: unknown, clickupUrl: unknown): Promise<string | null> {
  const direct = String(listId ?? "").trim();
  if (/^\d+$/.test(direct)) return direct;
  return resolveClickUpListId(String(clickupUrl ?? "") || null);
}

/**
 * GET /api/clickup/tasks?listId=&clickupUrl=[&members=only]
 * → { listId, members, section: { fieldId, isMulti, options } | null, sectionError? }
 *
 * What the Create Task form needs for one project: who can be assigned, and the
 * sections (the list's "Phase (v4)" options) a task can be filed under.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.CLICKUP_API_TOKEN) return NextResponse.json({ error: NO_TOKEN }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const listId = await listIdFrom(sp.get("listId"), sp.get("clickupUrl"));
  if (!listId) return NextResponse.json({ error: NO_LIST }, { status: 400 });

  // ?members=only — the assignee editor in the grid needs no sections.
  if (sp.get("members") === "only") {
    try {
      return NextResponse.json({ listId, members: await fetchListMembers(listId), section: null, sectionError: null });
    } catch (e) {
      console.error("[/api/clickup/tasks GET] members", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't load list members" }, { status: 502 });
    }
  }

  // Independent lookups — a failure in one shouldn't hide the other.
  const [members, fields] = await Promise.allSettled([fetchListMembers(listId), fetchListFields(listId)]);
  if (members.status === "rejected") {
    console.error("[/api/clickup/tasks GET] members", members.reason);
    return NextResponse.json(
      { error: members.reason instanceof Error ? members.reason.message : "Couldn't load list members" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    listId,
    members: members.value,
    section: fields.status === "fulfilled" ? phaseFieldOptions(fields.value) : null,
    sectionError: fields.status === "rejected"
      ? (fields.reason instanceof Error ? fields.reason.message : "Couldn't read the list's custom fields")
      : null,
  });
}

/**
 * POST /api/clickup/tasks
 * { listId?, clickupUrl?, name, description?, priority?, assignees?, dueDate?, section?, parent? }
 *   section — { fieldId, optionId, isMulti } from the GET above
 *   parent  — task id; the new task is created as its subtask
 * → { task, warning }
 *
 * Creates one task from the Tasks tab's Create Task form.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.CLICKUP_API_TOKEN) return NextResponse.json({ error: NO_TOKEN }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A task name is required" }, { status: 400 });

  const p = body.priority;
  if (p != null && !(Number.isInteger(p) && (p as number) >= 1 && (p as number) <= 4)) {
    return NextResponse.json({ error: "priority must be 1–4 or null" }, { status: 400 });
  }
  const d = body.dueDate;
  if (d != null && !(typeof d === "number" && Number.isFinite(d) && d > 0)) {
    return NextResponse.json({ error: "dueDate must be Unix ms or null" }, { status: 400 });
  }
  const assignees = Array.isArray(body.assignees)
    ? body.assignees.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : [];

  const s = body.section as { fieldId?: unknown; optionId?: unknown; isMulti?: unknown } | null | undefined;
  const phase: PhaseFieldTarget | null = s && s.fieldId && s.optionId
    ? { fieldId: String(s.fieldId), optionId: String(s.optionId), isMulti: s.isMulti === true }
    : null;

  const listId = await listIdFrom(body.listId, body.clickupUrl);
  if (!listId) return NextResponse.json({ error: NO_LIST }, { status: 400 });

  let created;
  try {
    created = await createTask({
      listId,
      name,
      description: typeof body.description === "string" ? body.description.trim() : "",
      phase,
      priority:  (p as number | null) ?? null,
      assignees,
      dueDate:   (d as number | null) ?? null,
      parent:    typeof body.parent === "string" && body.parent.trim() ? body.parent.trim() : null,
    });
  } catch (err) {
    console.error("[/api/clickup/tasks POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 502 });
  }

  // A create-triggered list automation can overwrite the phase ~10s later (see
  // CLAUDE.md, Process meeting). Put it back after the response is sent, so the
  // form doesn't sit waiting 15s for a correction that is usually not needed.
  if (phase) {
    after(async () => {
      await new Promise(r => setTimeout(r, AUTOMATION_SETTLE_MS));
      try {
        const current = await fetchTaskFieldValue(created.id, phase.fieldId);
        if (current.length === 1 && current[0] === phase.optionId) return;
        await applyPhase(created.id, phase, current);
      } catch (e) {
        console.error(`[/api/clickup/tasks] couldn't re-assert ${PHASE_FIELD_NAME} on ${created.id}`, e);
      }
    });
  }

  return NextResponse.json({
    task: created.task,
    warning: assignees.length && !(created.task.assignees?.length)
      ? "ClickUp created the task but didn't keep the assignees — check them in ClickUp."
      : null,
  });
}
