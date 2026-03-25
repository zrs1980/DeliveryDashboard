import { NextRequest, NextResponse } from "next/server";
import { postSublistRecord } from "@/lib/netsuite";

export async function POST(req: NextRequest) {
  try {
    const { opportunityId, entityId, noteText, title, noteType } = await req.json();
    if (!opportunityId || !noteText) {
      return NextResponse.json({ error: "opportunityId and noteText are required" }, { status: 400 });
    }

    // noteType: 4 = "Note", 2 = "Email"
    const noteTypeId = noteType === "email" ? "2" : "4";
    const noteTitle  = title ?? "Dashboard Follow-up";

    // POST to the opportunity's userNote sublist
    // Endpoint: POST /services/rest/record/v1/opportunity/{id}/userNote
    await postSublistRecord("opportunity", parseInt(opportunityId), "userNote", {
      note:     noteText,
      title:    noteTitle,
      noteType: { id: noteTypeId },
      ...(entityId ? { entity: { id: String(entityId) } } : {}),
    });

    return NextResponse.json({ ok: true, method: "sublist" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
