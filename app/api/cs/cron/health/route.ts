import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;
// A full recompute walks every account and will call NetSuite per account.
// 55 accounts is comfortable inside this; revisit if the universe grows.
export const maxDuration = 300;

/**
 * Nightly health recompute — Phase 0 stub.
 *
 * Wiring only: it proves the cron reaches an authenticated endpoint and that the
 * schema is present. The signal computation and rules engine arrive in the
 * health-scoring phase; until then this deliberately writes nothing.
 *
 * Two things this endpoint has to get right, both of which fail silently:
 *
 * 1. It must NOT be behind the /login redirect. Vercel Cron arrives with no
 *    session, so proxy.ts would bounce it with a 302 and the job would return
 *    HTML 200 forever, looking healthy. Hence the /api/cs/cron exemption there.
 *
 * 2. Failure must be loud. An empty flag list is indistinguishable from "no
 *    accounts are at risk", so a dead job reads as good news. This returns a
 *    non-2xx on failure so Vercel's cron log shows it, and every run reports
 *    what it saw.
 */
export async function GET(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const startedAt = new Date().toISOString();

  try {
    // Phase 0's only real check: the schema is deployed and reachable. `head`
    // asks for the count without pulling rows.
    const db = getSupabaseAdmin();
    const { count, error } = await db
      .from("cs_health_snapshots")
      .select("*", { count: "exact", head: true });

    if (error) {
      // The most likely cause by far: cs-agent-schema.sql was never pasted into
      // the Supabase SQL editor. Name the file — a previous table in this repo
      // was missing for months because the error didn't say what to run.
      console.error("[cs/cron/health] schema check failed:", error.message);
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          hint: "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.",
          startedAt,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      phase: "0 — wiring only, no accounts scored yet",
      snapshotsExisting: count ?? 0,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cs/cron/health]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error", startedAt },
      { status: 500 },
    );
  }
}
