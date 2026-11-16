import { NextRequest, NextResponse } from "next/server";
import { postToChannel, prependToCanvas } from "@/lib/slack";

// `<!channel>` is Slack's raw mention syntax — a literal "@channel" in the text
// posts as plain text and notifies nobody.
const CANVAS_NOTICE = "<!channel> the weekly deliverables have been posted in the channel's canva";

/**
 * POST /api/slack/canvas  { markdown, canvasId?, channel? }
 *
 * Prepends the deliverables to the canvas, then — when a channel is given —
 * posts a notice in that channel pointing at it. The canvas is the deliverable;
 * a failed notice comes back as `noticeError` alongside `ok: true`, since
 * reporting the whole post as failed would invite a second, duplicate canvas
 * entry on retry.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { markdown?: string; canvasId?: string | null; channel?: string | null };
    if (!body.markdown?.trim()) {
      return NextResponse.json({ error: "No content to post" }, { status: 400 });
    }
    await prependToCanvas(body.markdown, body.canvasId);

    const channel = (body.channel ?? "").trim();
    if (!channel) return NextResponse.json({ ok: true, noticeChannel: null, noticeError: null });

    try {
      const posted = await postToChannel(channel, CANVAS_NOTICE);
      return NextResponse.json({ ok: true, noticeChannel: posted.channel, noticeError: null });
    } catch (e) {
      console.error("[/api/slack/canvas] channel notice", e);
      return NextResponse.json({
        ok: true,
        noticeChannel: null,
        noticeError: e instanceof Error ? e.message : "Couldn't post the channel notice",
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
