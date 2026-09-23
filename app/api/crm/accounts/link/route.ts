import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { localAccountId, isLocalAccountId } from "@/lib/crm-accounts";

export const revalidate = 0;

const HINT = "Run supabase/pm-crm-accounts.sql in the Supabase SQL Editor.";

/**
 * Promote a local account onto its real NetSuite record.
 *
 * POST { localId, customerNsId, customerName? }
 *
 * Re-keys every CRM row from `local:<uuid>` to the NetSuite id and retires the
 * local row. After this the account is an ordinary NetSuite-backed one and
 * everything written against it while it was local comes with it.
 *
 * ⚠ THERE IS NO TRANSACTION ACROSS THESE TABLES. supabase-js cannot open one,
 * so the ordering is the safety mechanism:
 *
 *   1. check for collisions and refuse up front
 *   2. re-key the children (contacts, deals, tasks, activities)
 *   3. mark the local row linked, LAST
 *
 * That makes the whole thing RE-RUNNABLE. A failure partway leaves the account
 * still live and still unlinked, with some children already moved — and a
 * retry simply matches nothing for those and finishes the rest. The alternative
 * ordering (link first) would produce a retired account whose records are still
 * on the old key, which nothing would ever show again.
 *
 * The count of rows actually moved is returned per table, because "it worked"
 * and "it matched nothing" must be distinguishable by the person who ran it.
 */

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { email: session.user.email };
}

export async function POST(req: Request) {
  const gate = await requireSession();
  if (gate.response) return gate.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const localId      = String(body.localId ?? "").trim();
  const customerNsId = String(body.customerNsId ?? "").trim();
  const customerName = String(body.customerName ?? "").trim() || null;

  if (!localId || !customerNsId) {
    return NextResponse.json({ error: "localId and customerNsId are required" }, { status: 400 });
  }
  // Linking one local account to another would just move the problem.
  if (isLocalAccountId(customerNsId)) {
    return NextResponse.json({
      error: "Pick a real NetSuite account to link to, not another local one.",
    }, { status: 400 });
  }

  const fromKey = localAccountId(localId);
  const supabase = getSupabaseAdmin();

  try {
    const { data: local, error: lErr } = await supabase.from("pm_crm_accounts")
      .select("*").eq("id", localId).maybeSingle();
    if (lErr)   return NextResponse.json({ error: lErr.message, hint: HINT }, { status: 503 });
    if (!local) return NextResponse.json({ error: "No local account with that id" }, { status: 404 });
    if (local.linked_ns_id) {
      return NextResponse.json({
        error: `Already linked to NetSuite customer ${local.linked_ns_id}.`,
      }, { status: 409 });
    }

    // ── Collision check, before anything moves ────────────────────────────
    // pm_crm_contacts is unique on (customer_ns_id, lower(email)). If the
    // NetSuite account already holds one of these email addresses the re-key
    // fails partway through, so it is checked first and refused whole. Telling
    // someone which person clashes is actionable; a half-migrated account is
    // not.
    const [{ data: mine }, { data: theirs }] = await Promise.all([
      supabase.from("pm_crm_contacts").select("id, name, email").eq("customer_ns_id", fromKey),
      supabase.from("pm_crm_contacts").select("id, name, email").eq("customer_ns_id", customerNsId),
    ]);
    const theirEmails = new Set(
      (theirs ?? []).map(c => c.email?.toLowerCase()).filter(Boolean) as string[]);
    const clashes = (mine ?? [])
      .filter(c => c.email && theirEmails.has(c.email.toLowerCase()))
      .map(c => `${c.name} <${c.email}>`);
    if (clashes.length) {
      return NextResponse.json({
        error: `The NetSuite account already has ${clashes.length === 1 ? "this contact" : "these contacts"}: ${clashes.join(", ")}. `
             + "Remove the duplicate from one side, then link again.",
      }, { status: 409 });
    }

    // ── Re-key the children ───────────────────────────────────────────────
    const moved: Record<string, number> = {};
    for (const table of ["pm_crm_contacts", "pm_crm_opportunities", "pm_crm_tasks", "pm_crm_activities"]) {
      const patch: Record<string, unknown> = { customer_ns_id: customerNsId };
      // Deals carry a denormalised name for the board.
      if (table === "pm_crm_opportunities" && customerName) patch.customer_name = customerName;

      const { data, error } = await supabase.from(table)
        .update(patch).eq("customer_ns_id", fromKey).select("id");
      if (error) {
        return NextResponse.json({
          error: `Moving ${table} failed: ${error.message}. Nothing has been linked — `
               + "the local account is untouched and it is safe to try again.",
          moved,
        }, { status: 503 });
      }
      moved[table.replace("pm_crm_", "")] = data?.length ?? 0;
    }

    // ── Retire the local row, last ────────────────────────────────────────
    const { error: fErr } = await supabase.from("pm_crm_accounts").update({
      linked_ns_id: customerNsId,
      linked_at:    new Date().toISOString(),
      linked_by:    gate.email,
    }).eq("id", localId);
    if (fErr) {
      return NextResponse.json({
        error: `Records moved to ${customerNsId}, but the local account could not be retired: `
             + `${fErr.message}. Run the link again — it will finish the job.`,
        moved,
      }, { status: 503 });
    }

    return NextResponse.json({ ok: true, customerNsId, moved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
