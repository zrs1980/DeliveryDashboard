import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

/**
 * GET /api/pm/meetings?projectNsId=18628
 *
 * Meetings recorded against a project by the Process wizard, newest first.
 *
 * `meeting_processing` is the single source of truth — `meeting_docs` has been
 * retired, so there is no second table to merge with.
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

  const proc = await db
    .from("meeting_processing")
    .select("fireflies_id, meeting_title, meeting_date, meeting_type, doc_url, doc_name, slack_channel, clickup_task_count, clickup_tasks, processed_by, updated_at")
    .eq("project_ns_id", projectNsId);

  if (proc.error) warnings.push(tableHint("meeting_processing", proc.error.message));

  const meetings: PMMeeting[] = (proc.data ?? []).map(p => ({
    firefliesId:  p.fireflies_id,
    title:        p.meeting_title,
    date:         p.meeting_date,
    meetingType:  p.meeting_type,
    docUrl:       p.doc_url,
    docName:      p.doc_name,
    slackChannel: p.slack_channel,
    taskCount:    p.clickup_task_count ?? 0,
    tasks:        Array.isArray(p.clickup_tasks) ? p.clickup_tasks : [],
    processedBy:  p.processed_by,
    processedAt:  p.updated_at,
  }));

  meetings.sort((a, b) => {
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
