import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { postToChannel } from "@/lib/slack";

export const revalidate = 0;
export const maxDuration = 30;

/**
 * POST /api/slack/meeting-summary
 * { channel, summary, meetingTitle?, meetingDate?, docUrl?, taskCount? }
 *
 * Posts the PM summary to the project's Slack channel — the channel comes from
 * custentity_slack_channel on the NetSuite job, resolved client-side and passed here.
 *
 * Separate from /api/slack/notify (which is the Service Requests path) so the
 * channel-specific error help and the meeting framing live in one place.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body    = await req.json();
    const channel = String(body?.channel ?? "").trim();
    const summary = String(body?.summary ?? "").trim();

    if (!summary) return NextResponse.json({ error: "No summary to post." }, { status: 400 });
    if (!channel) {
      return NextResponse.json({
        error: "This project has no Slack channel. Set custentity_slack_channel on the NetSuite project record.",
      }, { status: 400 });
    }

    const header = [
      body?.meetingTitle ? `*${body.meetingTitle}*` : "*Meeting summary*",
      body?.meetingDate  ? `_${body.meetingDate}_`  : null,
    ].filter(Boolean).join("  ·  ");

    const footerParts = [
      body?.docUrl ? `📄 <${body.docUrl}|Transcript>` : null,
      typeof body?.taskCount === "number" && body.taskCount > 0
        ? `✅ ${body.taskCount} ClickUp task${body.taskCount === 1 ? "" : "s"} created`
        : null,
    ].filter(Boolean);

    const text = [
      header,
      "",
      summary,
      footerParts.length ? `\n${footerParts.join("  ·  ")}` : null,
    ].filter(v => v !== null).join("\n");

    const posted = await postToChannel(channel, text);
    return NextResponse.json({ ok: true, channel: posted.channel, ts: posted.ts });
  } catch (err) {
    console.error("[/api/slack/meeting-summary]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
