import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { postToChannel } from "@/lib/slack";

export const revalidate = 0;
export const maxDuration = 30;

/**
 * POST /api/slack/deliverables-report  { channel, text }
 *
 * Posts the Tasks tab's "Weekly Deliverables Status Report" to the project's
 * Slack channel (custentity_slack_channel, resolved client-side via
 * /api/projects/folders). The message is built in DeliverablesReportModal so
 * the preview is exactly what gets posted.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body    = await req.json();
    const channel = String(body?.channel ?? "").trim();
    const text    = String(body?.text ?? "").trim();

    if (!text) return NextResponse.json({ error: "Nothing to post." }, { status: 400 });
    if (!channel) {
      return NextResponse.json({
        error: "This project has no Slack channel. Set custentity_slack_channel on the NetSuite project record.",
      }, { status: 400 });
    }

    const posted = await postToChannel(channel, text);
    return NextResponse.json({ ok: true, channel: posted.channel, ts: posted.ts });
  } catch (err) {
    console.error("[/api/slack/deliverables-report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
