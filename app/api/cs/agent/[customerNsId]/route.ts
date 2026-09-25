import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runCsmAgent } from "@/lib/cs-csm-run";

export const revalidate = 0;
export const maxDuration = 300;

const HINT = "Run supabase/cs-agent-runs.sql in the Supabase SQL Editor.";

/**
 * POST /api/cs/agent/[customerNsId] — run the CSM agent on one account.
 * GET  — recent runs for this account.
 *
 * The run itself lives in `lib/cs-csm-run.ts` so the nightly worker can call it
 * too; cron has no session and this route is cs_layer-gated, so keeping the
 * logic here would have meant a second copy of a decision agent.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ customerNsId: string }> },
) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;
  const { customerNsId } = await params;

  const { data, error } = await getSupabaseAdmin()
    .from("cs_agent_runs").select("*")
    .eq("customer_ns_id", customerNsId)
    .order("queued_at", { ascending: false }).limit(10);

  if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ customerNsId: string }> },
) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const { customerNsId } = await params;
  const result = await runCsmAgent({
    customerNsId, trigger: "manual", runBy: gate.session.email,
  });

  if (!result.ok) {
    const { status, ...rest } = result;
    return NextResponse.json({ ...rest, hint: status === 503 ? HINT : undefined }, { status });
  }
  return NextResponse.json(result);
}
