import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { RELEASE_MODEL, PARSE_TOOL, parseMessages, type ReleaseCategory } from "@/lib/cs-release";

export const revalidate  = 0;
export const maxDuration = 300;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";
const CATEGORIES: ReleaseCategory[] = ["new_feature", "enhancement", "deprecation", "breaking_change"];

/** GET ?version= — stored release items. */
export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const version = url.searchParams.get("version");

  try {
    let q = getSupabaseAdmin().from("cs_release_items").select("*");
    if (version) q = q.eq("release_version", version);
    const { data, error } = await q.order("release_version", { ascending: false }).order("category");
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });

    // Group by release so the UI can list what exists without a second call.
    const versions = [...new Set((data ?? []).map(i => i.release_version))];
    return NextResponse.json({ items: data ?? [], versions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/**
 * POST { product, version, releaseDate?, notes } — ingest pasted release notes.
 *
 * Manual paste is a first-class path, not a fallback. docs/05-RELEASE-MATCHING.md
 * is blunt about why: release note formats change, and an ingestion pipeline
 * that breaks twice a year at exactly the moment you need it is worse than a
 * paste box.
 */
export async function POST(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { product?: string; version?: string; releaseDate?: string; notes?: string; sourceUrl?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const product = body.product === "loop_erp" ? "loop_erp" : "netsuite";
  const version = String(body.version ?? "").trim();
  const notes   = String(body.notes ?? "").trim();

  if (!version) return NextResponse.json({ error: "version is required, e.g. 2026.2" }, { status: 400 });
  if (notes.length < 200) {
    return NextResponse.json({ error: "Paste the release notes — that looks too short to parse." }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { system, messages } = parseMessages(notes.slice(0, 400_000), product, version);

    const stream = client.messages.stream({
      model: RELEASE_MODEL, max_tokens: 16_000, system, messages,
      tools: [PARSE_TOOL], tool_choice: { type: "tool", name: PARSE_TOOL.name },
    });
    const deadline = setTimeout(() => stream.abort(), 240_000);
    let message;
    try { message = await stream.finalMessage(); }
    catch (e) {
      const aborted = e instanceof Error && /abort/i.test(e.message);
      return NextResponse.json({
        error: aborted ? "Parsing timed out — try pasting a smaller section." : `Model call failed: ${e instanceof Error ? e.message : "unknown"}`,
      }, { status: aborted ? 504 : 502 });
    } finally { clearTimeout(deadline); }

    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) return NextResponse.json({ error: "The model returned no items." }, { status: 502 });

    const raw = (toolUse.input as { items?: unknown[] }).items ?? [];
    const releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.releaseDate ?? "")) ? String(body.releaseDate) : null;

    // Re-validate: a malformed item becomes a dropped item, not a bad row.
    const rows = raw.flatMap(r => {
      if (!r || typeof r !== "object") return [];
      const o = r as Record<string, unknown>;
      const title = String(o.title ?? "").trim();
      if (!title) return [];
      return [{
        product,
        release_version: version,
        release_date:    releaseDate,
        title,
        description:     String(o.description ?? "").trim(),
        source_url:      String(body.sourceUrl ?? "").trim() || null,
        modules_affected: Array.isArray(o.modules_affected)
          ? o.modules_affected.map(m => String(m).trim()).filter(Boolean) : [],
        relevance_criteria: (o.relevance_criteria && typeof o.relevance_criteria === "object")
          ? o.relevance_criteria as Record<string, unknown> : {},
        category: CATEGORIES.includes(o.category as ReleaseCategory) ? o.category as ReleaseCategory : null,
      }];
    });

    if (!rows.length) {
      return NextResponse.json({ error: "Nothing matchable was found in that text." }, { status: 422 });
    }

    // Replace this version wholesale. Re-pasting corrected notes should not
    // leave the previous parse's items behind to be matched against.
    await getSupabaseAdmin().from("cs_release_items")
      .delete().eq("release_version", version).eq("product", product);

    const { data, error } = await getSupabaseAdmin()
      .from("cs_release_items").insert(rows).select();
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });

    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.category ?? "uncategorised"] = (byCategory[r.category ?? "uncategorised"] ?? 0) + 1;

    return NextResponse.json({
      items: data, parsed: rows.length, byCategory,
      dropped: raw.length - rows.length,
      usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
