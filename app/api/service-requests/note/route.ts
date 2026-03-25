import { NextRequest, NextResponse } from "next/server";
import { getSublist, patchRecord } from "@/lib/netsuite";

export async function POST(req: NextRequest) {
  try {
    const { opportunityId, entityId, noteText, title, noteType } = await req.json();
    if (!opportunityId || !noteText) {
      return NextResponse.json({ error: "opportunityId and noteText are required" }, { status: 400 });
    }

    const oppId      = parseInt(opportunityId);
    const noteTypeId = noteType === "email" ? "2" : "4";
    const noteTitle  = title ?? "Dashboard Follow-up";

    // Fetch existing userNote sublist items so we don't overwrite them
    const existing = await getSublist("opportunity", oppId, "userNote");

    // Append the new note
    const newNote: Record<string, unknown> = {
      note:     noteText,
      title:    noteTitle,
      noteType: { id: noteTypeId },
    };
    if (entityId) newNote.entity = { id: String(entityId) };

    // PATCH the opportunity with the full updated sublist
    await patchRecord("opportunity", oppId, {
      userNote: {
        items: [...existing, newNote],
      },
    });

    return NextResponse.json({ ok: true, method: "patch-sublist" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
