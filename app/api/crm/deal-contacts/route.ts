import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

const HINT = "Run supabase/pm-crm-associations.sql in the Supabase SQL Editor.";

/**
 * Deal ↔ contact associations.
 *
 * GET    ?opportunityId=  — the people on a deal, with their labels
 *        ?contactId=      — the deals a person is on
 * POST   attach a contact to a deal
 * PATCH  change a label, or move the primary flag
 * DELETE detach
 *
 * ⚠ THE LABEL HERE IS NOT `pm_crm_contacts.role`. Role is what someone is to
 * the ACCOUNT and drives the champion-silence signal; the label is what they
 * are to THIS DEAL. A person is regularly the account champion and a blocker on
 * one specific deal. See the header of pm-crm-associations.sql.
 *
 * ⚠ `is_primary` IS MIRRORED ONTO `pm_crm_opportunities.primary_contact_id`.
 * That column predates this table and is what the pipeline card reads, so the
 * two must never disagree. Every write here that touches the primary flag
 * updates both, and the ORDER MATTERS: the partial unique index means a second
 * primary row is rejected outright, so the old one is cleared first.
 */

const LABELS = [
  "decision_maker", "budget_holder", "champion", "influencer",
  "technical", "billing", "blocker", "point_of_contact", "unlabeled",
] as const;

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { email: session.user.email };
}

/** Clears any existing primary on a deal, then records the new one in both places. */
async function setPrimary(opportunityId: string, contactId: string | null) {
  const supabase = getSupabaseAdmin();
  await supabase.from("pm_crm_deal_contacts")
    .update({ is_primary: false })
    .eq("opportunity_id", opportunityId)
    .eq("is_primary", true);
  if (contactId) {
    await supabase.from("pm_crm_deal_contacts")
      .update({ is_primary: true })
      .eq("opportunity_id", opportunityId)
      .eq("contact_id", contactId);
  }
  await supabase.from("pm_crm_opportunities")
    .update({ primary_contact_id: contactId })
    .eq("id", opportunityId);
}

export async function GET(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const opportunityId = url.searchParams.get("opportunityId");
  const contactId     = url.searchParams.get("contactId");
  if (!opportunityId && !contactId) {
    return NextResponse.json({ error: "opportunityId or contactId is required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    let q = supabase.from("pm_crm_deal_contacts").select("*");
    if (opportunityId) q = q.eq("opportunity_id", opportunityId);
    if (contactId)     q = q.eq("contact_id", contactId);
    const { data: links, error } = await q;
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });

    const rows = links ?? [];
    if (rows.length === 0) return NextResponse.json({ links: [], labels: LABELS });

    // One lookup for the other side, rather than a join — the two tables are
    // small and this keeps the shape predictable for both directions.
    const ids = [...new Set(rows.map(r => opportunityId ? r.contact_id : r.opportunity_id))];
    const { data: others } = opportunityId
      ? await supabase.from("pm_crm_contacts")
          .select("id, name, email, job_title, phone, mobile, role, is_active").in("id", ids)
      : await supabase.from("pm_crm_opportunities")
          .select("id, title, stage_name, status, projected_total, expected_close, customer_ns_id, customer_name").in("id", ids);

    const byId = new Map((others ?? []).map(o => [o.id, o]));
    return NextResponse.json({
      links: rows.map(r => ({
        ...r,
        // Deliberately null rather than omitted when the other side is missing:
        // a dangling link is a real state the UI should be able to show.
        contact:     opportunityId ? byId.get(r.contact_id) ?? null : undefined,
        opportunity: contactId     ? byId.get(r.opportunity_id) ?? null : undefined,
      })),
      labels: LABELS,
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

  const opportunityId = String(body.opportunityId ?? "").trim();
  const contactId     = String(body.contactId ?? "").trim();
  if (!opportunityId || !contactId) {
    return NextResponse.json({ error: "opportunityId and contactId are required" }, { status: 400 });
  }
  const label = LABELS.includes(body.label as typeof LABELS[number])
    ? String(body.label) : "unlabeled";

  try {
    const supabase = getSupabaseAdmin();

    // A contact belongs to an account; a deal belongs to an account. Attaching
    // across accounts is always a mistake, and one that would put a customer's
    // name on another customer's deal — so it is refused rather than warned
    // about.
    const [{ data: opp }, { data: contact }] = await Promise.all([
      supabase.from("pm_crm_opportunities").select("id, customer_ns_id").eq("id", opportunityId).maybeSingle(),
      supabase.from("pm_crm_contacts").select("id, customer_ns_id, name").eq("id", contactId).maybeSingle(),
    ]);
    if (!opp)     return NextResponse.json({ error: "No deal with that id" }, { status: 404 });
    if (!contact) return NextResponse.json({ error: "No contact with that id" }, { status: 404 });
    if (opp.customer_ns_id !== contact.customer_ns_id) {
      return NextResponse.json({
        error: `${contact.name} belongs to a different account than this deal.`,
      }, { status: 409 });
    }

    const wantPrimary = Boolean(body.isPrimary);
    const { error } = await supabase.from("pm_crm_deal_contacts").insert({
      opportunity_id: opportunityId,
      contact_id:     contactId,
      label,
      is_primary:     false,   // set below, so the old primary clears first
      created_by:     gate.email,
    });
    if (error) {
      if (/duplicate key/i.test(error.message)) {
        return NextResponse.json({ error: `${contact.name} is already on this deal.` }, { status: 409 });
      }
      return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    }

    if (wantPrimary) await setPrimary(opportunityId, contactId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const opportunityId = String(body.opportunityId ?? "").trim();
  const contactId     = String(body.contactId ?? "").trim();
  if (!opportunityId || !contactId) {
    return NextResponse.json({ error: "opportunityId and contactId are required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    if (typeof body.label === "string") {
      if (!LABELS.includes(body.label as typeof LABELS[number])) {
        return NextResponse.json({ error: `Unknown label "${body.label}"` }, { status: 400 });
      }
      const { error } = await supabase.from("pm_crm_deal_contacts")
        .update({ label: body.label })
        .eq("opportunity_id", opportunityId).eq("contact_id", contactId);
      if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    }

    if (body.isPrimary !== undefined) {
      await setPrimary(opportunityId, body.isPrimary ? contactId : null);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const opportunityId = url.searchParams.get("opportunityId") ?? "";
  const contactId     = url.searchParams.get("contactId") ?? "";
  if (!opportunityId || !contactId) {
    return NextResponse.json({ error: "opportunityId and contactId are required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: link } = await supabase.from("pm_crm_deal_contacts")
      .select("is_primary").eq("opportunity_id", opportunityId).eq("contact_id", contactId).maybeSingle();

    const { error } = await supabase.from("pm_crm_deal_contacts")
      .delete().eq("opportunity_id", opportunityId).eq("contact_id", contactId);
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });

    // Detaching the primary must clear the mirrored column too, or the deal
    // keeps pointing at someone who is no longer on it.
    if (link?.is_primary) {
      await supabase.from("pm_crm_opportunities")
        .update({ primary_contact_id: null }).eq("id", opportunityId);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
