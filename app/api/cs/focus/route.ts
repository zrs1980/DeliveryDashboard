import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { buildFocus } from "@/lib/cs-focus";

export const revalidate  = 0;
export const maxDuration = 60;

/**
 * The Focus dashboard: which customers to open today, grouped by reason.
 *
 * ⚠ cs_layer-GATED. Four of its six sections are risk judgments — flags, health
 * bands, quiet-account inference, missed commitments — and a risk flag reaching
 * the delivery team is self-fulfilling. The renewal section alone is facts, and
 * those are already available without cs_layer on the customer page's Contracts
 * tab, so nothing is being withheld that someone else needs.
 *
 * Reads `cs_customer_index` — one SELECT rather than a fan-out across SuiteQL,
 * Supabase and ClickUp, which is what that table exists for. The index is
 * rebuilt nightly, so the response carries `refreshedAt` and the UI says so:
 * a stale view that looks identical to a fresh one is how stale data gets
 * trusted.
 */
export async function GET() {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  try {
    return NextResponse.json(await buildFocus());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 503 },
    );
  }
}
