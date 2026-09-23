import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { localAccountId } from "@/lib/crm-accounts";

export const revalidate = 0;

const HINT = "Run supabase/pm-crm-accounts.sql in the Supabase SQL Editor.";

/**
 * Local accounts — prospects NetSuite has never heard of.
 *
 * GET    the live ones (linked rows are retired and excluded)
 * POST   create one
 * PATCH  edit one
 *
 * ⚠ NETSUITE REMAINS THE CUSTOMER MASTER. These are a holding pen so a deal can
 * start on day one, not a second master. Every one is marked LOCAL in the UI
 * and the intended end state is being linked — see accounts/link.
 *
 * The `customer_ns_id` these expose is the synthetic `local:<uuid>`, which is
 * what contacts, deals, tasks and activities key on. See lib/crm-accounts.ts.
 */

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { email: session.user.email };
}

/** The shape CrmView merges into the NetSuite account list. */
function toRow(a: Record<string, unknown>) {
  return {
    id:                 localAccountId(String(a.id)),
    localId:            String(a.id),
    isLocal:            true as const,
    companyname:        a.name,
    entityid:           null,
    subsidiaryId:       a.subsidiary_id ?? null,
    subsidiaryName:     a.subsidiary_id === 2 ? "Loop ERP" : a.subsidiary_id === 1 ? "Parent Company" : null,
    inBothSubsidiaries: false,
    stage:              a.stage,
    entitystatusLabel:  "Not in NetSuite",
    industry:           a.industry ?? null,
    // Named to match CsCustomer so the account page reads one shape, not two.
    billingAddress:     a.address ?? null,
    shippingAddress:    null,
    website:            a.website ?? null,
    email:              a.email ?? null,
    phone:              a.phone ?? null,
    domain:             a.domain ?? null,
    notes:              a.notes ?? null,
    ownerEmail:         a.owner_email ?? null,
  };
}

export async function GET() {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("pm_crm_accounts").select("*")
      .is("linked_ns_id", null)          // linked rows are retired
      .order("name");
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    return NextResponse.json({ accounts: (data ?? []).map(toRow) });
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

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "A company name is required" }, { status: 400 });

  const stage = ["PROSPECT", "LEAD"].includes(String(body.stage)) ? String(body.stage) : "PROSPECT";
  const subRaw = Number(body.subsidiaryId);
  const subsidiaryId = [1, 2].includes(subRaw) ? subRaw : null;

  try {
    const supabase = getSupabaseAdmin();

    // A local account duplicating a NetSuite one is the failure mode worth
    // guarding: the work then splits across two records and neither is
    // complete. The name check is advisory — it refuses an exact match and
    // leaves near-misses to the person, who can see the list.
    const { data: existing } = await supabase.from("pm_crm_accounts")
      .select("id, name").is("linked_ns_id", null).ilike("name", name).maybeSingle();
    if (existing) {
      return NextResponse.json({
        error: `A local account called "${existing.name}" already exists.`,
      }, { status: 409 });
    }

    const { data, error } = await supabase.from("pm_crm_accounts").insert({
      name,
      domain:        String(body.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null,
      website:       String(body.website ?? "").trim() || null,
      phone:         String(body.phone ?? "").trim() || null,
      email:         String(body.email ?? "").trim().toLowerCase() || null,
      address:       String(body.address ?? "").trim() || null,
      industry:      String(body.industry ?? "").trim() || null,
      subsidiary_id: subsidiaryId,
      stage,
      notes:         String(body.notes ?? "").trim() || null,
      owner_email:   gate.email,
      created_by:    gate.email,
    }).select().single();

    if (error) {
      if (/duplicate key/i.test(error.message)) {
        return NextResponse.json({ error: `"${name}" already exists as a local account.` }, { status: 409 });
      }
      return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    }
    return NextResponse.json({ account: toRow(data) });
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

  const id = String(body.localId ?? body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "localId is required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.domain === "string")   patch.domain = body.domain.trim().toLowerCase() || null;
  if (typeof body.website === "string")  patch.website = body.website.trim() || null;
  if (typeof body.phone === "string")    patch.phone = body.phone.trim() || null;
  if (typeof body.email === "string")    patch.email = body.email.trim().toLowerCase() || null;
  if (typeof body.address === "string")  patch.address = body.address.trim() || null;
  if (typeof body.industry === "string") patch.industry = body.industry.trim() || null;
  if (typeof body.notes === "string")    patch.notes = body.notes.trim() || null;
  if (["PROSPECT", "LEAD"].includes(String(body.stage))) patch.stage = String(body.stage);
  if (body.subsidiaryId !== undefined) {
    const n = Number(body.subsidiaryId);
    patch.subsidiary_id = [1, 2].includes(n) ? n : null;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // A linked account is retired and NetSuite owns it. Editing it here would
    // write to a row nothing reads, which reads to the user as the edit being
    // lost.
    const { data: row } = await supabase.from("pm_crm_accounts")
      .select("linked_ns_id").eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ error: "No local account with that id" }, { status: 404 });
    if (row.linked_ns_id) {
      return NextResponse.json({
        error: "This account is linked to NetSuite. Edit it there.",
      }, { status: 409 });
    }

    // The denormalised customer_name on deals has to follow a rename, or the
    // board keeps showing the old one.
    const { data, error } = await supabase.from("pm_crm_accounts")
      .update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });

    if (patch.name) {
      await supabase.from("pm_crm_opportunities")
        .update({ customer_name: patch.name })
        .eq("customer_ns_id", localAccountId(id));
    }
    return NextResponse.json({ account: toRow(data) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
