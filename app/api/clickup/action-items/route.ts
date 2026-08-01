import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createTask,
  fetchListFields,
  findPhaseTarget,
  resolveClickUpListId,
  INTERNAL_ACTION_POINTS,
  PHASE_FIELD_NAME,
  type PhaseFieldTarget,
} from "@/lib/clickup";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * POST /api/clickup/action-items
 * { clickupUrl, tasks: [{ name, description }], meetingTitle?, meetingDate?, docUrl? }
 *
 * Creates one ClickUp task per action item in the project's own list, tagged with
 * the "Phase (v4)" = "8. Internal Action Points" custom field.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if (!process.env.CLICKUP_API_TOKEN) {
      return NextResponse.json(
        { error: "CLICKUP_API_TOKEN is not configured. Add it in Vercel and redeploy." },
        { status: 503 },
      );
    }

    const body       = await req.json();
    const clickupUrl = String(body?.clickupUrl ?? "");
    const rawTasks   = Array.isArray(body?.tasks) ? body.tasks : [];

    const tasks = rawTasks
      .map((t: { name?: unknown; description?: unknown }) => ({
        name:        String(t?.name ?? "").trim(),
        description: String(t?.description ?? "").trim(),
      }))
      .filter((t: { name: string }) => t.name);

    if (tasks.length === 0) {
      return NextResponse.json({ error: "No action items to create." }, { status: 400 });
    }

    const listId = await resolveClickUpListId(clickupUrl);
    if (!listId) {
      return NextResponse.json({
        error: "This project has no usable ClickUp list. Set custentity20 on the NetSuite project to the project's ClickUp list URL.",
      }, { status: 400 });
    }

    // Resolve the phase field per list. The ids happen to be workspace-wide today,
    // but hardcoding them would break silently the moment a list is rebuilt.
    let phase: PhaseFieldTarget | null = null;
    let phaseWarning: string | null = null;
    try {
      phase = findPhaseTarget(await fetchListFields(listId), INTERNAL_ACTION_POINTS);
      if (!phase) {
        phaseWarning = `This ClickUp list has no "${PHASE_FIELD_NAME}" field with an "${INTERNAL_ACTION_POINTS}" option, so the tasks were created without it. Add the field in ClickUp, or set it by hand.`;
      }
    } catch (e) {
      phaseWarning = `The ClickUp custom fields couldn't be read (${e instanceof Error ? e.message : "unknown error"}), so the tasks were created without the phase set.`;
    }

    // Footer links the task back to where it came from — cheap and saves a lot of
    // "where did this come from?" later.
    const footerParts = [
      body?.meetingTitle ? `Meeting: ${body.meetingTitle}` : null,
      body?.meetingDate  ? `Date: ${body.meetingDate}`     : null,
      body?.docUrl       ? `Transcript: ${body.docUrl}`    : null,
    ].filter(Boolean);
    const footer = footerParts.length ? `\n\n---\n${footerParts.join("\n")}` : "";

    // Sequential, not parallel: ClickUp rate-limits writes, and a partial failure
    // is far easier to report when we know exactly how far we got.
    const created: { name: string; id: string; url: string }[] = [];
    const failed:  { name: string; error: string }[] = [];

    for (const t of tasks) {
      try {
        const task = await createTask({
          listId,
          name:        t.name,
          description: `${t.description}${footer}`,
          phase,
        });
        created.push({ name: t.name, id: task.id, url: task.url });
      } catch (e) {
        failed.push({ name: t.name, error: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    return NextResponse.json({
      created,
      failed,
      listId,
      phaseApplied: !!phase,
      warning: phaseWarning,
    });
  } catch (err) {
    console.error("[/api/clickup/action-items]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
