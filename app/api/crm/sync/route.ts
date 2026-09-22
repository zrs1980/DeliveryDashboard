import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncCrmFromNetSuite } from "@/lib/crm-sync";

export const revalidate  = 0;
export const maxDuration = 300;

/**
 * POST — pull contacts, opportunities and email history from NetSuite.
 *
 * Session-gated, not cs_layer-gated: the CRM is ordinary commercial work that
 * account managers and PMs do, not the risk data that boundary exists to
 * contain.
 *
 * One way. Nothing here writes back to NetSuite, and nothing here touches a
 * row created in this app — every upsert keys on the NetSuite id, which a
 * hand-entered contact or opportunity does not have.
 *
 * `?email=0` skips the 4,300-row message history, which is the slow part and
 * only needs running when it has actually changed.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const withEmail = new URL(req.url).searchParams.get("email") !== "0";
  const startedAt = Date.now();

  try {
    const result = await syncCrmFromNetSuite({ withEmail });
    return NextResponse.json({
      ok: true,
      ...result,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({
      ok: false,
      error: msg,
      hint: /relation|does not exist|schema cache/i.test(msg)
        ? "Run supabase/crm-schema.sql in the Supabase SQL Editor."
        : undefined,
    }, { status: 500 });
  }
}
