import { NextRequest, NextResponse } from "next/server";
import { postRecord } from "@/lib/netsuite";

export async function POST(req: NextRequest) {
  try {
    const { opportunityId, entityId, noteText, title, noteType } = await req.json();
    if (!opportunityId || !noteText) {
      return NextResponse.json({ error: "opportunityId and noteText are required" }, { status: 400 });
    }

    // noteType 4 = "Note" (user-visible), 2 = "Email"
    const noteTypeId = noteType === "email" ? "2" : "4";

    const newId = await postRecord("usernote", {
      transaction: { id: String(opportunityId) },
      entity:      { id: String(entityId) },
      noteType:    { id: noteTypeId },
      title:       title ?? "Dashboard Follow-up",
      note:        noteText,
    });

    return NextResponse.json({ ok: true, noteId: newId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
