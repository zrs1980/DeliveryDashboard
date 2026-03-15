import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function fmtH(n: number) { return n % 1 === 0 ? `${n}h` : `${n.toFixed(1)}h`; }
function fmtPct(n: number) { return `${Math.round(n * 100)}%`; }
function gap(actual: number, target: number) {
  const diff = Math.round((actual - target) * 100);
  return diff >= 0 ? `+${diff}pp above target` : `${Math.abs(diff)}pp below target`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      employeeName: string;
      periodLabel: string;
      metrics: {
        total: number;
        billable: number; billablePct: number;
        utilized: number; utilizedPct: number;
        productive: number; productivePct: number;
      };
      projectBreakdown: Array<{
        projectName: string;
        total: number;
        billable: number;
        billablePct: number;
        utilized: number;
        productive: number;
      }>;
    };

    const { employeeName, periodLabel, metrics, projectBreakdown } = body;

    const nonBillable   = metrics.total - metrics.billable;
    const nonUtilized   = metrics.total - metrics.utilized;
    const nonProductive = metrics.total - metrics.productive;

    const projectLines = projectBreakdown
      .sort((a, b) => b.total - a.total)
      .map(p => {
        const nb = p.total - p.billable;
        const nu = p.total - p.utilized;
        return `  - ${p.projectName}: ${fmtH(p.total)} total, ${fmtPct(p.billablePct)} billable` +
               (nb > 0 ? ` (${fmtH(nb)} non-billable)` : "") +
               (nu > 0 ? `, ${fmtH(nu)} non-utilized` : "");
      }).join("\n");

    const prompt = `You are a resource management advisor for a NetSuite implementation consultancy.
Analyse this consultant's time data for ${periodLabel} and provide:
(1) A 2-sentence summary of what they have been working on and whether the workload mix looks healthy.
(2) 'Reasons targets may not be met:' as 3–4 specific bullet points identifying the actual causes based on the data (e.g. internal admin time, non-billable client hours, specific projects dragging the ratio).
(3) 'Recommended Actions:' as 3 bullet points starting with action verbs. Be specific and practical.

Consultant: ${employeeName}
Period: ${periodLabel}

Hours summary:
- Total logged: ${fmtH(metrics.total)}
- Billable: ${fmtH(metrics.billable)} (${fmtPct(metrics.billablePct)}) — target 65% — ${gap(metrics.billablePct, 0.65)}
- Utilized: ${fmtH(metrics.utilized)} (${fmtPct(metrics.utilizedPct)}) — target 75% — ${gap(metrics.utilizedPct, 0.75)}
- Productive: ${fmtH(metrics.productive)} (${fmtPct(metrics.productivePct)}) — target 85% — ${gap(metrics.productivePct, 0.85)}
- Non-billable hours: ${fmtH(nonBillable)} | Non-utilized: ${fmtH(nonUtilized)} | Non-productive: ${fmtH(nonProductive)}

Project / activity breakdown (last 3 months):
${projectLines || "  No project data available"}

Note: 'Internal / Admin' entries indicate time logged without a client project attached (e.g. internal meetings, admin, training).`;

    const message = await client.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 600,
      messages:   [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("\n");

    return NextResponse.json({ text });
  } catch (err) {
    console.error("[/api/time-analysis/insights]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
