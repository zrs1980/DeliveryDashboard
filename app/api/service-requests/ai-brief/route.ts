import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { opportunity: opp, notes = [] } = await req.json();

    const notesSection = notes.length > 0
      ? `\n\nRecent activity notes (newest first):\n${notes.map((n: any, i: number) => `${i + 1}. ${n.text}`).join("\n")}`
      : "\n\nNo recent notes on record.";

    const prompt = `You are reviewing an open service opportunity for CEBA Solutions, a NetSuite Solution Partner.

Opportunity:
- Title: ${opp.title}
- Client: ${opp.client}
- Value: ${opp.projectedTotal > 0 ? "$" + opp.projectedTotal.toLocaleString() : "TBD"}
- Probability: ${Math.round(opp.probability * 100)}%
- Expected Close: ${opp.expectedCloseDate ?? "Not set"}
- Days Open: ${opp.daysOpen}
- Assigned To: ${opp.assignedTo ?? "Unassigned"}
- Context: ${opp.memo ?? opp.actionItem ?? "No additional context"}${notesSection}

Respond with EXACTLY this format (no extra text, no markdown):
SUMMARY: <2 sentences summarising where this deal stands and key context from the notes>
NEXT_STEPS:
- <specific action step 1>
- <specific action step 2>
- <specific action step 3>`;

    const msg = await anthropic.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 400,
      messages:   [{ role: "user", content: prompt }],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";

    // Parse response
    const summaryMatch = text.match(/^SUMMARY:\s*([\s\S]+?)(?=\nNEXT_STEPS:)/);
    const stepsMatch   = text.match(/NEXT_STEPS:\s*([\s\S]+)$/);

    const summary   = summaryMatch ? summaryMatch[1].trim() : "No summary available.";
    const nextSteps = stepsMatch
      ? stepsMatch[1].trim().split("\n").map(l => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean)
      : [];

    return NextResponse.json({ summary, nextSteps });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
