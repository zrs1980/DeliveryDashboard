import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ROLE_MODEL, SUGGEST_TOOL, SUGGEST_SYSTEM,
  suggestionPrompt, validateSuggestions, type ContactForSuggestion,
} from "@/lib/cs-contact-roles";

export const revalidate = 0;
export const maxDuration = 120;

/**
 * POST /api/crm/contacts/suggest-roles  { customerNsId }
 *
 * Proposes a role for each unroled contact on an account, from the job title
 * alone. Writes `suggested_role`, never `role`.
 *
 * ⚠ SESSION-GATED, NOT `cs_layer`. A contact's job function is not risk data —
 * it is the same category as their phone number, and the CRM tab where contacts
 * are edited is open to anyone signed in. What the CS layer does with roles is
 * behind the boundary; the roles themselves are not.
 *
 * ⚠ NEVER OVERWRITES A HUMAN DECISION. Only contacts with `role = 'unknown'`
 * are considered. A role someone has set stays set, and re-running is safe.
 */

const MAX_CONTACTS = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  if (!customerNsId) {
    return NextResponse.json({ error: "customerNsId is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });

  const supabase = getSupabaseAdmin();

  try {
    const { data: rows, error } = await supabase
      .from("pm_crm_contacts")
      .select("id, name, job_title, role, is_active")
      .eq("customer_ns_id", customerNsId)
      .eq("is_active", true)
      .eq("role", "unknown")
      .limit(MAX_CONTACTS);

    if (error) {
      return NextResponse.json({
        error: error.message,
        hint: "Run supabase/cs-phase-a.sql in the Supabase SQL Editor.",
      }, { status: 503 });
    }

    const all = rows ?? [];
    // Titleless contacts are excluded before the model sees them — the title is
    // the entire basis, so sending them costs tokens to produce nothing.
    const candidates: ContactForSuggestion[] = all
      .filter(c => String(c.job_title ?? "").trim())
      .map(c => ({ id: String(c.id), name: String(c.name), jobTitle: String(c.job_title) }));

    const noTitle = all.length - candidates.length;

    if (candidates.length === 0) {
      return NextResponse.json({
        suggestions: [], written: 0, dropped: 0, noTitle,
        note: all.length === 0
          ? "Every active contact on this account already has a role set."
          : `${noTitle} contact${noTitle === 1 ? " has" : "s have"} no job title, which is `
            + "the only thing a role can be inferred from. Add titles, or set the roles by hand.",
      });
    }

    const anthropic = new Anthropic({ apiKey });
    const reply = await anthropic.messages.create({
      model: ROLE_MODEL,
      max_tokens: 4_000,
      system: SUGGEST_SYSTEM,
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: SUGGEST_TOOL.name },
      messages: [{ role: "user", content: suggestionPrompt(candidates) }],
    });

    const toolUse = reply.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    if (!toolUse) {
      return NextResponse.json({ error: "The model returned no suggestions." }, { status: 502 });
    }

    const { suggestions, dropped } = validateSuggestions(toolUse.input, candidates);

    // Written one at a time rather than upserted: an upsert would need every
    // NOT NULL column and could resurrect a deleted contact.
    let written = 0;
    const now = new Date().toISOString();
    for (const s of suggestions) {
      const { error: wErr } = await supabase.from("pm_crm_contacts").update({
        suggested_role: s.role,
        suggested_role_reason: s.reason,
        suggested_at: now,
      }).eq("id", s.id).eq("role", "unknown");   // re-checked at write time
      if (!wErr) written++;
    }

    const byId = new Map(candidates.map(c => [c.id, c]));
    return NextResponse.json({
      suggestions: suggestions.map(s => ({ ...s, name: byId.get(s.id)?.name ?? s.id })),
      written,
      // Reported rather than hidden: a short list should look short because the
      // titles were thin, not because the model underperformed.
      dropped,
      noTitle,
      considered: candidates.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
