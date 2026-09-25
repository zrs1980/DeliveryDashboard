import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

const HINT = "Run supabase/crm-schema.sql then supabase/pm-crm-rename.sql in the Supabase SQL Editor.";
const ROLES = ["economic_buyer", "champion", "admin", "end_user", "technical", "unknown"] as const;

/**
 * Contacts, stored in cs_contacts.
 *
 * GET   ?customerNsId= | ?q= | ?role=
 * POST  create one here (source 'manual', never touched by the sync)
 * PATCH update — including `role`, which is the field worth filling in
 *
 * ⚠ ROLE IS APP-OWNED AND MOSTLY EMPTY ON PURPOSE. NetSuite's own
 * `contact.contactrole` is set on 26 of 1,014 contacts and its values are
 * built-in negative ids whose labels cannot be resolved through SuiteQL at
 * all, so nothing was imported. Somebody marking the economic buyer and the
 * champion by hand is what makes this column worth having — a departing
 * champion is one of the strongest churn signals available, and it is
 * invisible without it.
 */

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { email: session.user.email };
}

export async function GET(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const customerNsId = url.searchParams.get("customerNsId");
  const q            = url.searchParams.get("q");
  const role         = url.searchParams.get("role");

  try {
    let query = getSupabaseAdmin().from("pm_crm_contacts").select("*").eq("is_active", true);
    if (customerNsId) query = query.eq("customer_ns_id", customerNsId);
    if (role)         query = query.eq("role", role);
    if (q)            query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,job_title.ilike.%${q}%`);

    const { data, error } = await query
      // Primary first, then anyone whose role has been set, then alphabetical —
      // an unsorted contact list on an account with 108 of them is unusable.
      .order("is_primary", { ascending: false })
      .order("name", { ascending: true })
      .limit(1000);

    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    return NextResponse.json({ contacts: data ?? [], roles: ROLES });
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

  const customerNsId = String(body.customerNsId ?? "").trim();
  const first = String(body.firstName ?? "").trim();
  const last  = String(body.lastName ?? "").trim();
  const name  = String(body.name ?? "").trim() || [first, last].filter(Boolean).join(" ");
  if (!customerNsId || !name) {
    return NextResponse.json({ error: "customerNsId and a name are required" }, { status: 400 });
  }

  const role = ROLES.includes(body.role as typeof ROLES[number]) ? String(body.role) : "unknown";

  try {
    const { data, error } = await getSupabaseAdmin().from("pm_crm_contacts").insert({
      customer_ns_id: customerNsId,
      name, first_name: first || null, last_name: last || null,
      email:      String(body.email ?? "").trim().toLowerCase() || null,
      job_title:  String(body.jobTitle ?? "").trim() || null,
      phone:      String(body.phone ?? "").trim() || null,
      mobile:     String(body.mobile ?? "").trim() || null,
      role,
      is_primary: Boolean(body.isPrimary),
      is_active:  true,
      notes:      String(body.notes ?? "").trim() || null,
      owner_email: gate.email,
      first_seen_at: new Date().toISOString(),
      source: "manual",
    }).select().single();

    if (error) {
      // The unique index is on (customer_ns_id, lower(email)) — a duplicate is
      // a real answer, not a failure.
      if (/duplicate key/i.test(error.message)) {
        return NextResponse.json({
          error: "A contact with that email already exists on this account.",
        }, { status: 409 });
      }
      return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    }
    return NextResponse.json({ contact: data });
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

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.email === "string")    patch.email = body.email.trim().toLowerCase() || null;
  if (typeof body.jobTitle === "string") patch.job_title = body.jobTitle.trim() || null;
  if (typeof body.phone === "string")    patch.phone = body.phone.trim() || null;
  if (typeof body.mobile === "string")   patch.mobile = body.mobile.trim() || null;
  if (typeof body.notes === "string")    patch.notes = body.notes.trim() || null;
  if (body.isPrimary !== undefined)      patch.is_primary = Boolean(body.isPrimary);
  if (ROLES.includes(body.role as typeof ROLES[number])) {
    patch.role = String(body.role);
    // Setting a role by hand answers the question the suggestion was asking, so
    // the suggestion goes. Leaving it would show a stale proposal next to a
    // decision that has already been made.
    patch.suggested_role = null;
    patch.suggested_role_reason = null;
    patch.suggested_at = null;
  }

  // ── Suggested roles ──────────────────────────────────────────────────────
  // Accepting is the ONLY path from `suggested_role` to `role`. The suggester
  // never writes `role`, because `role` is what authorises emailing someone and
  // a guess must not be able to grant that.
  if (body.acceptSuggestion === true) {
    const { data: existing } = await getSupabaseAdmin()
      .from("pm_crm_contacts").select("suggested_role").eq("id", id).maybeSingle();
    const suggested = String(existing?.suggested_role ?? "");
    if (!ROLES.includes(suggested as typeof ROLES[number])) {
      return NextResponse.json({ error: "There is no suggestion to accept." }, { status: 409 });
    }
    patch.role = suggested;
    patch.suggested_role = null;
    patch.suggested_role_reason = null;
    patch.suggested_at = null;
  }

  // Rejecting clears the suggestion and leaves `role` alone. The contact stays
  // unusable for outreach, which is the right outcome for "that guess is wrong
  // and I don't know the answer".
  if (body.rejectSuggestion === true) {
    patch.suggested_role = null;
    patch.suggested_role_reason = null;
    patch.suggested_at = null;
  }

  // ── Opt-out ──────────────────────────────────────────────────────────────
  // Permanent per 04-DRAFT-QUEUE.md, and per-person rather than per-account:
  // one contact asking to be left alone must not mute their colleagues.
  if (body.optedOut !== undefined) {
    patch.opted_out = Boolean(body.optedOut);
    patch.opted_out_at = body.optedOut ? new Date().toISOString() : null;
    patch.opt_out_reason = body.optedOut
      ? (String(body.optOutReason ?? "").trim() || "Recorded by hand.")
      : null;
  }

  // Marking someone inactive is how a departure gets recorded, and it is what
  // the champion-lost rule reads.
  if (body.isActive !== undefined) {
    patch.is_active = Boolean(body.isActive);
    if (!body.isActive) patch.departed_detected_at = new Date().toISOString();
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("pm_crm_contacts").update(patch).eq("id", id).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    if (!data)  return NextResponse.json({ error: "No contact with that id" }, { status: 404 });

    return NextResponse.json({ contact: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
