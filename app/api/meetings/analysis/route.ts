import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { fetchFirefliesTranscript, firefliesConfigured } from "@/lib/fireflies";

export const revalidate = 0;
export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * The transcript is the expensive part of this route, so both the action items
 * and the PM summary come out of ONE model call. Splitting them across two
 * endpoints would mean fetching (and paying for) the transcript twice per meeting.
 */
const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "record_meeting_analysis",
  description:
    "Record the action items and the key details a project manager needs from this meeting.",
  input_schema: {
    type: "object",
    properties: {
      actionItems: {
        type: "array",
        description:
          "Internal action items for the Loop Services delivery team. Omit items that are purely the client's to do, and omit anything already completed during the call.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Short imperative task title, under 80 characters, starting with a verb. E.g. 'Configure SuiteTax for the UK subsidiary'.",
            },
            description: {
              type: "string",
              description:
                "2-5 sentences of detail: what was actually said, the context needed to do the work, any constraint, dependency or date mentioned, and who raised it. Expand on the transcript rather than restating the title.",
            },
            owner: {
              type: "string",
              description:
                "Name of the person who took the action, exactly as spoken in the meeting. Empty string if nobody was named.",
            },
          },
          required: ["name", "description", "owner"],
        },
      },
      keyDetails: {
        type: "string",
        description: [
          "A short narrative briefing for the PROJECT MANAGER, written in plain prose — 2-4 short paragraphs, no bullet points, no headings, no markdown.",
          "",
          "Include ONLY things that affect whether the project succeeds:",
          "- movement in timelines, dates, milestones or go-live",
          "- meetings, workshops or sessions that were scheduled or need scheduling, and who must attend",
          "- decisions that change scope, approach, budget or resourcing",
          "- risks, blockers and dependencies — especially anything waiting on the client",
          "- changes in client sentiment, confidence or expectations",
          "",
          "EXCLUDE task-level and consultant-level detail: individual configuration steps, who is doing which small task, technical how-to. That belongs on the ClickUp tasks, not here.",
          "",
          "Write it as if briefing the PM who was not on the call: what happened, what it means for the project, and what needs their attention. If nothing material to the project came up, say so in one sentence rather than padding it out.",
        ].join("\n"),
      },
    },
    required: ["actionItems", "keyDetails"],
  },
};

interface AnalysisResult {
  actionItems: { name: string; description: string; owner: string }[];
  keyDetails: string;
}

/** Keeps a long call inside the model's context without silently losing the end of it. */
function renderTranscript(sentences: { speaker: string; text: string }[]): string {
  const MAX_CHARS = 120_000;
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;

  for (const s of sentences) {
    const line = `${s.speaker || "Unknown"}: ${s.text}`;
    if (used + line.length > MAX_CHARS) { dropped++; continue; }
    lines.push(line);
    used += line.length + 1;
  }

  // Say so rather than quietly analysing a partial call.
  if (dropped > 0) lines.push(`\n[${dropped} further lines omitted — transcript exceeded the size limit.]`);
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body    = await req.json();
    const meeting = body?.meeting;
    if (!meeting?.id) return NextResponse.json({ error: "meeting is required" }, { status: 400 });

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured. Add it in Vercel and redeploy." },
        { status: 503 },
      );
    }

    // Best-effort: the Fireflies summary alone still produces usable action items.
    let transcript = "";
    let transcriptLines = 0;
    let note: string | null = null;

    if (!firefliesConfigured()) {
      note = "Fireflies isn't connected, so this was generated from the meeting summary only.";
    } else {
      try {
        const sentences = await fetchFirefliesTranscript(String(meeting.id));
        transcriptLines = sentences.length;
        transcript = renderTranscript(sentences);
      } catch (e) {
        note = `The transcript couldn't be fetched (${e instanceof Error ? e.message : "unknown error"}), so this was generated from the meeting summary only.`;
      }
    }

    const summary   = meeting.summary ?? null;
    const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];

    const context = [
      `Meeting: ${meeting.title ?? "Untitled"}`,
      `Date: ${meeting.date ?? "unknown"}`,
      body?.projectLabel ? `Project: ${body.projectLabel}` : null,
      attendees.length
        ? `Attendees: ${attendees.map((a: { name?: string; email?: string; internal?: boolean }) =>
            `${a.name || a.email}${a.internal ? "" : " (client)"}`).join(", ")}`
        : null,
      summary?.overview ? `\nAI overview:\n${summary.overview}` : null,
      summary?.actionItems?.length
        ? `\nAction items Fireflies already detected:\n${summary.actionItems.map((a: string) => `- ${a}`).join("\n")}`
        : null,
      summary?.bulletGist?.length
        ? `\nKey points:\n${summary.bulletGist.map((b: string) => `- ${b}`).join("\n")}`
        : null,
      transcript ? `\nFull transcript:\n${transcript}` : null,
    ].filter(Boolean).join("\n");

    const prompt = `You are a senior NetSuite implementation PM at Loop Services reviewing a client meeting.

Produce two things by calling the record_meeting_analysis tool:

1. The internal action items for the Loop delivery team. Use the Fireflies-detected action items as a starting point, but correct and ENRICH them from the transcript — Fireflies' versions are often one terse line with no context. Merge duplicates, drop anything resolved during the call, and add any commitment that was made in the transcript but missed. If the transcript shows no real internal actions, return an empty list rather than inventing work.

2. A narrative briefing for the project manager. This is read by the PM, not by consultants — it goes to the project's Slack channel. Cover only what affects the project's success: timelines, upcoming meetings, decisions, risks, blockers and anything waiting on the client. Leave the task-level detail out of it; that is already captured on the ClickUp tasks in part 1.

Base everything on what was actually said. Do not invent owners, dates, or decisions.

${context}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "record_meeting_analysis" },
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      return NextResponse.json({ error: "The model did not return an analysis. Try again." }, { status: 502 });
    }

    const parsed = toolUse.input as AnalysisResult;

    // Re-validate rather than trusting the model's shape; a malformed field
    // should degrade to an empty row the PM can fill in, not crash the wizard.
    const actionItems = (Array.isArray(parsed.actionItems) ? parsed.actionItems : [])
      .map((a, i) => ({
        id:          `ai-${i}`,
        name:        String(a?.name ?? "").trim(),
        description: String(a?.description ?? "").trim(),
        owner:       String(a?.owner ?? "").trim(),
      }))
      .filter(a => a.name);

    return NextResponse.json({
      actionItems,
      keyDetails: String(parsed.keyDetails ?? "").trim(),
      transcriptLines,
      note,
    });
  } catch (err) {
    console.error("[/api/meetings/analysis]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
