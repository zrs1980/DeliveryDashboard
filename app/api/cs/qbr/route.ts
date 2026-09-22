import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSuiteQLAll } from "@/lib/netsuite";
import { fetchCustomerProjectIndex } from "@/lib/cs-customers";
import { fetchNsContracts, currentContractByCustomer } from "@/lib/cs-ns-contracts";
import { LEAVE_PROJECT_IDS } from "@/lib/constants";
import {
  qbrTier, TIER_MONTHS, GOALS_UNAVAILABLE_NOTE, validateNextSteps,
  type QbrPack, type ForwardItem,
} from "@/lib/cs-qbr";

export const revalidate  = 0;
export const maxDuration = 300;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";
const DAY = 86_400_000;

/**
 * GET ?customerNsId=&months= — assemble a QBR pack.
 *
 * Returns two separate objects: what the customer sees, and the internal
 * briefing for whoever presents it. They are kept apart at the type level
 * because consultant sentiment must never reach the customer-facing pack, and
 * "remember not to render that field" is not a safeguard.
 *
 * docs/06-QBR-PACK.md calls the internal briefing "arguably more valuable than
 * the pack — what a good CSM would have in their head walking into the room."
 */
export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const customerNsId = String(url.searchParams.get("customerNsId") ?? "").trim();
  if (!customerNsId) return NextResponse.json({ error: "customerNsId is required" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  try {
    const [
      { data: profile }, nsContracts, { data: overlays }, { data: sentiment },
      { data: flags }, { data: snap }, { data: commitments }, { data: matches },
    ] = await Promise.all([
      supabase.from("cs_customer_profiles").select("*").eq("customer_ns_id", customerNsId).maybeSingle(),
      fetchNsContracts().catch(() => [] as Awaited<ReturnType<typeof fetchNsContracts>>),
      // Contracts are NetSuite's (CUSTOMRECORD_CONTRACTS); cs_contracts holds
      // only the notice-period overlay. Reading the local table here left the
      // briefing's contract position empty and defaulted every account to
      // annual cadence — the same miss as the triage route.
      supabase.from("cs_contracts").select("source, notice_period_days"),
      supabase.from("cs_consultant_sentiment").select("*").eq("customer_ns_id", customerNsId)
        .order("captured_at", { ascending: false }).limit(20),
      supabase.from("cs_health_flags").select("*").eq("customer_ns_id", customerNsId).in("status", ["open", "acknowledged"]),
      supabase.from("cs_health_snapshots").select("score, band, delta").eq("customer_ns_id", customerNsId)
        .order("computed_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("cs_commitments").select("*").eq("customer_ns_id", customerNsId).eq("status", "open"),
      supabase.from("cs_release_matches").select("*").eq("customer_ns_id", customerNsId)
        .eq("included_in_pdf", true).order("relevance_score", { ascending: false }).limit(6),
    ]);

    if (!profile) {
      return NextResponse.json({
        error: "No profile for this customer. The forward-look section is the commercial half of the pack and it has nothing to draw on without one.",
      }, { status: 422 });
    }

    // The governing contract, so a term already superseded by its renewal is
    // not presented as current.
    const contract = currentContractByCustomer(nsContracts)[customerNsId] ?? null;
    const noticePeriodDays = contract
      ? ((overlays ?? []).find(o => o.source === `netsuite:${contract.nsContractId}`)?.notice_period_days ?? 0)
      : 0;

    const endMs = contract?.endDate ? new Date(`${contract.endDate}T00:00:00`).getTime() : NaN;
    const noticeDays  = Number.isNaN(endMs) ? null : Math.round((endMs - noticePeriodDays * DAY - Date.now()) / DAY);
    const renewalDays = Number.isNaN(endMs) ? null : Math.round((endMs - Date.now()) / DAY);

    const tier = qbrTier(contract?.annualValue ?? null, noticeDays !== null && noticeDays <= 180);
    const months = Number(url.searchParams.get("months")) || TIER_MONTHS[tier];

    // ── Period delivery, from NetSuite ───────────────────────────────────────
    const index = await fetchCustomerProjectIndex();
    const jobIds = (index.byCustomer[customerNsId] ?? []).map(Number).filter(n => Number.isFinite(n));
    const workJobIds = jobIds.filter(id => !LEAVE_PROJECT_IDS.has(String(id)));

    let hoursConsumed = 0;
    const projectsDelivered: Array<{ name: string; entityid: string }> = [];

    if (workJobIds.length) {
      const [hourRows, projRows] = await Promise.all([
        runSuiteQLAll<{ hours: string }>(`
          SELECT SUM(tb.hours) AS hours FROM timebill tb
          WHERE tb.customer IN (${workJobIds.join(",")})
            AND tb.timetype = 'A'
            AND tb.trandate >= ADD_MONTHS(SYSDATE, -${months})
        `),
        runSuiteQLAll<{ entityid: string; companyname: string; entitystatus: string }>(`
          SELECT entityid, companyname, entitystatus FROM job
          WHERE id IN (${workJobIds.join(",")})
        `),
      ]);
      hoursConsumed = Math.round((parseFloat(hourRows?.[0]?.hours ?? "0") || 0) * 10) / 10;
      for (const p of projRows ?? []) {
        projectsDelivered.push({ name: p.companyname ?? "", entityid: p.entityid ?? "" });
      }
    }

    // Cases across the window, rolled up through customer AND job ids.
    const caseScope = [Number(customerNsId), ...jobIds].filter(Number.isFinite).join(",");
    const caseRows = caseScope
      ? await runSuiteQLAll<{ status: string | null }>(`
          SELECT BUILTIN.DF(sc.status) AS status FROM supportcase sc
          WHERE sc.company IN (${caseScope})
            AND sc.createddate >= ADD_MONTHS(SYSDATE, -${months})
        `)
      : [];
    const casesRaised = caseRows.length;
    const casesResolved = caseRows.filter(c => /closed|resolved|complete/i.test(c.status ?? "")).length;

    // ── Forward look — where the commercial content sits ─────────────────────
    // Framed as their problem first, capability second. The spec: not "Loop ERP
    // offers automated reconciliation" but "the month-end reconciliation your
    // team described takes two days — here is what removes it."
    const forwardLook: ForwardItem[] = [];
    for (const m of matches ?? []) {
      forwardLook.push({ title: "Upcoming release item", reasoning: m.reasoning, source: "release_match" });
    }
    for (const mp of (profile.manual_processes ?? []).slice(0, 3) as Array<{ description: string }>) {
      forwardLook.push({
        title: "Still done by hand",
        reasoning: mp.description,
        source: "manual_process",
      });
    }
    for (const eq of (profile.features_enquired_not_purchased ?? []).slice(0, 2) as Array<{ description: string }>) {
      forwardLook.push({ title: "Asked about previously", reasoning: eq.description, source: "prior_enquiry" });
    }

    const nextSteps = [
      // At least one that costs nothing — see validateNextSteps.
      "A config review session on the areas raised most often in support this period.",
      ...forwardLook.slice(0, 2).map(f => `Scope out ${f.reasoning.slice(0, 80)}…`),
    ];
    const stepCheck = validateNextSteps(nextSteps);

    const pack: QbrPack = {
      tier,
      customerFacing: {
        customerName: profile.customer_name,
        periodLabel: `Last ${months} months`,
        summary: {
          projectsDelivered,
          hoursConsumed,
          casesRaised,
          casesResolved,
          goLives: [],
        },
        // No structured kickoff goals exist anywhere in the account, so this is
        // reported as a gap rather than filled with generated prose.
        outcomes: [],
        goalsUnavailable: true,
        supportNarrative:
          casesRaised === 0
            ? "No support cases were raised in this period."
            : `${casesRaised} case${casesRaised === 1 ? "" : "s"} raised, ${casesResolved} closed.`,
        forwardLook,
        nextSteps,
      },
      internal: {
        healthScore: snap?.score ?? null,
        healthBand:  snap?.band ?? null,
        scoreDelta:  snap?.delta ?? null,
        openFlags: (flags ?? []).map(f => ({ title: f.title, reason: f.reason, severity: f.severity })),
        // Internal only. Never rendered into the customer pack.
        sentiment: (sentiment ?? []).map(s => ({
          rating: s.rating, note: s.note, consultant: s.consultant_name ?? "—", capturedAt: s.captured_at,
        })),
        contractPosition: contract ? {
          product: contract.contractType ?? "NetSuite", endDate: contract.endDate,
          daysToRenewal: renewalDays, daysToNotice: noticeDays,
          annualValue: contract.annualValue, autoRenew: true,
        } : null,
        openCommitments: (commitments ?? []).map(c => ({
          direction: c.direction, description: c.description, dueDate: c.due_date,
          overdue: Boolean(c.due_date && c.due_date < new Date().toISOString().slice(0, 10)),
        })),
        declinedItems: ((profile.declined_items ?? []) as Array<{ description: string }>).map(d => d.description),
        talkingPoints: forwardLook.slice(0, 3).map(f => f.reasoning),
        avoid: ((profile.declined_items ?? []) as Array<{ description: string }>).map(d => `Do not raise: ${d.description}`),
      },
    };

    return NextResponse.json({
      pack,
      warnings: [
        ...(stepCheck.ok ? [] : [stepCheck.warning!]),
        ...(pack.customerFacing.goalsUnavailable ? [GOALS_UNAVAILABLE_NOTE] : []),
        ...(contract ? [] : ["No contract recorded, so the cadence defaulted to annual and the renewal section is empty."]),
        ...(pack.internal.sentiment.length === 0 ? ["No consultant sentiment recorded for this account yet."] : []),
      ],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error", hint: SCHEMA_HINT }, { status: 500 });
  }
}
