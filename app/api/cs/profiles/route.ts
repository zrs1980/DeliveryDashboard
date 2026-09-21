import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { validateProfile, resolveContradictions, EXTRACTION_VERSION } from "@/lib/cs-profile-extract";

export const revalidate = 0;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";

/** GET — all profiles, or one with ?customerNsId=. */
export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const customerNsId = new URL(req.url).searchParams.get("customerNsId");
  const supabase = getSupabaseAdmin();

  try {
    if (customerNsId) {
      const { data, error } = await supabase
        .from("cs_customer_profiles")
        .select("*")
        .eq("customer_ns_id", customerNsId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
      return NextResponse.json({ profile: data ?? null });
    }

    const { data, error } = await supabase
      .from("cs_customer_profiles")
      .select("*")
      .order("extracted_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });

    return NextResponse.json({ profiles: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/**
 * PUT { customerNsId, customerName, profile } — commit a dry-run extraction.
 *
 * The diff flow extracts with `dryRun`, shows the result beside the current
 * profile, and commits the accepted one through here. Re-running extraction on
 * accept would pay for the model twice and could return something different
 * from what was just approved.
 *
 * The body is re-validated rather than trusted: it has been through the
 * browser, and an unevidenced claim must not get in by the side door.
 * `human_notes` is read from the stored row, never from the request.
 */
export async function PUT(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { customerNsId?: string; customerName?: string; profile?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  if (!customerNsId || !body.profile) {
    return NextResponse.json({ error: "customerNsId and profile are required" }, { status: 400 });
  }

  const p = validateProfile((body.profile as Record<string, unknown>) ?? {});
  const { profile } = resolveContradictions(p);
  const supabase = getSupabaseAdmin();

  try {
    const { data: existing, error: readErr } = await supabase
      .from("cs_customer_profiles")
      .select("human_notes")
      .eq("customer_ns_id", customerNsId)
      .maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message, hint: SCHEMA_HINT }, { status: 503 });

    const { data, error } = await supabase
      .from("cs_customer_profiles")
      .upsert({
        customer_ns_id:    customerNsId,
        customer_name:     String(body.customerName ?? "").trim() || `Customer ${customerNsId}`,
        modules_owned:     profile.modules_owned,
        integrations:      profile.integrations,
        netsuite_edition:  profile.netsuite_edition,
        industry:          profile.industry,
        company_size:      profile.company_size,
        customisations:    profile.customisations,
        pain_points:       profile.pain_points,
        manual_processes:  profile.manual_processes,
        features_enquired_not_purchased: profile.features_enquired_not_purchased,
        declined_items:    profile.declined_items,
        extracted_at:      new Date().toISOString(),
        extraction_version: EXTRACTION_VERSION,
        human_notes:       existing?.human_notes ?? null,
        // Accepting a fresh extraction resets verification — what was checked
        // is not what is now stored.
        human_verified:    false,
      }, { onConflict: "customer_ns_id" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ profile: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/**
 * PATCH { customerNsId, human_notes?, human_verified? } — the human's half.
 *
 * Only these two columns are writable here. The extracted fields are the
 * model's output and are replaced wholesale by a re-extraction; letting this
 * route edit them too would leave no way to tell which parts of a profile a
 * person actually stands behind. Correcting an extracted claim is a Phase 1 UI
 * concern and needs per-field provenance the schema does not carry yet.
 */
export async function PATCH(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { customerNsId?: string; human_notes?: string | null; human_verified?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  if (!customerNsId) return NextResponse.json({ error: "customerNsId is required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("human_notes" in body)    patch.human_notes    = body.human_notes ?? null;
  if ("human_verified" in body) patch.human_verified = Boolean(body.human_verified);
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update — send human_notes or human_verified." }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("cs_customer_profiles")
      .update(patch)
      .eq("customer_ns_id", customerNsId)
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    if (!data)  return NextResponse.json({ error: "No profile for that customer — extract one first." }, { status: 404 });

    return NextResponse.json({ profile: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
