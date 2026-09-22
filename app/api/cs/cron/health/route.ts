import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cs-permissions";
import { runHealthScoring } from "@/lib/cs-scoring-run";

export const revalidate  = 0;
export const maxDuration = 300;

/**
 * Nightly health recompute — every account, every night.
 *
 * Evaluates all customers rather than reacting to events, because the state this
 * exists to catch generates no events: nothing happening at all. See
 * docs/03-HEALTH-SCORING.md, "the absence problem".
 *
 * Authenticates on CRON_SECRET, not a session — Vercel Cron arrives with none.
 * The path is exempted in proxy.ts; without that the request is redirected to
 * /login and the job returns HTML 200 forever, which reads as a healthy run.
 *
 * ⚠ A FAILED RUN MUST BE LOUD. An empty flag list reads as "no risk", so a
 * silently dead job is worse than no job. Failures return 500 with the reason,
 * and partial failures come back as `warnings` on an otherwise successful run
 * rather than being swallowed.
 */
export async function GET(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const startedAt = new Date().toISOString();

  try {
    const result = await runHealthScoring();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[cs/cron] health run failed:", msg);
    return NextResponse.json({
      ok: false,
      error: msg,
      hint: /relation|does not exist|schema/i.test(msg)
        ? "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor."
        : undefined,
      startedAt,
    }, { status: 500 });
  }
}
