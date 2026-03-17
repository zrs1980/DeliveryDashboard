import { NextRequest, NextResponse } from "next/server";
import { postRecord } from "@/lib/netsuite";

export async function POST(req: NextRequest) {
  try {
    const { opportunityId, entityId, noteText } = await req.json();
    if (!opportunityId || !noteText) {
      return NextResponse.json({ error: "opportunityId and noteText are required" }, { status: 400 });
    }

    const newId = await postRecord("note", {
      transaction: { id: String(opportunityId) },
      entity:      { id: String(entityId) },
      note:        noteText,
    });

    return NextResponse.json({ ok: true, noteId: newId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
