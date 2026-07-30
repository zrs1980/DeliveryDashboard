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

/** Section labels used to focus the model when the PM asks from inside a step. */
const SECTION_HINTS: Record<string, string> = {
  recap:        "the quick recap: overallStatus, statusReason, keyMessage and accomplishments",
  deliverables: "the Loop Services vs customer deliverables lists",
  whatsNext:    "the what's-next section: phase, focus, deliverables and meetings",
  risks:        "the risk assessment and risk rows",
  budget:       "the budget commentary (note and dataWarning only — hour figures are fixed)",
  milestones:   "the milestone table rows",
  actions:      "the closing recap and action items",
};

interface ChatTurn { role: "user" | "assistant"; content: string }

/**
 * POST /api/pm/status-report/refine
 * Body: { report, instruction, section?, history?: ChatTurn[] }
 *
 * Free-form refinement. Returns the updated report plus a short reply for the
 * chat rail. The model can only change fields in the patch schema, and every
 * value is re-validated in applyPatch, so a bad response degrades to a no-op
 * rather than corrupting the report.
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
    const instruction: string | undefined  = body.instruction;
    const section: string | undefined      = body.section;
    const history: ChatTurn[]              = Array.isArray(body.history) ? body.history.slice(-8) : [];

    if (!report)      return NextResponse.json({ error: "report is required" }, { status: 400 });
    if (!instruction?.trim()) return NextResponse.json({ error: "instruction is required" }, { status: 400 });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const focus = section && SECTION_HINTS[section]
      ? `\nThe PM is currently editing ${SECTION_HINTS[section]}. Prefer changing that section unless they clearly mean something else.\n`
      : "";

    // The report is re-sent every turn so the model always patches current state,
    // not whatever it produced several turns ago.
    const messages: Anthropic.MessageParam[] = [
      ...history.map(t => ({ role: t.role, content: t.content })),
      {
        role: "user" as const,
        content: `Here is the current state of the report:

${reportContext(report)}

CURRENT NARRATIVE TEXT
Key message: ${report.recap.keyMessage || "(empty)"}
Status reason: ${report.recap.statusReason || "(empty)"}
Next week focus: ${report.whatsNext.focus || "(empty)"}
Risk assessment: ${report.risks.assessment || "(empty)"}
Closing recap: ${report.actions.recap || "(empty)"}
${focus}
The PM asks: ${instruction.trim()}

Make the change and explain briefly what you did. If the request is ambiguous, make the most
reasonable interpretation and say which one you took. If the request asks for something the data
does not support, say so in your reply and leave that part unchanged.`,
      },
    ];

    const message = await client.messages.create({
      model:       REPORT_MODEL,
      max_tokens:  4096,
      system:      SYSTEM_PROMPT,
      tools:       [WRITE_REPORT_TOOL],
      tool_choice: { type: "tool", name: WRITE_REPORT_TOOL.name },
      messages,
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
    console.error("[/api/pm/status-report/refine]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
