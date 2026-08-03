import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createGoogleDoc, DriveError, ensureTranscriptFolder, extractDriveFolderId } from "@/lib/google-drive";
import { fetchFirefliesTranscript, firefliesConfigured } from "@/lib/fireflies";
import { meetingDocName, renderMeetingDocHtml, type MeetingDocInput } from "@/lib/meeting-doc";
import { MEETING_TYPES } from "@/lib/constants";
import { recordProcessingStep } from "@/lib/meeting-processing";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * POST /api/meeting-docs
 * { meeting, projectNsId, projectLabel, projectFolderUrl, meetingType, includeTranscript? }
 *
 * Files the transcript into <project folder>/Transcripts, records it, returns the link.
 *
 * `meeting_processing` is the single source of truth — the old `meeting_docs`
 * table has been retired. It held only the Doc, duplicating three columns
 * `meeting_processing` now stores, and its `fireflies_id` uniqueness was the only
 * thing standing between a re-run and a second Google Doc. `meeting_processing`
 * already has that same unique key, so one table does the job.
 *
 * There is no GET here any more: the grid reads /api/meetings/processing, which
 * returns the Doc alongside the ClickUp and Slack state in a single request.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body        = await req.json();
    const meeting     = body?.meeting;
    const meetingType = String(body?.meetingType ?? "");
    const folderUrl   = String(body?.projectFolderUrl ?? "");
    const includeTx   = body?.includeTranscript !== false;

    if (!meeting?.id) return NextResponse.json({ error: "meeting is required" }, { status: 400 });
    if (!MEETING_TYPES.includes(meetingType as typeof MEETING_TYPES[number])) {
      return NextResponse.json({ error: "A valid meeting type is required." }, { status: 400 });
    }

    const projectFolderId = extractDriveFolderId(folderUrl);
    if (!projectFolderId) {
      return NextResponse.json({
        error: "This project has no usable Google Drive folder. Set custentity_project_folder on the NetSuite project to the project's Drive folder link.",
      }, { status: 400 });
    }

    const db = getSupabaseAdmin();

    // Don't silently create a second copy if someone else just filed it.
    //
    // A FAILED CHECK IS FATAL, not something to shrug past. The previous version
    // ignored the error, so when the table was missing every request read as
    // "not yet filed" and re-processing a meeting produced a duplicate Doc in
    // the customer's Drive folder. Refusing is the safe direction: the cost is a
    // retry, not a stray document nobody knows about.
    const { data: existing, error: lookupError } = await db
      .from("meeting_processing")
      .select("doc_url, doc_name, meeting_type, project_label")
      .eq("fireflies_id", String(meeting.id))
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json({
        error: /does not exist|schema cache|relation/i.test(lookupError.message)
          ? "Can't check whether this meeting was already filed: the meeting_processing table is missing. Run supabase/meeting-processing-schema.sql in the Supabase SQL editor. Filing is blocked until then, so a duplicate document isn't created."
          : `Can't check whether this meeting was already filed (${lookupError.message}), so filing was stopped rather than risk a duplicate document.`,
      }, { status: 503 });
    }

    if (existing?.doc_url) {
      return NextResponse.json({ alreadyFiled: true, doc: existing }, { status: 409 });
    }

    // One layer deeper than the project folder — created if it isn't there yet.
    const { folder: transcriptFolder, created: folderCreated } =
      await ensureTranscriptFolder(session.user.email, projectFolderId);

    let sentences: MeetingDocInput["sentences"] = [];
    let transcriptNote: string | null = null;

    if (includeTx) {
      if (!firefliesConfigured()) {
        transcriptNote = "Fireflies isn't connected, so the document was filed without a transcript.";
      } else {
        try {
          sentences = await fetchFirefliesTranscript(String(meeting.id));
        } catch (e) {
          transcriptNote = `The transcript couldn't be fetched (${e instanceof Error ? e.message : "unknown error"}), so the document has the summary only.`;
        }
      }
    }

    const input: MeetingDocInput = {
      title:           String(meeting.title ?? "Meeting"),
      date:            String(meeting.date ?? ""),
      durationMinutes: Number(meeting.durationMinutes) || 0,
      organizerEmail:  String(meeting.organizerEmail ?? ""),
      meetingLink:     meeting.meetingLink ?? null,
      transcriptUrl:   meeting.transcriptUrl ?? null,
      attendees:       Array.isArray(meeting.attendees) ? meeting.attendees : [],
      summary:         meeting.summary ?? null,
      sentences,
      projectName:     typeof body?.projectLabel === "string" ? body.projectLabel : undefined,
      meetingType,
      preparedBy:      session.user.name ?? session.user.email ?? undefined,
    };

    const name = meetingDocName({ ...input, meetingType });
    const html = renderMeetingDocHtml(input);
    const doc  = await createGoogleDoc(session.user.email, transcriptFolder.id, name, html);

    // The doc exists either way — say so rather than implying nothing happened.
    // This record is now also what prevents a duplicate next time, so a failure
    // here is worth more than a passing mention.
    const recordNote = await recordProcessingStep({
      firefliesId:  String(meeting.id),
      meetingTitle: input.title,
      meetingDate:  input.date || null,
      meetingType,
      projectNsId:  body?.projectNsId ? String(body.projectNsId) : null,
      projectLabel: body?.projectLabel ?? null,
      processedBy:  session.user.name ?? session.user.email ?? null,
    }, {
      doc_id:   doc.id,
      doc_url:  doc.webViewLink,
      doc_name: doc.name,
      doc_at:   new Date().toISOString(),
    });

    return NextResponse.json({
      doc,
      folderCreated,
      transcriptFolderName: transcriptFolder.name,
      transcriptLines: sentences.length,
      note: [
        transcriptNote,
        recordNote && `${recordNote} Until that is fixed, filing this meeting again would create a second document.`,
      ].filter(Boolean).join(" ") || null,
    });
  } catch (err) {
    console.error("[/api/meeting-docs POST]", err);
    const isDrive = err instanceof DriveError;
    return NextResponse.json(
      {
        error: isDrive ? err.message : err instanceof Error ? err.message : "Unknown error",
        needsReauth: isDrive && (err.code === "reauth" || err.code === "no_token"),
      },
      { status: isDrive && err.code === "reauth" ? 403 : 500 },
    );
  }
}
