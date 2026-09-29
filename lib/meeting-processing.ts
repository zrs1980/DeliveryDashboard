// ─── Meeting processing state ─────────────────────────────────────────────────
// One row per Fireflies meeting recording what the Process wizard actually did,
// so a page refresh doesn't make processed meetings look untouched.
//
// Every write here is BEST EFFORT and never throws. The ClickUp tasks, the Slack
// post and the Google Doc are already real by the time we record them — failing
// the request because a bookkeeping insert failed would tell the PM the step
// didn't happen when it did, which is the more damaging error.

import { getSupabaseAdmin } from "./supabase";
import { customerOfProject } from "./cs-customers";

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
    await recordMeetingActivity(ctx);
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


/**
 * Put the meeting on its customer's timeline.
 *
 * ⚠ A processed meeting used to be invisible outside this table. It is a real
 * conversation with a real customer — the single most useful thing on an
 * account's timeline — and neither the CRM account page nor any silence signal
 * knew it had happened.
 *
 * Three things make this awkward, and all three are handled here rather than at
 * the call sites:
 *
 *  1. **It runs three times.** Each wizard step upserts separately, so this is
 *     reached once per step. `source = "meeting:<firefliesId>"` is the identity
 *     and an existing row short-circuits, which also spares NetSuite two
 *     lookups per meeting.
 *  2. **There is no customer on the meeting.** The wizard records a PROJECT.
 *     `meeting_processing.customer_ns_id` was added for exactly this join and
 *     has been 100% NULL since; it gets written here too, so the column finally
 *     means something.
 *  3. **A meeting with no project cannot be attributed.** No row is written —
 *     guessing which customer a call belonged to would put a wrong fact on a
 *     timeline, which is worse than a thin one.
 *
 * Never throws, like everything else in this file.
 */
async function recordMeetingActivity(ctx: ProcessingContext): Promise<void> {
  if (!ctx.projectNsId) return;

  const source = `meeting:${ctx.firefliesId}`;
  try {
    const db = getSupabaseAdmin();

    const { data: existing, error: readErr } = await db
      .from("pm_crm_activities")
      .select("id, link_url")
      .eq("source", source)
      .limit(1);
    // A failed read is NOT "no row exists". Inserting on a read failure is how
    // you get three copies of the same meeting on a timeline.
    if (readErr) return;

    // ⚠ The Drive step usually runs AFTER the ClickUp and Slack steps, so the
    // first call through here has no doc yet and the row is written without a
    // link. Rather than leaving it linkless forever, a later step fills it in.
    // Read the doc off the row instead of this call's patch, because the patch
    // only carries what the CURRENT step wrote.
    const { data: mp } = await db
      .from("meeting_processing")
      .select("doc_url, doc_name")
      .eq("fireflies_id", ctx.firefliesId)
      .maybeSingle();

    if (existing?.length) {
      if (mp?.doc_url && !existing[0].link_url) {
        await db.from("pm_crm_activities")
          .update({ link_url: mp.doc_url, link_label: mp.doc_name || "Meeting summary" })
          .eq("id", existing[0].id);
      }
      return;
    }

    const customer = await customerOfProject(ctx.projectNsId);
    if (!customer) return;

    await db.from("pm_crm_activities").insert({
      customer_ns_id: customer.customerNsId,
      kind:           "meeting",
      direction:      "outbound",
      subject:        ctx.meetingTitle || "Meeting",
      body:           ctx.meetingType ? `${ctx.meetingType} · ${ctx.projectLabel ?? ""}`.trim() : (ctx.projectLabel ?? null),
      // The meeting happened when it happened, not when someone got round to
      // processing it. A timeline ordered by processing time reads as fiction.
      occurred_at:    ctx.meetingDate || new Date().toISOString(),
      actor_email:    ctx.processedBy ?? null,
      // The filed summary doc — the whole reason this row is worth opening.
      link_url:       mp?.doc_url ?? null,
      link_label:     mp?.doc_url ? (mp.doc_name || "Meeting summary") : null,
      source,
    });

    await db.from("meeting_processing")
      .update({ customer_ns_id: customer.customerNsId })
      .eq("fireflies_id", ctx.firefliesId);
  } catch (e) {
    console.error("[meeting activity]", e instanceof Error ? e.message : e);
  }
}
