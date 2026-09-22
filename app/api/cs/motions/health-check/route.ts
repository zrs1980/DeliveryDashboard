import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSuppressionChecks } from "@/lib/cs-suppression";
import {
  HEALTHCHECK_MODEL, HEALTHCHECK_TOOL, healthCheckMessages, quotableFacts, lintDraft,
} from "@/lib/cs-healthcheck";

export const revalidate  = 0;
export const maxDuration = 120;

/**
 * POST { customerNsId, flagId? } — generate a health-check draft.
 *
 * Flag-triggered: an account surfaces in triage, and this turns the flag into a
 * specific email about that account. The draft lands in the queue with status
 * `draft` and goes nowhere until a person approves it.
 *
 * Nothing here can send. The route writes a row; sending is a separate,
 * explicitly human action through /api/cs/drafts.
 */
export async function POST(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { customerNsId?: string; flagId?: string; contactName?: string; contactId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  if (!customerNsId) return NextResponse.json({ error: "customerNsId is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  try {
    const [{ data: profile }, { data: flags }, { data: snap }] = await Promise.all([
      supabase.from("cs_customer_profiles").select("*").eq("customer_ns_id", customerNsId).maybeSingle(),
      supabase.from("cs_health_flags").select("*")
        .eq("customer_ns_id", customerNsId).in("status", ["open", "acknowledged"]),
      supabase.from("cs_health_snapshots").select("signals, score, band")
        .eq("customer_ns_id", customerNsId).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (!profile) {
      return NextResponse.json({
        error: "No profile for this customer. A health check with nothing specific in it is worse than none — extract a profile first.",
      }, { status: 422 });
    }

    const flag = body.flagId
      ? (flags ?? []).find(f => f.id === body.flagId)
      : (flags ?? [])[0];

    if (!flag) {
      return NextResponse.json({
        error: "No open flag for this customer. The health-check motion is flag-triggered — there is no reason to write.",
      }, { status: 422 });
    }

    // The fact filter. Everything unverified is withheld from the prompt
    // entirely, so the model cannot reference what it was never told.
    const facts = quotableFacts(profile);
    const signals = (snap?.signals ?? {}) as Record<string, unknown>;

    const { system, messages } = healthCheckMessages(facts, {
      daysSinceLastHour: (signals.daysSinceLastHour as number | null) ?? null,
      flagTitle:  flag.title,
      flagReason: flag.reason,
      contactName: body.contactName ?? null,
    });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: HEALTHCHECK_MODEL,
      max_tokens: 1200,
      system,
      messages,
      tools: [HEALTHCHECK_TOOL],
      tool_choice: { type: "tool", name: HEALTHCHECK_TOOL.name },
    });

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) return NextResponse.json({ error: "The model returned no draft. Try again." }, { status: 502 });

    const out = toolUse.input as { subject?: string; body?: string; rationale?: string; factsUsed?: string[] };
    const subject   = String(out.subject ?? "").trim();
    const draftBody = String(out.body ?? "").trim();
    const rationale = String(out.rationale ?? "").trim();

    if (!subject || !draftBody || !rationale) {
      return NextResponse.json({ error: "The model returned an incomplete draft." }, { status: 502 });
    }

    // Corporate filler the spec names outright. Surfaced to the reviewer rather
    // than silently rewritten — the draft is theirs to judge.
    const lint = lintDraft(draftBody);

    const suppression = await runSuppressionChecks({
      customerNsId, contactId: body.contactId ?? null,
      motion: "health_check", subject, body: draftBody,
    });

    const { data: draft, error } = await supabase
      .from("cs_outreach_drafts")
      .insert({
        customer_ns_id: customerNsId,
        contact_id:     body.contactId ?? null,
        motion:         "health_check",
        subject,
        body:           draftBody,
        rationale,
        evidence: {
          flagId: flag.id, ruleId: flag.rule_id, flagTitle: flag.title,
          score: snap?.score ?? null, band: snap?.band ?? null,
          factsUsed: out.factsUsed ?? [],
          factsWithheld: facts.withheld.total,
          profileVerified: Boolean(profile.human_verified),
        },
        status: suppression.blocked ? "rejected" : "draft",
        rejection_reason: suppression.blocked ? suppression.reasons.join(" · ") : null,
        suppression_checks: { checks: suppression.checks, blocked: suppression.blocked },
        generated_at: new Date().toISOString(),
        expires_at:   new Date(Date.now() + 14 * 86_400_000).toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({
        error: `Draft generated but not saved: ${error.message}`,
        draft: { subject, body: draftBody, rationale },
      }, { status: 500 });
    }

    return NextResponse.json({
      draft,
      suppression,
      lint,
      facts: {
        quotable: facts.painPoints.length + facts.manualProcesses.length + facts.customisations.length,
        withheld: facts.withheld,
        profileVerified: Boolean(profile.human_verified),
      },
      usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
