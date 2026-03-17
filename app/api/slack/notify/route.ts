import { NextRequest, NextResponse } from "next/server";

const SLACK_BOT_TOKEN    = process.env.SLACK_BOT_TOKEN;
const SLACK_DEFAULT_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL ?? "#service-requests";

export async function POST(req: NextRequest) {
  if (!SLACK_BOT_TOKEN) {
    return NextResponse.json({ error: "SLACK_BOT_TOKEN not configured" }, { status: 500 });
  }

  try {
    const { channel, message, blocks } = await req.json();
    const target = channel || SLACK_DEFAULT_CHANNEL;

    const payload: Record<string, unknown> = {
      channel: target,
      text:    message,
      unfurl_links: false,
    };
    if (blocks) payload.blocks = blocks;

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json; charset=utf-8",
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!data.ok) {
      return NextResponse.json({ error: data.error ?? "Slack API error" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, ts: data.ts, channel: data.channel });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
