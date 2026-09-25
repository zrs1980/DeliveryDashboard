import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSuppressionChecks } from "@/lib/cs-suppression";
import { sendAsUser } from "@/lib/gmail-send";

export const revalidate = 0;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";
const MOTIONS = ["health_check", "qbr", "release", "renewal", "commitment_followup"] as const;

/**
 * The draft queue — the control surface.
 *
 * docs/04-DRAFT-QUEUE.md calls this the most important component in the
 * package, and says to build it BEFORE any generator so output has somewhere to
 * land and be inspected. It is built first here for that reason: nothing
 * generates drafts yet.
 *
 * ⚠ DRAFT, NEVER AUTOSEND. Permanent, not a v1 safety measure. Sending happens
 * on an explicit PATCH from a signed-in reviewer, through THEIR mailbox — see
 * lib/gmail-send.ts. There is no code path from the nightly job to an outbound
 * email, and there must never be one.
 *
 * Three reasons, kept here on purpose:
 *   1. A wrong email to a customer is unrecoverable in a way a wrong row is not.
 *   2. The goal is to open relationships. One tone-deaf automated message closes
 *      them, and the failure is silent — people do not tell you they have
 *      written you off.
 *   3. Human review is the training signal. What gets edited reveals where
 *      generation is weak; removing review removes the feedback loop.
 */

/** GET ?status=draft|approved|sent|… — the queue. Defaults to actionable ones. */
export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const customerNsId = url.searchParams.get("customerNsId");

  try {
    const supabase = getSupabaseAdmin();
    let q = supabase.from("cs_outreach_drafts").select("*");
    if (status) q = q.eq("status", status);
    else q = q.in("status", ["draft", "approved", "snoozed"]);
    if (customerNsId) q = q.eq("customer_ns_id", customerNsId);

    const { data, error } = await q.order("generated_at", { ascending: false }).limit(200);
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });

    // Expiry is evaluated on read rather than by a job. A health-check reference
    // three weeks stale is worse than no email, and a draft that quietly became
    // sendable again because no cleanup ran would be exactly that.
    const now = Date.now();
    const base = (data ?? []).map(d => ({
      ...d,
      isExpired: Boolean(d.expires_at && new Date(d.expires_at).getTime() < now),
      isSnoozed: Boolean(d.snoozed_until && new Date(d.snoozed_until).getTime() > now),
    }));

    // Resolve the recipient so the queue can pre-fill it. Today the reviewer
    // retypes an address that is already recorded on the draft, which is both a
    // wasted step and a way to send to the wrong person.
    //
    // ⚠ OPT-OUT AND LIVENESS COME WITH IT. Suppression already blocks on both,
    // but that runs against the draft's contact_id — if the reviewer is going
    // to see an address, they should see the same warnings, not a clean-looking
    // field. One lookup, all of it.
    const contactIds = [...new Set(base.map(d => d.contact_id).filter(Boolean))];
    const contacts = new Map<string, Record<string, unknown>>();
    if (contactIds.length) {
      const { data: cs } = await supabase
        .from("pm_crm_contacts")
        .select("id, name, email, role, is_active, opted_out")
        .in("id", contactIds as string[]);
      for (const c of cs ?? []) contacts.set(String(c.id), c);
    }

    const rows = base.map(d => {
      const c = d.contact_id ? contacts.get(String(d.contact_id)) : undefined;
      return {
        ...d,
        contactName:     c ? String(c.name ?? "") : null,
        // Null rather than "" so the client can tell "no contact recorded" from
        // "contact recorded but we have no address for them".
        contactEmail:    c ? (c.email ? String(c.email) : null) : null,
        contactRole:     c ? String(c.role ?? "unknown") : null,
        contactOptedOut: c ? Boolean(c.opted_out) : false,
        contactInactive: c ? !c.is_active : false,
      };
    });

    return NextResponse.json({ drafts: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/**
 * POST — create a draft. Used by generators (Phase 5 onwards) and for testing.
 *
 * Suppression runs here, before the draft reaches the queue, and the full record
 * of which checks ran is stored. "Passed suppression" is meaningless if half the
 * checks could not execute, so a blocked draft is still WRITTEN — with status
 * `rejected` and the reason — rather than silently discarded. A generator that
 * keeps producing blocked drafts is telling you something.
 */
export async function POST(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const customerNsId = String(body.customerNsId ?? "").trim();
  const motion       = String(body.motion ?? "").trim();
  const subject      = String(body.subject ?? "").trim();
  const draftBody    = String(body.body ?? "").trim();
  const rationale    = String(body.rationale ?? "").trim();

  if (!customerNsId || !subject || !draftBody) {
    return NextResponse.json({ error: "customerNsId, subject and body are required" }, { status: 400 });
  }
  if (!MOTIONS.includes(motion as typeof MOTIONS[number])) {
    return NextResponse.json({ error: `motion must be one of ${MOTIONS.join("/")}` }, { status: 400 });
  }
  // Non-negotiable per the spec: the reviewer must be told why this, why now.
  if (!rationale) {
    return NextResponse.json({ error: "rationale is required — the reviewer has to be told why this, why now" }, { status: 400 });
  }

  try {
    const suppression = await runSuppressionChecks({
      customerNsId,
      contactId: (body.contactId as string) ?? null,
      motion, subject, body: draftBody,
    });

    const expiryDays = Number(body.expiryDays ?? 14);
    const { data, error } = await getSupabaseAdmin()
      .from("cs_outreach_drafts")
      .insert({
        customer_ns_id: customerNsId,
        contact_id:     (body.contactId as string) ?? null,
        motion,
        subject,
        body:           draftBody,
        rationale,
        evidence:       (body.evidence as Record<string, unknown>) ?? {},
        attachments:    (body.attachments as unknown[]) ?? [],
        status:         suppression.blocked ? "rejected" : "draft",
        rejection_reason: suppression.blocked ? suppression.reasons.join(" · ") : null,
        suppression_checks: { checks: suppression.checks, blocked: suppression.blocked },
        generated_at:   new Date().toISOString(),
        expires_at:     new Date(Date.now() + expiryDays * 86_400_000).toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ draft: data, suppression });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/**
 * PATCH { id, action, … } — review actions.
 *
 * approve_send · reject · snooze · save_edit
 *
 * An edit retains `original_body` the first time it is changed. The diff between
 * generated and sent is the highest-value training data in the system — it is
 * never overwritten on a second edit, or the original is lost.
 */
export async function PATCH(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;
  const reviewer = gate.session.email;

  let body: { id?: string; action?: string; subject?: string; body?: string;
              to?: string; rejectionReason?: string; snoozeDays?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const id = String(body.id ?? "").trim();
  const action = String(body.action ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  try {
    const { data: draft, error: readErr } = await supabase
      .from("cs_outreach_drafts").select("*").eq("id", id).maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message, hint: SCHEMA_HINT }, { status: 503 });
    if (!draft)  return NextResponse.json({ error: "No draft with that id" }, { status: 404 });

    const now = new Date().toISOString();

    if (action === "save_edit") {
      const patch: Record<string, unknown> = {
        subject: String(body.subject ?? draft.subject),
        body:    String(body.body ?? draft.body),
        status:  "edited",
        reviewed_at: now, reviewed_by: reviewer,
      };
      // Captured once, on the first edit only.
      if (!draft.original_body) patch.original_body = draft.body;

      const { data, error } = await supabase.from("cs_outreach_drafts")
        .update(patch).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 503 });
      return NextResponse.json({ draft: data });
    }

    if (action === "reject") {
      const reason = String(body.rejectionReason ?? "").trim();
      if (!reason) return NextResponse.json({ error: "A rejection needs a reason — it is how generation gets better." }, { status: 400 });
      const { data, error } = await supabase.from("cs_outreach_drafts")
        .update({ status: "rejected", rejection_reason: reason, reviewed_at: now, reviewed_by: reviewer })
        .eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 503 });
      return NextResponse.json({ draft: data });
    }

    if (action === "snooze") {
      const days = Math.max(1, Math.floor(Number(body.snoozeDays ?? 7)));
      const { data, error } = await supabase.from("cs_outreach_drafts")
        .update({ status: "snoozed", snoozed_until: new Date(Date.now() + days * 86_400_000).toISOString(),
                  reviewed_at: now, reviewed_by: reviewer })
        .eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 503 });
      return NextResponse.json({ draft: data });
    }

    if (action === "approve_send") {
      const to = String(body.to ?? "").trim();
      if (!to) return NextResponse.json({ error: "A recipient address is required to send." }, { status: 400 });

      if (draft.status === "sent") {
        return NextResponse.json({ error: "This draft has already been sent." }, { status: 409 });
      }
      if (draft.expires_at && new Date(draft.expires_at).getTime() < Date.now()) {
        return NextResponse.json({
          error: "This draft has expired. Its facts are stale — regenerate rather than send it.",
        }, { status: 409 });
      }

      // Re-run suppression at send time, not only at generation. A draft may
      // have sat in the queue for days, and an escalation or a broken promise
      // since then is exactly when it must not go out.
      const recheck = await runSuppressionChecks({
        customerNsId: draft.customer_ns_id, contactId: draft.contact_id,
        motion: draft.motion, subject: draft.subject, body: draft.body,
      });
      if (recheck.blocked) {
        await supabase.from("cs_outreach_drafts")
          .update({ suppression_checks: { checks: recheck.checks, blocked: true, recheckedAt: now } })
          .eq("id", id);
        return NextResponse.json({
          error: "Blocked by suppression on re-check: " + recheck.reasons.join(" · "),
          suppression: recheck,
        }, { status: 409 });
      }

      const sent = await sendAsUser(reviewer, { to, subject: draft.subject, body: draft.body });
      if (!sent.ok) {
        return NextResponse.json({ error: sent.error, needsReauth: sent.needsReauth }, { status: sent.needsReauth ? 403 : 502 });
      }

      const { data, error } = await supabase.from("cs_outreach_drafts")
        .update({
          status: "sent", sent_at: now, reviewed_at: now, reviewed_by: reviewer,
          evidence: { ...(draft.evidence ?? {}), sentTo: to, messageId: sent.messageId, threadId: sent.threadId },
          suppression_checks: { checks: recheck.checks, blocked: false, recheckedAt: now },
        })
        .eq("id", id).select().single();

      if (error) {
        // The mail is already gone. Say so plainly rather than implying it failed.
        return NextResponse.json({
          ok: true, sent: true, messageId: sent.messageId,
          warning: `Email sent, but the record was not updated: ${error.message}`,
        });
      }
      return NextResponse.json({ draft: data, messageId: sent.messageId });
    }

    return NextResponse.json({ error: "action must be approve_send, reject, snooze or save_edit" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
