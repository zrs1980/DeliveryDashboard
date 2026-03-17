import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { opportunity, tone } = await req.json();

    const toneGuide =
      tone === "formal"   ? "formal and professional"  :
      tone === "friendly" ? "warm, friendly, and conversational" :
      tone === "urgent"   ? "politely urgent, emphasizing timeline and business value" :
      "professional yet approachable";

    const prompt = `You are a senior business development consultant at CEBA Solutions, a NetSuite Solution Partner. Write a concise follow-up email to a prospect about an open service opportunity.

Opportunity details:
- Title: ${opportunity.title}
- Client: ${opportunity.client}
- Projected Value: ${opportunity.projectedTotal > 0 ? "$" + opportunity.projectedTotal.toLocaleString() : "TBD"}
- Probability: ${Math.round(opportunity.probability * 100)}%
- Expected Close: ${opportunity.expectedCloseDate ?? "Not set"}
- Days Open: ${opportunity.daysOpen}
- Notes/Context: ${opportunity.memo ?? opportunity.actionItem ?? "No additional context"}

Tone: ${toneGuide}

Write a follow-up email with:
1. Subject line (prefix with "Subject: ")
2. A blank line
3. The email body (3-4 short paragraphs maximum)

Rules:
- Reference the specific opportunity by name naturally
- Mention CEBA Solutions and our NetSuite expertise briefly
- Include a clear, single call-to-action
- Keep it under 180 words total (body only)
- Do NOT use placeholder text like [Name] — address it to the client company directly
- Sign off as "The CEBA Solutions Team"`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text : "";

    // Split subject from body
    const lines   = text.split("\n");
    const subjectLine = lines.find(l => l.toLowerCase().startsWith("subject:"));
    const subject = subjectLine ? subjectLine.replace(/^subject:\s*/i, "").trim() : `Following up: ${opportunity.title}`;
    const body    = lines
      .filter(l => !l.toLowerCase().startsWith("subject:"))
      .join("\n")
      .replace(/^\n+/, "")
      .trim();

    return NextResponse.json({ subject, body });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
