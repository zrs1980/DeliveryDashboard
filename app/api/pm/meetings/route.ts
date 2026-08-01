import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

/**
 * GET /api/pm/meetings?projectNsId=18628
 *
 * Meetings recorded against a project by the Process wizard, newest first.
 *
 * Reads both tables and merges on fireflies_id: `meeting_processing` covers
 * everything processed since that table existed, `meeting_docs` covers meetings
 * filed before it, which would otherwise vanish from this list.
 */
export interface PMMeeting {
  firefliesId:   string;
  title:         string | null;
  date:          string | null;
  meetingType:   string | null;
  docUrl:        string | null;
  docName:       string | null;
  slackChannel:  string | null;
  taskCount:     number;
  tasks:         { id: string; name: string; url: string }[];
  processedBy:   string | null;
  processedAt:   string | null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectNsId = (req.nextUrl.searchParams.get("projectNsId") ?? "").trim();
  if (!projectNsId) {
    return NextResponse.json({ error: "projectNsId is required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const warnings: string[] = [];
  const byId = new Map<string, PMMeeting>();

  // Filed documents first, so processing rows can enrich them below.
  const docs = await db
    .from("meeting_docs")
    .select("fireflies_id, meeting_title, meeting_date, meeting_type, doc_url, doc_name, created_by, created_at")
    .eq("project_ns_id", projectNsId);

  if (docs.error) warnings.push(tableHint("meeting_docs", docs.error.message));
  for (const d of docs.data ?? []) {
    byId.set(d.fireflies_id, {
      firefliesId:  d.fireflies_id,
      title:        d.meeting_title,
      date:         d.meeting_date,
      meetingType:  d.meeting_type,
      docUrl:       d.doc_url,
      docName:      d.doc_name,
      slackChannel: null,
      taskCount:    0,
      tasks:        [],
      processedBy:  d.created_by,
      processedAt:  d.created_at,
    });
  }

  const proc = await db
    .from("meeting_processing")
    .select("fireflies_id, meeting_title, meeting_date, meeting_type, doc_url, doc_name, slack_channel, clickup_task_count, clickup_tasks, processed_by, updated_at")
    .eq("project_ns_id", projectNsId);

  if (proc.error) warnings.push(tableHint("meeting_processing", proc.error.message));
  for (const p of proc.data ?? []) {
    const existing = byId.get(p.fireflies_id);
    byId.set(p.fireflies_id, {
      firefliesId:  p.fireflies_id,
      // Prefer the processing row, but never blank out something the doc row knew.
      title:        p.meeting_title ?? existing?.title ?? null,
      date:         p.meeting_date  ?? existing?.date  ?? null,
      meetingType:  p.meeting_type  ?? existing?.meetingType ?? null,
      docUrl:       p.doc_url       ?? existing?.docUrl ?? null,
      docName:      p.doc_name      ?? existing?.docName ?? null,
      slackChannel: p.slack_channel ?? null,
      taskCount:    p.clickup_task_count ?? 0,
      tasks:        Array.isArray(p.clickup_tasks) ? p.clickup_tasks : [],
      processedBy:  p.processed_by  ?? existing?.processedBy ?? null,
      processedAt:  p.updated_at    ?? existing?.processedAt ?? null,
    });
  }

  const meetings = [...byId.values()].sort((a, b) => {
    const at = a.date ? Date.parse(a.date) : 0;
    const bt = b.date ? Date.parse(b.date) : 0;
    return bt - at; // newest first
  });

  return NextResponse.json({
    meetings,
    totals: {
      count:      meetings.length,
      withDoc:    meetings.filter(m => m.docUrl).length,
      withSlack:  meetings.filter(m => m.slackChannel).length,
      taskCount:  meetings.reduce((s, m) => s + m.taskCount, 0),
    },
    warning: warnings.join(" ") || null,
  });
}

/** A missing table is the likely first-run cause, and PostgREST's message doesn't say what to do. */
function tableHint(table: string, message: string): string {
  return /does not exist|schema cache|relation/i.test(message)
    ? `The ${table} table is missing — run supabase/${table.replace("_", "-")}-schema.sql in the Supabase SQL editor.`
    : `${table} could not be read: ${message}`;
}
