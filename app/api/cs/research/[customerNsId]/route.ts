import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchCustomerResources, type CustomerResources } from "@/lib/cs-resources";
import { runAgentLoop, type RunState } from "@/lib/cs-agent-loop";
import {
  SHARED_TOOL_IMPLS, makeDispatch, fetchProjects,
  type SharedToolCtx, type ProjectRow,
} from "@/lib/cs-agent-tools";
import {
  RESEARCH_MODEL, RESEARCH_TOOLS, RESEARCH_SYSTEM, TERMINAL_TOOL,
  MAX_TOOL_CALLS, TIME_BUDGET_MS, validateResearch,
} from "@/lib/cs-research";

export const revalidate = 0;
export const maxDuration = 300;

/**
 * POST /api/cs/research/[customerNsId] — run the research agent.
 * GET  — recent runs for this customer.
 *
 * The loop itself now lives in `lib/cs-agent-loop.ts` and the read tools in
 * `lib/cs-agent-tools.ts`, so the CSM agent shares them rather than growing a
 * second copy. What is left here is everything that is actually about
 * RESEARCH: the snapshot, the refusal when there is nothing to read, and the
 * three writes to `cs_research_runs`.
 *
 * Persistence stays in the route on purpose — run tables differ per agent, and
 * threading a table/column map through the loop would be more coupling than it
 * removes.
 */

const dispatch = makeDispatch(SHARED_TOOL_IMPLS);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ customerNsId: string }> },
) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;
  const { customerNsId } = await params;

  const { data, error } = await getSupabaseAdmin()
    .from("cs_research_runs").select("*")
    .eq("customer_ns_id", customerNsId)
    .order("created_at", { ascending: false }).limit(10);

  if (error) {
    return NextResponse.json({
      error: error.message,
      hint: "Run supabase/cs-research-schema.sql in the Supabase SQL Editor.",
    }, { status: 503 });
  }
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ customerNsId: string }> },
) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const { customerNsId } = await params;
  const userEmail = gate.session.email;
  const supabase  = getSupabaseAdmin();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  }

  // ── Snapshot ────────────────────────────────────────────────────────────
  const resourceMap = await fetchCustomerResources([customerNsId]);
  const res: CustomerResources | undefined = resourceMap[customerNsId];
  if (!res) {
    return NextResponse.json({ error: "No active customer with that id." }, { status: 404 });
  }

  const projects = await fetchProjects(customerNsId);

  // Refusing up front beats burning a model call to discover there is nothing
  // to read, and says which of the two problems it is.
  if (!res.hasAny && projects.length === 0) {
    return NextResponse.json({
      error: `${res.customerName} has no Drive folder, ClickUp list, Slack channel or project `
           + "linked in NetSuite, so there is nothing for the agent to read. Link a project "
           + "folder or ClickUp list on the NetSuite record first.",
      nothingToRead: true,
    }, { status: 422 });
  }

  const { data: run, error: runErr } = await supabase.from("cs_research_runs").insert({
    customer_ns_id: customerNsId,
    customer_name:  res.customerName,
    status:         "running",
    model:          RESEARCH_MODEL,
    run_by:         userEmail,
  }).select().single();

  if (runErr) {
    return NextResponse.json({
      error: runErr.message,
      hint: "Run supabase/cs-research-schema.sql in the Supabase SQL Editor.",
    }, { status: 503 });
  }

  try {
    const result = await runAgentLoop<SharedToolCtx, ReturnType<typeof validateResearch>>({
      apiKey,
      model:        RESEARCH_MODEL,
      system:       RESEARCH_SYSTEM,
      tools:        RESEARCH_TOOLS,
      terminalTool: TERMINAL_TOOL,
      bounds:       { maxToolCalls: MAX_TOOL_CALLS, timeBudgetMs: TIME_BUDGET_MS },
      firstMessage: snapshotPrompt(res, projects),
      ctx:          { userEmail, customerNsId, res, projects } as SharedToolCtx,
      dispatch,
      validate:     validateResearch,
      // Heartbeat. Without it a killed process leaves the row at "running"
      // forever, which is how this behaved before the extraction.
      onProgress: async (state: RunState) => {
        await supabase.from("cs_research_runs").update({
          tool_calls: state.toolCalls, sources_read: state.sources,
        }).eq("id", run.id);
      },
    });

    const { output, stopReason, state, durationMs, partial } = result;

    if (!output) {
      await supabase.from("cs_research_runs").update({
        status: "stopped", stop_reason: stopReason,
        tool_calls: state.toolCalls, sources_read: state.sources,
        duration_ms: durationMs, completed_at: new Date().toISOString(),
        error: "The agent stopped without submitting findings.",
      }).eq("id", run.id);
      return NextResponse.json({
        error: "The agent stopped without submitting findings.",
        runId: run.id, toolCalls: state.toolCalls,
      }, { status: 502 });
    }

    await supabase.from("cs_research_runs").update({
      status: "complete",
      stop_reason: stopReason,
      summary:     output.summary,
      findings:    output.findings,
      next_steps:  output.nextSteps,
      sources_read: state.sources,
      tool_calls:  state.toolCalls,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);

    return NextResponse.json({
      runId: run.id,
      customerName: res.customerName,
      ...output,
      stopReason,
      toolCalls: state.toolCalls,
      sourcesRead: state.sources,
      durationMs,
      // Surfaced, not buried: a partial run and a complete one must not look
      // the same to whoever reads the findings.
      partial,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await supabase.from("cs_research_runs").update({
      status: "failed", stop_reason: "error", error: msg,
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return NextResponse.json({ error: msg, runId: run.id }, { status: 502 });
  }
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

function snapshotPrompt(res: CustomerResources, projects: ProjectRow[]): string {
  const live = projects.filter(p => /progress/i.test(p.statusLabel));
  return [
    `CUSTOMER: ${res.customerName} (NetSuite id ${res.customerNsId})`,
    "",
    `Projects: ${projects.length} total, ${live.length} in progress.`,
    `Drive folders linked: ${res.driveFolders.length}`,
    `ClickUp lists linked: ${res.clickupUrls.length}`,
    `Slack channels linked: ${res.slackChannels.length}`,
    res.lastSalesActivity.date
      ? `Last sales activity recorded in NetSuite: ${res.lastSalesActivity.date}`
        + `${res.lastSalesActivity.name ? ` — ${res.lastSalesActivity.name}` : ""}`
      : "No last sales activity recorded.",
    "",
    "Research this account and submit what you find. Start by seeing what is there.",
  ].join("\n");
}
