import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSuppressionChecks } from "@/lib/cs-suppression";
import { RELEASE_MODEL } from "@/lib/cs-release";
import { lintDraft } from "@/lib/cs-healthcheck";

export const revalidate  = 0;
export const maxDuration = 120;

/**
 * POST { customerNsId, version } — the covering email for a release PDF.
 *
 * Short, names one or two of the most relevant items, offers a conversation.
 * The document does the work; this only has to get it opened.
 *
 * Routed through the draft queue like everything else — the PDF is attached by
 * the reviewer at send time, since it is generated client-side from the curated
 * match set and is whatever they last curated.
 */
export async function POST(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { customerNsId?: string; version?: string; contactId?: string; contactName?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  const version      = String(body.version ?? "").trim();
  if (!customerNsId || !version) {
    return NextResponse.json({ error: "customerNsId and version are required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data: items } = await supabase
      .from("cs_release_items").select("*").eq("release_version", version);
    if (!items?.length) {
      return NextResponse.json({ error: `No release items for ${version}.` }, { status: 422 });
    }

    const { data: matches } = await supabase
      .from("cs_release_matches").select("*")
      .eq("customer_ns_id", customerNsId)
      .in("release_item_id", items.map(i => i.id))
      .eq("included_in_pdf", true)
      .order("relevance_score", { ascending: false });

    if (!matches?.length) {
      return NextResponse.json({
        error: "Nothing is curated in for this customer. A covering email with an empty document behind it is worse than no email.",
      }, { status: 422 });
    }

    const { data: profile } = await supabase
      .from("cs_customer_profiles").select("customer_name")
      .eq("customer_ns_id", customerNsId).maybeSingle();
    const customerName = profile?.customer_name ?? `Customer ${customerNsId}`;

    const itemById = Object.fromEntries(items.map(i => [i.id, i]));
    const top = matches.slice(0, 3).map(m => ({
      title: itemById[m.release_item_id]?.title ?? "",
      reasoning: m.reasoning,
      actionRequired: Boolean((m.matched_on as { actionRequired?: boolean })?.actionRequired),
    }));

    const product = items[0].product === "loop_erp" ? "Loop ERP" : "NetSuite";
    const anyAction = matches.some(m => (m.matched_on as { actionRequired?: boolean })?.actionRequired);

    const system = `You write the short covering email that goes with a tailored release document.

The document does the work. This email only has to get it opened.

- Three or four sentences. No more.
- Name one or two specific items from the document, in the customer's terms — the reason they matter, not the feature name.
- Say plainly that it only covers what affects them, not the whole release. That is the reason it is worth reading.
- If something needs action before the release lands, say so explicitly and early.
- One ask: a conversation, offered lightly. Not a meeting request.
- Write like a person. No "I hope this finds you well", no "wanted to reach out", no bullet points, no marketing.
- Do not mention internal metrics, scores or how long it has been since you last spoke.`;

    const prompt = [
      `CUSTOMER: ${customerName}`,
      body.contactName ? `WRITING TO: ${body.contactName}` : "",
      `RELEASE: ${product} ${version}`,
      `ITEMS IN THEIR DOCUMENT: ${matches.length}`,
      anyAction ? `SOMETHING NEEDS ACTION BEFORE THE RELEASE LANDS.` : "",
      ``,
      `THE MOST RELEVANT ITEMS, with the reasoning that appears in their document:`,
      ...top.map(t => `\n- ${t.title}${t.actionRequired ? "  [ACTION NEEDED]" : ""}\n  ${t.reasoning}`),
    ].filter(Boolean).join("\n");

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: RELEASE_MODEL,
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [{
        name: "write_covering_email",
        description: "Write the covering email for this customer's release document.",
        input_schema: {
          type: "object",
          properties: {
            subject:   { type: "string", description: "Specific and plain. Reference the release or the thing that matters, not both." },
            body:      { type: "string", description: "Three or four sentences. 'Hi <name>,' opening, no signature." },
            rationale: { type: "string", description: "For the reviewer: which items you led with and why." },
          },
          required: ["subject", "body", "rationale"],
        },
      }],
      tool_choice: { type: "tool", name: "write_covering_email" },
    });

    const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) return NextResponse.json({ error: "The model returned no draft." }, { status: 502 });

    const out = toolUse.input as { subject?: string; body?: string; rationale?: string };
    const subject   = String(out.subject ?? "").trim();
    const draftBody = String(out.body ?? "").trim();
    const rationale = String(out.rationale ?? "").trim();
    if (!subject || !draftBody || !rationale) {
      return NextResponse.json({ error: "The model returned an incomplete draft." }, { status: 502 });
    }

    const suppression = await runSuppressionChecks({
      customerNsId, contactId: body.contactId ?? null,
      motion: "release", subject, body: draftBody,
    });

    const { data: draft, error } = await supabase
      .from("cs_outreach_drafts")
      .insert({
        customer_ns_id: customerNsId,
        contact_id:     body.contactId ?? null,
        motion:         "release",
        subject, body: draftBody, rationale,
        evidence: {
          version, product: items[0].product,
          itemsIncluded: matches.length,
          leadItems: top.map(t => t.title),
          actionRequired: anyAction,
        },
        // The PDF is generated client-side from the curated set, so the
        // reviewer attaches whatever they last curated rather than a copy taken
        // at generation time that may since have been edited.
        attachments: [{ kind: "release_pdf", version, customerNsId, note: "Generated from the curated match set at send time." }],
        status: suppression.blocked ? "rejected" : "draft",
        rejection_reason: suppression.blocked ? suppression.reasons.join(" · ") : null,
        suppression_checks: { checks: suppression.checks, blocked: suppression.blocked },
        generated_at: new Date().toISOString(),
        // Release emails expire with the release cycle, not in a fortnight.
        expires_at: new Date(Date.now() + 45 * 86_400_000).toISOString(),
      })
      .select().single();

    if (error) {
      return NextResponse.json({ error: `Draft generated but not saved: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ draft, suppression, lint: lintDraft(draftBody), itemsIncluded: matches.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
