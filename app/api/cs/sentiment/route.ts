import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";
const RATINGS = ["green", "amber", "red"] as const;

/**
 * Consultant sentiment — the cheapest high-value signal in the package.
 *
 * docs/01-DATA-MODEL.md: "An amber from a consultant who has been on site
 * outranks any derived metric in the system." With no product telemetry it is
 * also the only route to relational context, which is why the spec puts it in
 * Phase 2 despite belonging to no motion yet: it needs months of data before it
 * is worth anything, so it has to start collecting early.
 *
 * ⚠ POST IS DELIBERATELY NOT GATED ON cs_layer.
 *
 * Every other /api/cs/* route requires it. This one must not: consultants are
 * the people with the opinion worth capturing, and they do not — and must not —
 * hold cs_layer, because risk data reaching the delivery team is
 * self-fulfilling. The access matrix in 01-DATA-MODEL.md says exactly this:
 * consultants may ENTER sentiment, and see nothing else in this module.
 *
 * Reading it back is a different matter and stays behind cs_layer: the trend
 * across an account is commercial risk data.
 */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    customerNsId?: string; projectNsId?: string | null;
    consultantNsId?: number; consultantName?: string;
    rating?: string; note?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  const rating = String(body.rating ?? "").trim();
  if (!customerNsId) return NextResponse.json({ error: "customerNsId is required" }, { status: 400 });
  if (!RATINGS.includes(rating as typeof RATINGS[number])) {
    return NextResponse.json({ error: `rating must be one of ${RATINGS.join("/")}` }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("cs_consultant_sentiment")
      .insert({
        customer_ns_id:  customerNsId,
        project_ns_id:   body.projectNsId ? String(body.projectNsId) : null,
        // The schema types this as integer where everything else is text. Left
        // as-is rather than diverging from the deployed table; 0 stands for
        // "known by email, id not supplied".
        consultant_ns_id: Number.isFinite(Number(body.consultantNsId)) ? Number(body.consultantNsId) : 0,
        consultant_name:  String(body.consultantName ?? "").trim() || email,
        rating,
        note:             String(body.note ?? "").trim() || null,
        captured_at:      new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ sentiment: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/** GET ?customerNsId= — history. Behind cs_layer: the trend is risk data. */
export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const customerNsId = new URL(req.url).searchParams.get("customerNsId");

  try {
    let q = getSupabaseAdmin().from("cs_consultant_sentiment").select("*");
    if (customerNsId) q = q.eq("customer_ns_id", customerNsId);
    const { data, error } = await q.order("captured_at", { ascending: false }).limit(500);
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ sentiment: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
