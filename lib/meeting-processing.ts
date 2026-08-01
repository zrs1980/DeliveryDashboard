// ─── Meeting processing state ─────────────────────────────────────────────────
// One row per Fireflies meeting recording what the Process wizard actually did,
// so a page refresh doesn't make processed meetings look untouched.
//
// Every write here is BEST EFFORT and never throws. The ClickUp tasks, the Slack
// post and the Google Doc are already real by the time we record them — failing
// the request because a bookkeeping insert failed would tell the PM the step
// didn't happen when it did, which is the more damaging error.

import { getSupabaseAdmin } from "./supabase";

export interface ProcessingRow {
  fireflies_id:       string;
  meeting_title:      string | null;
  meeting_date:       string | null;
  meeting_type:       string | null;
  project_ns_id:      string | null;
  project_label:      string | null;
  clickup_list_id:    string | null;
  clickup_task_count: number;
  clickup_tasks:      { id: string; name: string; url: string }[];
  clickup_at:         string | null;
  slack_channel:      string | null;
  slack_ts:           string | null;
  slack_at:           string | null;
  doc_id:             string | null;
  doc_url:            string | null;
  doc_name:           string | null;
  doc_at:             string | null;
  processed_by:       string | null;
  updated_at:         string | null;
}

export const PROCESSING_COLUMNS =
  "fireflies_id, meeting_title, meeting_date, meeting_type, project_ns_id, project_label, " +
  "clickup_list_id, clickup_task_count, clickup_tasks, clickup_at, " +
  "slack_channel, slack_ts, slack_at, doc_id, doc_url, doc_name, doc_at, processed_by, updated_at";

/** Identity + context, written by whichever step runs first. */
export interface ProcessingContext {
  firefliesId:  string;
  meetingTitle?: string | null;
  meetingDate?:  string | null;
  meetingType?:  string | null;
  projectNsId?:  string | null;
  projectLabel?: string | null;
  processedBy?:  string | null;
}

/**
 * Upsert one step's outcome onto the meeting's row.
 *
 * Supabase issues INSERT … ON CONFLICT DO UPDATE over the supplied columns only,
 * so each step patches its own fields without clobbering the others'.
 *
 * Returns a human-readable warning on failure, or null on success — callers
 * surface it alongside the work that did succeed.
 */
export async function recordProcessingStep(
  ctx: ProcessingContext,
  patch: Record<string, unknown>,
): Promise<string | null> {
  if (!ctx.firefliesId) return null;

  const row: Record<string, unknown> = {
    fireflies_id: ctx.firefliesId,
    updated_at:   new Date().toISOString(),
    ...patch,
  };

  // Only write context we were actually given — an omitted field must not
  // overwrite a value an earlier step already recorded.
  if (ctx.meetingTitle != null) row.meeting_title = ctx.meetingTitle;
  if (ctx.meetingDate)         row.meeting_date  = ctx.meetingDate;
  if (ctx.meetingType != null)  row.meeting_type  = ctx.meetingType;
  if (ctx.projectNsId != null)  row.project_ns_id = ctx.projectNsId;
  if (ctx.projectLabel != null) row.project_label = ctx.projectLabel;
  if (ctx.processedBy != null)  row.processed_by  = ctx.processedBy;

  try {
    const db = getSupabaseAdmin();
    const { error } = await db.from("meeting_processing").upsert(row, { onConflict: "fireflies_id" });
    if (error) {
      console.error("[meeting_processing upsert]", error.message);
      return missingTableHint(error.message);
    }
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[meeting_processing upsert]", msg);
    return missingTableHint(msg);
  }
}

/**
 * A missing table is the overwhelmingly likely cause the first time this runs,
 * and the raw PostgREST message ("relation … does not exist") doesn't tell a PM
 * what to do about it.
 */
function missingTableHint(message: string): string {
  if (/does not exist|schema cache|relation/i.test(message)) {
    return `The work completed, but recording it failed: the meeting_processing table is missing. Run supabase/meeting-processing-schema.sql in the Supabase SQL editor, or processed meetings will keep looking unprocessed after a refresh. (${message})`;
  }
  return `The work completed, but recording it failed (${message}), so this meeting may still look unprocessed after a refresh.`;
}
