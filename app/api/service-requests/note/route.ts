import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

export async function POST(req: NextRequest) {
  try {
    const {
      opportunityId,
      noteText,
      type = "manual",       // "slack" | "email" | "manual"
      author = "Dashboard User",
      channel,               // slack channel e.g. "#service-request"
      currentSalesNotes,     // existing custbody9 value — passed from frontend
    } = await req.json();

    if (!opportunityId || !noteText) {
      return NextResponse.json({ error: "opportunityId and noteText are required" }, { status: 400 });
    }

    const now = new Date();
    const timestamp = now.toLocaleDateString("en-AU", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

    const typeLabel =
      type === "slack" ? `💬 Slack${channel ? ` → ${channel}` : ""}` :
      type === "email" ? "✉ Email" :
      "📝 Note";

    const header   = `[${timestamp} | ${author} | ${typeLabel}]`;
    const newEntry = `${header}\n${noteText}`;
    const existing = currentSalesNotes ? String(currentSalesNotes).trim() : "";
    const combined = existing ? `${newEntry}\n\n---\n\n${existing}` : newEntry;

    await patchRecord("opportunity", parseInt(opportunityId), {
      custbody9: combined,
    });

    return NextResponse.json({ ok: true, salesNotes: combined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
