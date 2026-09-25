import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

/**
 * How the agent is actually doing, measured by the humans reviewing its work.
 *
 * ⚠ THE QUALITY SIGNAL IS THE REVIEWER, NOT THE MODEL. 08's evaluation table is
 * entirely about what people do with the output: approved without edit, edited,
 * rejected and why. There is no self-reported confidence here on purpose —
 * an agent grading its own work tells you nothing.
 *
 * ⚠ REJECTION REASONS SPLIT INTO TWO DIFFERENT FAILURES, and conflating them
 * hides which half needs work. "Wrong person" and "wrong timing" are DECISION
 * failures — the agent chose badly. "Tone off" and "factually wrong" are
 * WRITING failures. A prompt change that fixes one can easily worsen the other,
 * which is why `prompt_version` is on every run.
 */

const DECISION_FAILURES = ["wrong person", "wrong timing", "not relevant", "already handled"];
const WRITING_FAILURES  = ["tone off", "factually wrong"];

export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const supabase = getSupabaseAdmin();

  try {
    const [runsRes, draftsRes] = await Promise.all([
      supabase.from("cs_agent_runs")
        .select("outcome, status, skip_category, stop_reason, tool_calls, duration_ms, prompt_version, input_tokens, output_tokens, human_flag")
        .gte("queued_at", since),
      supabase.from("cs_outreach_drafts")
        .select("status, motion, original_body, body, rejection_reason, lint, agent_run_id, generated_at")
        .gte("generated_at", since),
    ]);

    if (runsRes.error) {
      return NextResponse.json({
        error: runsRes.error.message,
        hint: "Run supabase/cs-agent-runs.sql in the Supabase SQL Editor.",
      }, { status: 503 });
    }

    const runs = runsRes.data ?? [];
    const drafts = (draftsRes.data ?? []);
    // Agent drafts only — a hand-triggered health check is not this agent's work
    // and would flatter or damage its numbers either way.
    const agentDrafts = drafts.filter(d => d.agent_run_id);

    const skipCounts: Record<string, number> = {};
    for (const r of runs) {
      if (r.outcome === "skipped" && r.skip_category) {
        skipCounts[r.skip_category] = (skipCounts[r.skip_category] ?? 0) + 1;
      }
    }

    const rejections: Record<string, number> = {};
    let decisionFailures = 0, writingFailures = 0;
    for (const d of agentDrafts) {
      if (d.status !== "rejected" || !d.rejection_reason) continue;
      const reason = String(d.rejection_reason).toLowerCase();
      rejections[String(d.rejection_reason)] = (rejections[String(d.rejection_reason)] ?? 0) + 1;
      if (DECISION_FAILURES.some(x => reason.includes(x))) decisionFailures++;
      if (WRITING_FAILURES.some(x => reason.includes(x)))  writingFailures++;
    }

    const sent     = agentDrafts.filter(d => d.status === "sent");
    // `original_body` is only written on the FIRST edit, so its presence is
    // exactly "this draft was edited before it went out".
    const edited   = sent.filter(d => d.original_body);
    const withLint = agentDrafts.filter(d => Array.isArray(d.lint) && d.lint.length);

    const tokens = runs.reduce((acc, r) => ({
      input:  acc.input  + (r.input_tokens  ?? 0),
      output: acc.output + (r.output_tokens ?? 0),
    }), { input: 0, output: 0 });

    const completed = runs.filter(r => r.status === "complete");
    const budgetHit = runs.filter(r =>
      r.stop_reason === "tool_budget" || r.stop_reason === "time_budget").length;

    const byPrompt: Record<string, { runs: number; proposed: number; skipped: number }> = {};
    for (const r of runs) {
      const v = String(r.prompt_version ?? "unknown");
      byPrompt[v] ??= { runs: 0, proposed: 0, skipped: 0 };
      byPrompt[v].runs++;
      if (r.outcome === "proposed") byPrompt[v].proposed++;
      if (r.outcome === "skipped")  byPrompt[v].skipped++;
    }

    return NextResponse.json({
      days,
      runs: {
        total: runs.length,
        completed: completed.length,
        proposed: runs.filter(r => r.outcome === "proposed").length,
        skipped:  runs.filter(r => r.outcome === "skipped").length,
        blocked:  runs.filter(r => r.outcome === "blocked").length,
        failed:   runs.filter(r => r.status === "failed").length,
        // A run forced to decide by a budget is not a considered decision, and
        // a rising number here means the bounds are too tight for the book.
        budgetHit,
        humanFlags: runs.filter(r => r.human_flag).length,
      },
      review: {
        agentDrafts: agentDrafts.length,
        sent: sent.length,
        editedBeforeSending: edited.length,
        approvedUnedited: sent.length - edited.length,
        rejected: agentDrafts.filter(d => d.status === "rejected").length,
        withLintHits: withLint.length,
        decisionFailures,
        writingFailures,
        rejections,
      },
      skipCounts,
      cost: {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        perRun: runs.length
          ? Math.round((tokens.input + tokens.output) / runs.length)
          : 0,
      },
      byPrompt,
      // Said out loud rather than left as a gap: a reply is the point of the
      // whole system and nothing here can see one.
      replyRate: null,
      replyNote: "Replies cannot be measured — the app has no Gmail read scope.",
      draftsError: draftsRes.error?.message ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
