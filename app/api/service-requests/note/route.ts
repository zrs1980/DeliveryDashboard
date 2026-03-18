import { NextRequest, NextResponse } from "next/server";
import { postRecord, patchRecord } from "@/lib/netsuite";

export async function POST(req: NextRequest) {
  try {
    const { opportunityId, entityId, noteText, title, noteType } = await req.json();
    if (!opportunityId || !noteText) {
      return NextResponse.json({ error: "opportunityId and noteText are required" }, { status: 400 });
    }

    // noteType 4 = "Note" (user-visible), 2 = "Email"
    const noteTypeId = noteType === "email" ? "2" : "4";
    const noteTitle  = title ?? "Dashboard Follow-up";

    // Attempt 1: standalone usernote record
    try {
      const newId = await postRecord("usernote", {
        transaction: { id: String(opportunityId) },
        entity:      { id: String(entityId) },
        noteType:    { id: noteTypeId },
        title:       noteTitle,
        note:        noteText,
      });
      return NextResponse.json({ ok: true, noteId: newId, method: "usernote" });
    } catch (e1) {
      const err1 = e1 instanceof Error ? e1.message : String(e1);

      // Attempt 2: patch the opportunity's note sublist
      try {
        await patchRecord("opportunity", parseInt(opportunityId), {
          userNote: {
            items: [{
              note:     noteText,
              title:    noteTitle,
              noteType: { id: noteTypeId },
            }],
          },
        });
        return NextResponse.json({ ok: true, method: "sublist" });
      } catch (e2) {
        const err2 = e2 instanceof Error ? e2.message : String(e2);
        // Both failed — return both errors for diagnosis
        throw new Error(`usernote: ${err1} | sublist: ${err2}`);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
