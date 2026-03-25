import { NextRequest, NextResponse } from "next/server";
import { fetchRecord, patchRecord } from "@/lib/netsuite";

export async function POST(req: NextRequest) {
  try {
    const { opportunityId, noteText, title } = await req.json();
    if (!opportunityId || !noteText) {
      return NextResponse.json({ error: "opportunityId and noteText are required" }, { status: 400 });
    }

    const oppId = parseInt(opportunityId);

    // Fetch the current memo so we can prepend rather than overwrite
    const record = await fetchRecord<{ memo?: string }>("opportunity", oppId);
    const existing = record.memo ? String(record.memo).trim() : "";

    const timestamp = new Date().toLocaleDateString("en-AU", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    const heading  = title ?? "Dashboard Follow-up";
    const newEntry = `[${timestamp}] ${heading}\n${noteText}`;
    const combined = existing ? `${newEntry}\n\n---\n\n${existing}` : newEntry;

    await patchRecord("opportunity", oppId, { memo: combined });

    return NextResponse.json({ ok: true, method: "memo" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
