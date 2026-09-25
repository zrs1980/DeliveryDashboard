import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { claimNextRun } from "@/lib/cs-csm-queue";
import { runCsmAgent } from "@/lib/cs-csm-run";

export const revalidate = 0;
export const maxDuration = 300;

/**
 * The nightly CSM agent worker.
 *
 * Takes the OLDEST queued run, processes it, and exits. One account per
 * invocation — Vercel caps a function at 300s and a single agent run can use
 * 240 of them, so looping the book inside one request would time out somewhere
 * unpredictable and leave rows stuck at `running`.
 *
 * Schedule it every few minutes in a window after the scoring job. Ten queued
 * accounts drain in about half an hour.
 *
 * ⚠ AUTHENTICATED ON `CRON_SECRET`, AND THAT IS THE ONLY THING GUARDING IT.
 * `proxy.ts` exempts the whole `/api/cs/cron` PREFIX from the login redirect —
 * without that, Vercel Cron would be redirected to /login and get an HTML 200,
 * which reads as a healthy run forever. The exemption means any route added
 * under this directory that forgets `requireCronSecret` is fully public.
 *
 * ⚠ IT STILL CANNOT SEND. It calls the same `runCsmAgent` the manual button
 * does, which has no send tool, and `lib/gmail-send.ts` sends only as a
 * signed-in user. An unattended run has no mailbox to send from. Do not "fix"
 * that by adding a service sender.
 */
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const claimed = await claimNextRun();
    if (!claimed) {
      return NextResponse.json({ ok: true, processed: 0, note: "Nothing queued." });
    }

    const result = await runCsmAgent({
      customerNsId: claimed.customerNsId,
      trigger: "nightly",
      runBy: "cron",
      existingRunId: claimed.id,
    });

    if (!result.ok) {
      // The run row is already marked failed/stopped by runCsmAgent, except for
      // the pre-flight refusals (no profile, no customer) which never reach the
      // loop. Close those here so nothing is left stuck at `running`.
      await getSupabaseAdmin().from("cs_agent_runs").update({
        status: "stopped", stop_reason: "precondition",
        error: result.error, completed_at: new Date().toISOString(),
      }).eq("id", claimed.id).eq("status", "running");

      return NextResponse.json({
        ok: true, processed: 1, customerNsId: claimed.customerNsId,
        outcome: "not_run", reason: result.error,
      });
    }

    return NextResponse.json({
      ok: true, processed: 1,
      customerNsId: claimed.customerNsId,
      runId: result.runId, outcome: result.outcome,
      toolCalls: result.toolCalls, partial: result.partial,
    });
  } catch (e) {
    // A 500 with the reason, never a quiet success. An empty queue and a broken
    // worker must not look the same — a silently dead job is worse than no job.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/** Vercel Cron issues GET for some schedules; same work either way. */
export const GET = POST;
