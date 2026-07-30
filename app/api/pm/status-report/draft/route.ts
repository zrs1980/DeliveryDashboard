import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import type { StatusReport } from "@/lib/status-report";
import {
  REPORT_MODEL, SYSTEM_PROMPT, WRITE_REPORT_TOOL,
  applyPatch, extractToolInput, reportContext,
} from "@/lib/status-report-ai";

export const revalidate = 0;
export const maxDuration = 60;

/**
 * POST /api/pm/status-report/draft
 * Body: { report: StatusReport }
 *
 * Writes the narrative parts of a freshly-derived report: key message, the
 * accomplishment and next-week bullets, the risk assessment and the closing
 * recap. Structural facts (hours, phases, metrics) are left untouched.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const report: StatusReport | undefined = body.report;
    if (!report) return NextResponse.json({ error: "report is required" }, { status: 400 });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `Draft the client-facing narrative for this week's status report.

${reportContext(report)}

Write these fields:

1. recap.keyMessage — 3 to 5 sentences. Lead with where the project stands right now, then what
   is being worked, then what is needed from the client and by when. This is the paragraph the
   client reads first.
2. recap.statusReason — one sentence justifying the ${report.recap.overallStatus} status.
3. recap.accomplishments — rewrite the closed-this-week items as client-readable bullets, most
   significant first. Group trivially related items rather than listing near-duplicates. Max 5.
   If nothing closed this week, return an empty array.
4. whatsNext.focus — 1 to 2 sentences on next week's focus, naming the phase.
5. whatsNext.deliverables — the concrete deliverables due next week, with owner and date in the
   detail. Max 5.
6. risks.assessment — 2 to 3 sentences naming the top risks and what they threaten.
7. risks.risks — refine the detected risks: keep the real ones, merge duplicates, sharpen each
   impact and mitigation so the mitigation is a specific action with an owner. Drop anything that
   is not a genuine risk to delivery. Keep severity honest.
8. actions.recap — 2 to 3 sentences closing the report: the week in one line, then the single most
   important thing that must happen before the next status call.
9. actions.items — the action items, each starting with a verb, with the correct owner and
   ownerSide. Include client actions explicitly. Max 8.

Do not change overallStatus unless the data clearly contradicts it. Do not touch budget hours.`;

    const message = await client.messages.create({
      model:       REPORT_MODEL,
      max_tokens:  4096,
      system:      SYSTEM_PROMPT,
      tools:       [WRITE_REPORT_TOOL],
      tool_choice: { type: "tool", name: WRITE_REPORT_TOOL.name },
      messages:    [{ role: "user", content: prompt }],
    });

    const result = extractToolInput(message);
    if (!result) {
      return NextResponse.json({ error: "Claude did not return a report patch" }, { status: 502 });
    }

    return NextResponse.json({
      report: applyPatch(report, result.patch),
      reply:  result.reply,
    });
  } catch (err) {
    console.error("[/api/pm/status-report/draft]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
