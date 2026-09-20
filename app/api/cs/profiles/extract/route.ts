import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { gatherCustomerCorpus } from "@/lib/cs-profile-corpus";
import {
  PROFILE_MODEL, PROFILE_TOOL, EXTRACTION_VERSION,
  profileMessages, validateProfile, extractionDrops, findContradictions,
} from "@/lib/cs-profile-extract";
import { runSuiteQL } from "@/lib/netsuite";

export const revalidate  = 0;
export const maxDuration = 300;

/** Leave headroom under maxDuration so a slow model call returns JSON, not Vercel's HTML 504. */
const MODEL_BUDGET_MS = 240_000;

/**
 * POST { customerNsId, force? } — extract and store this customer's profile.
 *
 * Re-extraction never destroys human input. `human_notes` is carried across
 * untouched, and a profile marked `human_verified` is NOT overwritten: the route
 * answers 409 with both versions so the caller can diff and decide. The spec
 * asks for a diff view before committing, and silently replacing a profile
 * someone has checked is the one outcome that would make verification
 * pointless.
 */
export async function POST(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { customerNsId?: string | number; force?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  if (!customerNsId) return NextResponse.json({ error: "customerNsId is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  try {
    // Name from NetSuite — the customer master, not our copy of it.
    const nameRows = await runSuiteQL<{ companyname: string | null }>(
      `SELECT companyname FROM customer WHERE id = ?`, [Number(customerNsId)],
    );
    const customerName = nameRows?.[0]?.companyname ?? `Customer ${customerNsId}`;

    const { data: existing, error: readErr } = await supabase
      .from("cs_customer_profiles")
      .select("*")
      .eq("customer_ns_id", customerNsId)
      .maybeSingle();

    // A failed read must not be treated as "no profile yet" — that is how the
    // meeting_docs duplicate-check silently disabled itself for months.
    if (readErr) {
      return NextResponse.json({
        error: `Could not read existing profile: ${readErr.message}`,
        hint:  "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.",
      }, { status: 503 });
    }

    if (existing?.human_verified && !body.force) {
      return NextResponse.json({
        error:   "This profile is marked human-verified and was not overwritten.",
        reason:  "Re-extract with force: true once you have compared the two versions.",
        profile: existing,
      }, { status: 409 });
    }

    const corpus = await gatherCustomerCorpus(customerNsId);

    const hasMaterial =
      corpus.projects.length || corpus.cases.length || corpus.timeMemos.length;
    if (!hasMaterial) {
      return NextResponse.json({
        error: "Nothing to extract from — no projects, cases or time memos for this customer.",
        stats: corpus.stats,
      }, { status: 422 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { system, messages } = profileMessages(corpus, customerName);

    // Streamed purely to hold the connection open on a large corpus — Yield
    // Engineering runs to ~105k tokens. Same reason as /api/meetings/analysis.
    const stream = client.messages.stream({
      model:       PROFILE_MODEL,
      max_tokens:  8_000,
      system,
      messages,
      tools:       [PROFILE_TOOL],
      tool_choice: { type: "tool", name: PROFILE_TOOL.name },
    });

    const deadline = setTimeout(() => stream.abort(), MODEL_BUDGET_MS);
    let message;
    try { message = await stream.finalMessage(); }
    catch (e) {
      const aborted = e instanceof Error && /abort/i.test(e.message);
      return NextResponse.json({
        error: aborted
          ? "Extraction timed out. This customer's history is unusually large."
          : `Model call failed: ${e instanceof Error ? e.message : "unknown"}`,
      }, { status: aborted ? 504 : 502 });
    } finally { clearTimeout(deadline); }

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      return NextResponse.json({ error: "The model returned no profile. Try again." }, { status: 502 });
    }

    // Re-validate rather than trusting the model's shape. Unevidenced claims are
    // dropped here, and the count is reported so the loss is visible.
    const profile = validateProfile(toolUse.input);
    const drops   = extractionDrops(toolUse.input, profile);

    const row = {
      customer_ns_id:    customerNsId,
      customer_name:     customerName,
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
      // Human input survives re-extraction, always.
      human_notes:       existing?.human_notes ?? null,
      human_verified:    false,
    };

    const { data: saved, error: writeErr } = await supabase
      .from("cs_customer_profiles")
      .upsert(row, { onConflict: "customer_ns_id" })
      .select()
      .single();

    if (writeErr) {
      // The extraction succeeded and cost real tokens — hand it back rather than
      // losing it to a storage failure.
      return NextResponse.json({
        error: `Extracted but could not save: ${writeErr.message}`,
        profile: row,
      }, { status: 500 });
    }

    return NextResponse.json({
      profile: saved,
      corpus: {
        projects:   corpus.projects.length,
        cases:      corpus.cases.length,
        uniqueMemos: corpus.stats.uniqueMemoCount,
        rawCaseChars:  corpus.stats.rawCaseChars,
        keptCaseChars: corpus.stats.keptCaseChars,
        notes:      corpus.stats.notes,
      },
      droppedUnevidenced: drops,
      // Listed as both owned and not-bought. Reported, not auto-corrected —
      // which side is wrong depends on evidence a person has to weigh.
      contradictions: findContradictions(profile),
      usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 },
    );
  }
}
