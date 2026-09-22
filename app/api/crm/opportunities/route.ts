import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

const HINT = "Run supabase/crm-schema.sql then supabase/pm-crm-rename.sql in the Supabase SQL Editor.";

/**
 * The pipeline.
 *
 * GET    ?id=  — ONE deal in full: properties, the people on it, its tasks and
 *                its timeline. This is the record page's only request.
 *        ?open=1 | ?customerNsId= | ?stage=  — board data plus the stage columns
 * POST   create an opportunity
 * PATCH  update one, including moving it between stages
 *
 * ⚠ THE PIPELINE IS APP-OWNED. Nothing syncs from NetSuite any more, in either
 * direction. An edit made here is permanent, and `ns_opportunity_id` on a row
 * imported before the link was removed is PROVENANCE — where it originally came
 * from — not a key anything matches on.
 *
 * Do not reintroduce a sync without saying so: these rows are now hand-curated,
 * and an overwrite would be silent data loss rather than a refresh.
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
  const id           = url.searchParams.get("id");
  const openOnly     = url.searchParams.get("open") === "1";
  const customerNsId = url.searchParams.get("customerNsId");
  const stage        = url.searchParams.get("stage");

  const supabase = getSupabaseAdmin();

  // ── One deal, everything on it ────────────────────────────────────────────
  // Five reads rather than one join. The record page needs all of it at once,
  // and a tab-switch that refetches is the thing that makes a CRM feel slow —
  // so the panel fetches once and holds it.
  if (id) {
    try {
      const { data: deal, error: dErr } = await supabase
        .from("pm_crm_opportunities").select("*").eq("id", id).maybeSingle();
      if (dErr)  return NextResponse.json({ error: dErr.message, hint: HINT }, { status: 503 });
      if (!deal) return NextResponse.json({ error: "No deal with that id" }, { status: 404 });

      const [stagesRes, linksRes, tasksRes, actsRes] = await Promise.all([
        supabase.from("pm_crm_stages").select("*").eq("hidden", false).order("sort_order"),
        supabase.from("pm_crm_deal_contacts").select("*").eq("opportunity_id", id),
        supabase.from("pm_crm_tasks").select("*").eq("opportunity_id", id)
          .order("due_date", { ascending: true, nullsFirst: false }),
        supabase.from("pm_crm_activities").select("*").eq("opportunity_id", id)
          .order("occurred_at", { ascending: false }).limit(100),
      ]);

      const links = linksRes.data ?? [];
      let contacts: Record<string, unknown>[] = [];
      if (links.length) {
        const { data } = await supabase.from("pm_crm_contacts")
          .select("id, name, email, job_title, phone, mobile, role, is_active")
          .in("id", links.map(l => l.contact_id));
        const byId = new Map((data ?? []).map(c => [c.id, c]));
        contacts = links.map(l => ({
          ...l,
          contact: byId.get(l.contact_id) ?? null,
        }));
      }

      // Deal inactivity, derived not stored — a stored "days since" is wrong by
      // one every midnight. Stage changes count as activity: moving a deal is
      // working it.
      const lastActivityAt = actsRes.data?.[0]?.occurred_at ?? null;
      const daysSinceActivity = lastActivityAt
        ? Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86400000)
        : null;

      return NextResponse.json({
        deal,
        stages:     stagesRes.data ?? [],
        contacts,
        tasks:      tasksRes.data ?? [],
        activities: actsRes.data ?? [],
        lastActivityAt,
        daysSinceActivity,
        // A read that failed is reported, never rendered as an empty list —
        // "no contacts on this deal" and "the contacts table is unreachable"
        // must not look the same.
        errors: [
          stagesRes.error && `stages: ${stagesRes.error.message}`,
          linksRes.error  && `contacts: ${linksRes.error.message}`,
          tasksRes.error  && `tasks: ${tasksRes.error.message}`,
          actsRes.error   && `activity: ${actsRes.error.message}`,
        ].filter(Boolean),
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
    }
  }

  try {
    const [{ data: stages, error: sErr }, oppRes] = await Promise.all([
      supabase.from("pm_crm_stages").select("*").eq("hidden", false).order("sort_order"),
      (() => {
        let q = supabase.from("pm_crm_opportunities").select("*");
        // 'A' is in progress; C won and D lost are closed.
        if (openOnly)     q = q.eq("status", "A");
        if (customerNsId) q = q.eq("customer_ns_id", customerNsId);
        if (stage)        q = q.eq("stage_id", stage);
        return q.order("expected_close", { ascending: true, nullsFirst: false }).limit(1000);
      })(),
    ]);

    if (sErr)         return NextResponse.json({ error: sErr.message, hint: HINT }, { status: 503 });
    if (oppRes.error) return NextResponse.json({ error: oppRes.error.message, hint: HINT }, { status: 503 });

    const opportunities = oppRes.data ?? [];

    // Pipeline value is the sum of projected_total on OPEN deals only. Counting
    // won and lost would make the number meaningless and it would only ever go
    // up.
    const open = opportunities.filter(o => o.status === "A");
    const pipelineValue = open.reduce((n, o) => n + (Number(o.projected_total) || 0), 0);
    const weightedValue = open.reduce(
      (n, o) => n + (Number(o.projected_total) || 0) * ((Number(o.probability) || 0) / 100), 0);

    return NextResponse.json({
      stages: stages ?? [],
      opportunities,
      summary: {
        total: opportunities.length,
        open: open.length,
        pipelineValue: Math.round(pipelineValue),
        weightedValue: Math.round(weightedValue),
      },
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

  const customerNsId = String(body.customerNsId ?? "").trim();
  const title        = String(body.title ?? "").trim();
  if (!customerNsId || !title) {
    return NextResponse.json({ error: "customerNsId and title are required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    // Stage name is denormalised so the board renders without a join, but it is
    // read from the stage table rather than trusted from the client.
    let stageName: string | null = null;
    let probability: number | null = null;
    if (body.stageId) {
      const { data: s } = await supabase.from("pm_crm_stages")
        .select("name, probability").eq("id", String(body.stageId)).maybeSingle();
      stageName   = s?.name ?? null;
      probability = s?.probability ?? null;
    }

    const { data, error } = await supabase.from("pm_crm_opportunities").insert({
      customer_ns_id:  customerNsId,
      customer_name:   String(body.customerName ?? "").trim() || null,
      title,
      description:     String(body.description ?? "").trim() || null,
      stage_id:        body.stageId ? String(body.stageId) : null,
      stage_name:      stageName,
      status:          "A",
      opportunity_type: String(body.opportunityType ?? "").trim() || null,
      projected_total: Number.isFinite(Number(body.projectedTotal)) ? Number(body.projectedTotal) : null,
      probability,
      expected_close:  /^\d{4}-\d{2}-\d{2}$/.test(String(body.expectedClose ?? "")) ? String(body.expectedClose) : null,
      owner_name:      gate.email,
      source:          "manual",
    }).select().single();

    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
    return NextResponse.json({ opportunity: data });
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

  const supabase = getSupabaseAdmin();

  try {
    const { data: existing, error: readErr } = await supabase
      .from("pm_crm_opportunities").select("id, ns_opportunity_id, stage_id").eq("id", id).maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message, hint: HINT }, { status: 503 });
    if (!existing) return NextResponse.json({ error: "No opportunity with that id" }, { status: 404 });

    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string")       patch.title = body.title.trim();
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (body.projectedTotal !== undefined)    patch.projected_total = Number(body.projectedTotal) || null;
    if (typeof body.opportunityType === "string") patch.opportunity_type = body.opportunityType.trim() || null;
    if (typeof body.ownerName === "string")   patch.owner_name = body.ownerName.trim() || null;
    if (typeof body.leadSource === "string")  patch.lead_source = body.leadSource.trim() || null;
    // An explicit probability OVERRIDES the stage's. HubSpot allows this and it
    // matters on a long deal: a Proposal Sent that has gone quiet is not still
    // worth its stage's 50%. Setting a stage below re-derives it, so the
    // override is lost on the next move — which is the right default, since a
    // stage move is new information about the deal.
    if (body.probability !== undefined && body.probability !== null) {
      if (body.probability === "") {
        // Cleared means "go back to whatever the stage says", not 0%. A deal at
        // 0% reads as lost, which is a different claim entirely.
        const { data: st } = await supabase.from("pm_crm_stages")
          .select("probability").eq("id", String(existing.stage_id ?? "")).maybeSingle();
        patch.probability = st?.probability ?? null;
      } else {
        const pr = Number(body.probability);
        if (Number.isFinite(pr) && pr >= 0 && pr <= 100) patch.probability = pr;
      }
    }
    if (body.status !== undefined && ["A", "C", "D"].includes(String(body.status))) {
      patch.status = String(body.status);
    }
    // An empty string CLEARS the date rather than being ignored. Skipping it
    // would mean the field springs back on reload with no error shown -- the
    // user cleared it, pressed Save, and was told nothing happened.
    if (typeof body.expectedClose === "string") {
      if (body.expectedClose === "") patch.expected_close = null;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(body.expectedClose)) patch.expected_close = body.expectedClose;
    }

    let stageChanged: { from: string | null; to: string } | null = null;
    if (body.stageId) {
      const { data: s } = await supabase.from("pm_crm_stages")
        .select("name, probability, is_won, is_lost").eq("id", String(body.stageId)).maybeSingle();
      patch.stage_id    = String(body.stageId);
      patch.stage_name  = s?.name ?? null;
      patch.probability = s?.probability ?? null;
      // Moving to a won or lost column closes the deal — otherwise it would sit
      // in "Closed Won" while still counting as open pipeline.
      if (s?.is_won)  patch.status = "C";
      if (s?.is_lost) patch.status = "D";
      if (existing.stage_id !== String(body.stageId)) {
        stageChanged = { from: existing.stage_id, to: String(body.stageId) };
      }
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("pm_crm_opportunities").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });

    // A stage move is the most meaningful thing that happens to a deal, so it
    // goes on the timeline rather than only into updated_at.
    if (stageChanged) {
      await supabase.from("pm_crm_activities").insert({
        customer_ns_id: data.customer_ns_id,
        opportunity_id: id,
        kind: "stage_change",
        direction: "internal",
        subject: `Moved to ${data.stage_name ?? stageChanged.to}`,
        occurred_at: new Date().toISOString(),
        actor_email: gate.email,
        source: "app",
      });
    }

    return NextResponse.json({ opportunity: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
