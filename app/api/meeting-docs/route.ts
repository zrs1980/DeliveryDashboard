import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createGoogleDoc, DriveError, ensureTranscriptFolder, extractDriveFolderId } from "@/lib/google-drive";
import { fetchFirefliesTranscript, firefliesConfigured } from "@/lib/fireflies";
import { meetingDocName, renderMeetingDocHtml, type MeetingDocInput } from "@/lib/meeting-doc";
import { MEETING_TYPES } from "@/lib/constants";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * GET /api/meeting-docs?ids=a,b,c
 * Which of these Fireflies meetings already have a filed doc, keyed by fireflies id.
 * Called once per grid load so each row can show a link instead of a Create button.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean);

  const db = getSupabaseAdmin();
  let query = db.from("meeting_docs").select("fireflies_id, doc_url, doc_name, meeting_type, project_label, created_at, created_by");
  if (ids.length > 0) query = query.in("fireflies_id", ids);

  const { data, error } = await query;
  if (error) {
    // A missing table shouldn't break the grid — the Create buttons still work.
    console.error("[/api/meeting-docs GET]", error.message);
    return NextResponse.json({ docs: {}, warning: `Could not read filed documents: ${error.message}` });
  }

  const docs: Record<string, unknown> = {};
  for (const row of data ?? []) docs[row.fireflies_id] = row;
  return NextResponse.json({ docs });
}

/**
 * POST /api/meeting-docs
 * { meeting, projectNsId, projectLabel, projectFolderUrl, meetingType, includeTranscript? }
 *
 * Files the transcript into <project folder>/Transcripts, records it, returns the link.
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
    const { data: existing } = await db
      .from("meeting_docs")
      .select("doc_url, doc_name, meeting_type, project_label")
      .eq("fireflies_id", String(meeting.id))
      .maybeSingle();

    if (existing) {
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

    const { error: insertError } = await db.from("meeting_docs").insert({
      fireflies_id:    String(meeting.id),
      meeting_title:   input.title,
      meeting_date:    input.date || null,
      meeting_type:    meetingType,
      project_ns_id:   body?.projectNsId ? String(body.projectNsId) : null,
      project_label:   body?.projectLabel ?? null,
      drive_folder_id: transcriptFolder.id,
      doc_id:          doc.id,
      doc_url:         doc.webViewLink,
      doc_name:        doc.name,
      created_by:      session.user.name ?? session.user.email,
    });

    // The doc exists either way — say so rather than implying nothing happened.
    const recordNote = insertError
      ? `The document was created, but recording it failed (${insertError.message}), so the grid may still offer to file it again.`
      : null;

    return NextResponse.json({
      doc,
      folderCreated,
      transcriptFolderName: transcriptFolder.name,
      transcriptLines: sentences.length,
      note: [transcriptNote, recordNote].filter(Boolean).join(" ") || null,
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
