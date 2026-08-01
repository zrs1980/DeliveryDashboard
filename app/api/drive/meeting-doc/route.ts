import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createGoogleDoc, DriveError, folderPath } from "@/lib/google-drive";
import { fetchFirefliesTranscript, firefliesConfigured } from "@/lib/fireflies";
import { meetingDocName, renderMeetingDocHtml, type MeetingDocInput } from "@/lib/meeting-doc";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * POST /api/drive/meeting-doc
 * {
 *   folderId, meeting: { id, title, date, durationMinutes, organizerEmail,
 *                        meetingLink, transcriptUrl, attendees, summary },
 *   customerName?, projectName?, includeTranscript?
 * }
 *
 * Creates the Google Doc and returns its link. Only ever called after the PM has
 * approved the destination in the wizard — nothing writes to Drive before that.
 *
 * The transcript is fetched here rather than trusted from the client: it's large,
 * and the document should reflect Fireflies at filing time.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body       = await req.json();
    const folderId   = typeof body?.folderId === "string" ? body.folderId : "";
    const meeting    = body?.meeting;
    const includeTx  = body?.includeTranscript !== false;

    if (!folderId)        return NextResponse.json({ error: "folderId is required" }, { status: 400 });
    if (!meeting?.id)     return NextResponse.json({ error: "meeting is required" }, { status: 400 });

    let sentences: MeetingDocInput["sentences"] = [];
    let transcriptNote: string | null = null;

    if (includeTx) {
      if (!firefliesConfigured()) {
        transcriptNote = "Fireflies isn't connected, so the document was filed without a transcript.";
      } else {
        try {
          sentences = await fetchFirefliesTranscript(String(meeting.id));
        } catch (e) {
          // A missing transcript shouldn't block filing the notes.
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
      customerName:    typeof body?.customerName === "string" ? body.customerName : undefined,
      projectName:     typeof body?.projectName === "string" ? body.projectName : undefined,
      preparedBy:      session.user.name ?? session.user.email ?? undefined,
    };

    const name = meetingDocName(input);
    const html = renderMeetingDocHtml(input);
    const doc  = await createGoogleDoc(session.user.email, folderId, name, html);
    const path = await folderPath(session.user.email, folderId);

    return NextResponse.json({
      doc,
      folderPath: path,
      transcriptLines: sentences.length,
      note: transcriptNote,
    });
  } catch (err) {
    console.error("[/api/drive/meeting-doc]", err);
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
