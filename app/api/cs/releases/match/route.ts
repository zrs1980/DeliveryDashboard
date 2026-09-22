import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { RELEASE_MODEL, MATCH_TOOL, matchMessages, overlapRatio } from "@/lib/cs-release";

export const revalidate  = 0;
export const maxDuration = 300;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";

interface EvidencedItem { description: string; confidence: string; basis: string }
const descriptions = (xs: EvidencedItem[] | undefined) =>
  (xs ?? []).map(x => String(x?.description ?? "")).filter(Boolean);

/**
 * POST { version, product?, customerNsIds?, minScore? } — match a release
 * against customer profiles.
 *
 * One model call per customer, deliberately. Matching is the product here, and
 * asking one call to reason about fifteen customers at once produces fifteen
 * versions of the same paragraph — which is the exact failure the spec warns
 * about: "If the three documents are substantially similar, the matching is not
 * working."
 *
 * The response reports overlap between customers' matched sets, so that failure
 * is visible as a number rather than only on reading the PDFs.
 */
export async function POST(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { version?: string; product?: string; customerNsIds?: string[]; minScore?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const version = String(body.version ?? "").trim();
  if (!version) return NextResponse.json({ error: "version is required" }, { status: 400 });
  const minScore = Number.isFinite(Number(body.minScore)) ? Number(body.minScore) : 0.35;

  const supabase = getSupabaseAdmin();

  try {
    const { data: items, error: iErr } = await supabase
      .from("cs_release_items").select("*").eq("release_version", version)
      .order("id", { ascending: true });
    if (iErr) return NextResponse.json({ error: iErr.message, hint: SCHEMA_HINT }, { status: 503 });
    if (!items?.length) {
      return NextResponse.json({ error: `No release items stored for ${version}. Ingest the notes first.` }, { status: 422 });
    }

    let pq = supabase.from("cs_customer_profiles").select("*");
    if (body.customerNsIds?.length) pq = pq.in("customer_ns_id", body.customerNsIds);
    const { data: profiles, error: pErr } = await pq;
    if (pErr) return NextResponse.json({ error: pErr.message, hint: SCHEMA_HINT }, { status: 503 });
    if (!profiles?.length) {
      return NextResponse.json({
        error: "No customer profiles to match against. Release matching is only as good as the profiles — extract some first.",
      }, { status: 422 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const perCustomer: Array<{ customerNsId: string; customerName: string; matched: number; titles: string[] }> = [];
    const rowsToWrite: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];

    for (const p of profiles) {
      const { system, messages } = matchMessages(
        items.map(i => ({
          title: i.title, description: i.description,
          modules_affected: i.modules_affected ?? [], category: i.category,
          relevance_criteria: i.relevance_criteria ?? {},
        })),
        {
          customerName: p.customer_name,
          modules:      p.modules_owned ?? [],
          integrations: p.integrations ?? [],
          painPoints:       descriptions(p.pain_points),
          manualProcesses:  descriptions(p.manual_processes),
          customisations:   descriptions(p.customisations),
          enquiredNotPurchased: descriptions(p.features_enquired_not_purchased),
          declined:         descriptions(p.declined_items),
        },
      );

      let message;
      try {
        message = await client.messages.create({
          model: RELEASE_MODEL, max_tokens: 8_000, system, messages,
          tools: [MATCH_TOOL], tool_choice: { type: "tool", name: MATCH_TOOL.name },
        });
      } catch (e) {
        // One customer failing must not lose the whole run — matching is
        // expensive and the others are already paid for.
        warnings.push(`${p.customer_name}: ${e instanceof Error ? e.message : "model call failed"}`);
        continue;
      }

      const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const raw = toolUse ? ((toolUse.input as { matches?: unknown[] }).matches ?? []) : [];

      const titles: string[] = [];
      for (const m of raw) {
        if (!m || typeof m !== "object") continue;
        const o = m as Record<string, unknown>;
        const idx = Number(o.itemIndex);
        const item = items[idx];
        const score = Number(o.relevanceScore);
        const reasoning = String(o.reasoning ?? "").trim();
        // A match with no reasoning is not a match — the reasoning IS the
        // product, and an item with nothing customer-specific to say about it
        // would arrive as a bare bullet the vendor already sent them.
        if (!item || !Number.isFinite(score) || score < minScore || !reasoning) continue;

        titles.push(item.title);
        rowsToWrite.push({
          release_item_id: item.id,
          customer_ns_id:  p.customer_ns_id,
          relevance_score: score,
          reasoning,
          matched_on: {
            attributes: Array.isArray(o.matchedOn) ? o.matchedOn.map(String) : [],
            actionRequired: Boolean(o.actionRequired),
            category: item.category,
          },
          included_in_pdf: true,
        });
      }

      perCustomer.push({
        customerNsId: p.customer_ns_id, customerName: p.customer_name,
        matched: titles.length, titles,
      });
    }

    // Replace this release's matches rather than accumulating duplicates from
    // a re-run. The unique index would reject them anyway; this makes a re-run
    // mean "recompute", which is what the button says.
    if (rowsToWrite.length) {
      const itemIds = items.map(i => i.id);
      await supabase.from("cs_release_matches").delete().in("release_item_id", itemIds);
      const { error: wErr } = await supabase.from("cs_release_matches").insert(rowsToWrite);
      if (wErr) return NextResponse.json({ error: wErr.message, hint: SCHEMA_HINT }, { status: 503 });
    }

    // The spec's validation test, as a number: if everyone matched the same
    // items, the matching is not working and the profiles are too thin.
    let maxOverlap = 0;
    let mostSimilar: [string, string] | null = null;
    for (let i = 0; i < perCustomer.length; i++) {
      for (let j = i + 1; j < perCustomer.length; j++) {
        const r = overlapRatio(perCustomer[i].titles, perCustomer[j].titles);
        if (r > maxOverlap) {
          maxOverlap = r;
          mostSimilar = [perCustomer[i].customerName, perCustomer[j].customerName];
        }
      }
    }
    if (maxOverlap >= 0.8 && perCustomer.length > 1) {
      warnings.push(
        `${Math.round(maxOverlap * 100)}% of matched items are shared between ` +
        `${mostSimilar?.[0]} and ${mostSimilar?.[1]}. If the documents read alike, the ` +
        `matching is not working — the profiles are probably too thin.`,
      );
    }

    return NextResponse.json({
      version,
      itemsConsidered: items.length,
      customers: perCustomer.sort((a, b) => b.matched - a.matched),
      totalMatches: rowsToWrite.length,
      maxOverlap: Math.round(maxOverlap * 100) / 100,
      warnings,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/** GET ?version=&customerNsId= — matches, for the curation matrix and the PDF. */
export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const version = url.searchParams.get("version");
  const customerNsId = url.searchParams.get("customerNsId");

  try {
    const supabase = getSupabaseAdmin();
    const { data: items } = version
      ? await supabase.from("cs_release_items").select("*").eq("release_version", version)
      : await supabase.from("cs_release_items").select("*");

    const ids = (items ?? []).map(i => i.id);
    if (!ids.length) return NextResponse.json({ matches: [], items: [] });

    let q = supabase.from("cs_release_matches").select("*").in("release_item_id", ids);
    if (customerNsId) q = q.eq("customer_ns_id", customerNsId);
    const { data: matches, error } = await q.order("relevance_score", { ascending: false });
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });

    return NextResponse.json({ matches: matches ?? [], items: items ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/** PATCH { id, includedInPdf?, reasoning? } — human curation. */
export async function PATCH(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { id?: string; includedInPdf?: boolean; reasoning?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("includedInPdf" in body) patch.included_in_pdf = Boolean(body.includedInPdf);
  if (typeof body.reasoning === "string") patch.reasoning = body.reasoning.trim();
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("cs_release_matches").update(patch).eq("id", id).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    if (!data)  return NextResponse.json({ error: "No match with that id" }, { status: 404 });
    return NextResponse.json({ match: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
