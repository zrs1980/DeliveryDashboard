import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Project } from "@/lib/types";
import { fmtH, fmtPct, fmtD } from "@/lib/health";
import { isDone } from "@/lib/clickup";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projects: Project[] = body.projects;

    if (!projects || projects.length === 0) {
      return NextResponse.json({ error: "No projects provided" }, { status: 400 });
    }

    let prompt: string;

    if (projects.length === 1) {
      const p = projects[0];
      const blocked = p.blocked.map(t => t.name).join(", ") || "None";
      const clientPending = p.clientPending.map(t => t.name).join(", ") || "None";
      const openMilestones = p.milestones
        .filter(t => t.status.status.toLowerCase() !== "done")
        .map(t => t.name).join(", ") || "None";

      prompt = `You are a senior NetSuite implementation PM advisor. Review this project status and provide:
(1) a 2-sentence risk summary calling out the most critical issues by name, then
(2) 'Recommended Next Steps:' as 4 bullet points, each starting with an action verb. Be specific.

Project: ${p.label}
Health: ${p.health.toUpperCase()} (score ${p.score}/100), SPI: ${p.spi.toFixed(2)}
Progress: ${fmtPct(p.pct)} | Burn: ${fmtPct(p.burnRate)} | Budget gap: ${fmtPct(p.budgetGap)}
Hours: ${fmtH(p.actual)} logged / ${fmtH(p.actual + p.rem)} budget | ${fmtH(p.rem)} remaining
End date: ${p.goliveDate ?? "Not set"} (${fmtD(p.daysLeft)})
Blocked tasks: ${blocked}
Awaiting client: ${clientPending}
Open milestones: ${openMilestones}
PM Notes: ${p.notes.map(n => n.text).join("; ") || "None"}
Task summary: ${p.tasks.filter(t => !isDone(t)).length} open, ${p.tasks.filter(t => isDone(t)).length} done`;
    } else {
      const lines = projects.map(p =>
        `${p.label}: ${p.health} health, SPI ${p.spi.toFixed(2)}, ${fmtPct(p.pct)} done, ${fmtD(p.daysLeft)}, ${p.blocked.length} blocked, ${p.clientPending.length} client-pending`
      ).join("\n");

      prompt = `You are a senior NetSuite PM advisor. Review this portfolio of active projects and provide:
(1) a 2-3 sentence cross-portfolio risk assessment naming the top 2 risks, then
(2) 'Priority Next Steps:' as 4-5 bullet points prioritized by urgency, naming specific projects and people. Be direct.

${lines}`;
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("\n");

    return NextResponse.json({ text });
  } catch (err) {
    console.error("[/api/insights]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
