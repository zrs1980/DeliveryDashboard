import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendAsUser } from "@/lib/gmail-send";

export const revalidate = 0;

const HINT = "Run supabase/crm-schema.sql then supabase/pm-crm-rename.sql in the Supabase SQL Editor.";
const KINDS = ["email", "note", "call", "meeting"] as const;

/**
 * The activity timeline, and sending email from it.
 *
 * GET   ?customerNsId= | ?contactId= | ?opportunityId=
 * POST  log a note, call or meeting — or send an email and log it
 *
 * ─── How email works here ─────────────────────────────────────────────────
 *
 * HISTORY comes from NetSuite's `message` table: 4,548 emails, 4,310 linked to
 * a customer, seeded by the CRM sync. It costs no OAuth scope.
 *
 * OUTBOUND is sent through the signed-in user's own Gmail token and logged at
 * the moment it succeeds, so the timeline stays current.
 *
 * ⚠ INBOUND REPLIES ARE NOT PICKED UP. Reading Gmail needs `gmail.readonly`,
 * which this app does not request — adding it invalidates every session and
 * forces everyone to sign in again. So a reply appears here only once it is
 * logged in NetSuite and the next sync runs. Worth knowing before treating
 * this as a complete thread view.
 *
 * ⚠ NetSuite's history hangs off the CUSTOMER, not the contact — 4,310 against
 * 9 — so a contact-scoped query returns only what this app recorded itself.
 */

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { email: session.user.email, name: session.user.name ?? null };
}

export async function GET(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const customerNsId  = url.searchParams.get("customerNsId");
  const contactId     = url.searchParams.get("contactId");
  const opportunityId = url.searchParams.get("opportunityId");

  if (!customerNsId && !contactId && !opportunityId) {
    return NextResponse.json({ error: "Scope the timeline to a customer, contact or opportunity" }, { status: 400 });
  }

  try {
    let q = getSupabaseAdmin().from("pm_crm_activities").select("*");
    if (customerNsId)  q = q.eq("customer_ns_id", customerNsId);
    if (contactId)     q = q.eq("contact_id", contactId);
    if (opportunityId) q = q.eq("opportunity_id", opportunityId);

    const { data, error } = await q.order("occurred_at", { ascending: false }).limit(300);
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });

    const activities = data ?? [];
    return NextResponse.json({
      activities,
      counts: {
        total: activities.length,
        email: activities.filter(a => a.kind === "email").length,
        fromNetSuite: activities.filter(a => a.source === "netsuite").length,
      },
      // Stated on every response rather than documented somewhere nobody reads.
      note: contactId
        ? "NetSuite files email against the customer, not the contact, so a contact timeline shows only what this app recorded."
        : undefined,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const kind = KINDS.includes(body.kind as typeof KINDS[number]) ? String(body.kind) : "note";
  const customerNsId  = body.customerNsId ? String(body.customerNsId) : null;
  const contactId     = body.contactId ? String(body.contactId) : null;
  const opportunityId = body.opportunityId ? String(body.opportunityId) : null;

  if (!customerNsId && !contactId && !opportunityId) {
    return NextResponse.json({ error: "Attach the activity to a customer, contact or opportunity" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const subject = String(body.subject ?? "").trim();
  const bodyText = String(body.body ?? "").trim();

  try {
    // ── Sending ────────────────────────────────────────────────────────────
    let sentMessageId: string | undefined;
    if (kind === "email" && body.send) {
      const to = String(body.to ?? "").trim();
      if (!to)      return NextResponse.json({ error: "A recipient is required to send" }, { status: 400 });
      if (!subject) return NextResponse.json({ error: "A subject is required to send" }, { status: 400 });
      if (!bodyText) return NextResponse.json({ error: "An empty email is not worth sending" }, { status: 400 });

      const sent = await sendAsUser(gate.email, { to, subject, body: bodyText });
      if (!sent.ok) {
        // Nothing is logged when nothing was sent — a timeline entry for an
        // email that failed is worse than no entry, because it reads as done.
        return NextResponse.json(
          { error: sent.error, needsReauth: sent.needsReauth },
          { status: sent.needsReauth ? 403 : 502 });
      }
      sentMessageId = sent.messageId;
    }

    const { data, error } = await supabase.from("pm_crm_activities").insert({
      customer_ns_id: customerNsId,
      contact_id:     contactId,
      opportunity_id: opportunityId,
      kind,
      direction: kind === "email"
        ? (body.send ? "outbound" : String(body.direction ?? "outbound"))
        : "internal",
      subject: subject || (kind === "note" ? "Note" : kind),
      body:    bodyText || null,
      occurred_at: /^\d{4}-\d{2}-\d{2}/.test(String(body.occurredAt ?? ""))
        ? new Date(String(body.occurredAt)).toISOString()
        : new Date().toISOString(),
      actor_email: gate.email,
      actor_name:  gate.name,
      source: "app",
    }).select().single();

    if (error) {
      // If the send succeeded, say so plainly — the mail is gone either way.
      return NextResponse.json({
        error: `${sentMessageId ? "Email sent, but not logged: " : ""}${error.message}`,
        sent: Boolean(sentMessageId), messageId: sentMessageId, hint: HINT,
      }, { status: sentMessageId ? 500 : 503 });
    }

    // Touch the contact's liveness — this is what makes "last seen" mean
    // something, and it feeds the champion-silence rule.
    if (contactId) {
      await supabase.from("pm_crm_contacts")
        .update({ last_seen_at: new Date().toISOString() }).eq("id", contactId);
    }

    return NextResponse.json({ activity: data, sent: Boolean(sentMessageId), messageId: sentMessageId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
