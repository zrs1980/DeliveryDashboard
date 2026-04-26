import { NextRequest, NextResponse } from "next/server";
import { resolvePortalUser } from "@/lib/supabase-portal";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchListTasks, resolveClickUpListId } from "@/lib/clickup";
import { runSuiteQL } from "@/lib/netsuite";
import { CLICKUP_LIST_OVERRIDES } from "@/lib/constants";

export const revalidate = 0;

interface NSJob {
  id: string;
  clickup_url: string | null;
}

// GET /api/portal/projects/[id]/tasks
// Returns tasks for a project — customer must have access
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await resolvePortalUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify access
  const db = getSupabaseAdmin();
  const { data: access } = await db
    .from("project_portal_access")
    .select("id")
    .eq("customer_ns_id", user.customer_ns_id)
    .eq("project_ns_id", projectId)
    .single();

  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Get ClickUp list ID for this project
  const nsId = parseInt(projectId);
  let listId: string | null = CLICKUP_LIST_OVERRIDES[nsId] ?? null;

  if (!listId) {
    const [job] = await runSuiteQL<NSJob>(`
      SELECT id, custentity20 AS clickup_url FROM job WHERE id = ${projectId}
    `);
    if (job?.clickup_url) {
      listId = await resolveClickUpListId(job.clickup_url);
    }
  }

  if (!listId) return NextResponse.json({ tasks: [] });

  const allTasks = await fetchListTasks(listId);

  // Filter to non-internal tasks (no 'internal' tag) and format for customer view
  const tasks = allTasks
    .filter(t => !t.tags.some(tag => tag.name.toLowerCase() === "internal"))
    .map(t => ({
      id:          t.id,
      name:        t.name,
      status:      t.status.status,
      statusColor: t.status.color,
      dueDate:     t.due_date,
      isOverdue:   !!t.due_date && parseInt(t.due_date) < Date.now() && !["done","complete","supplied"].includes(t.status.status.toLowerCase()),
      assignees:   t.assignees.map(a => a.username),
      tags:        t.tags.map(tag => tag.name),
      timeEstimate: t.time_estimate ? Math.round(t.time_estimate / 3600000 * 10) / 10 : null,
      timeSpent:   t.time_spent    ? Math.round(t.time_spent    / 3600000 * 10) / 10 : null,
      isAwaitingConfirmation: t.status.status.toLowerCase() === "awaiting confirmation"
        || t.tags.some(tag => tag.name.toLowerCase() === "client"),
      isMilestone: t.tags.some(tag => tag.name.toLowerCase() === "milestone"),
      url:         t.url,
    }));

  // Fetch external (non-internal) notes for this project
  const { data: notes } = await db
    .from("task_notes")
    .select("*")
    .eq("project_ns_id", projectId)
    .eq("is_internal", false)
    .order("created_at", { ascending: true });

  // Fetch approvals for this project by this customer
  const { data: approvals } = await db
    .from("task_approvals")
    .select("*")
    .eq("project_ns_id", projectId)
    .eq("customer_ns_id", user.customer_ns_id);

  const approvedTaskIds = new Set((approvals ?? []).map((a: { clickup_task_id: string }) => a.clickup_task_id));
  const notesByTaskId: Record<string, typeof notes> = {};
  for (const note of notes ?? []) {
    if (!notesByTaskId[(note as { clickup_task_id: string }).clickup_task_id]) {
      notesByTaskId[(note as { clickup_task_id: string }).clickup_task_id] = [];
    }
    notesByTaskId[(note as { clickup_task_id: string }).clickup_task_id]!.push(note);
  }

  const enriched = tasks.map(t => ({
    ...t,
    isApproved: approvedTaskIds.has(t.id),
    approval:   (approvals ?? []).find((a: { clickup_task_id: string }) => a.clickup_task_id === t.id) ?? null,
    notes:      notesByTaskId[t.id] ?? [],
  }));

  return NextResponse.json({ tasks: enriched });
}
