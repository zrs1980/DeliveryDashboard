import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchNsContracts, nsContractUrl, type NsContract } from "@/lib/cs-ns-contracts";
import { renewalClock, renewalSummary } from "@/lib/cs-contracts";
import { isLocalAccountId } from "@/lib/crm-accounts";

export const revalidate = 0;

/**
 * Contracts and the renewal clock, for the CRM account page.
 *
 * GET ?customerNsId=   — every contract on that account, live from NetSuite
 * GET                  — every contract, for a portfolio view
 *
 * ⚠ SESSION-GATED, NOT `cs_layer`-GATED — and that is a deliberate line, not an
 * oversight. The CS boundary exists to contain JUDGMENTS: health scores, bands,
 * churn flags, "which customers we think we are losing". A contract's dates,
 * term, value and notice deadline are FACTS a PM or account manager needs to do
 * ordinary commercial work, and CLAUDE.md already draws that line for the
 * Renewals view: a notice deadline is a hard fact requiring action, not an
 * inference about health.
 *
 * What is therefore withheld here, and must stay withheld: `cs_contracts.notes`
 * is CS-authored commentary about the relationship, so this route reads the
 * overlay for `notice_period_days` ONLY. Never widen that select to `*`.
 *
 * ⚠ CONTRACTS ARE READ FROM NETSUITE AND ARE NOT EDITABLE HERE. The Contract
 * Renewals SuiteApp record is the master; a second copy would drift from the
 * renewal process the business actually runs on. The page links out instead.
 */

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const customerNsId = new URL(req.url).searchParams.get("customerNsId");

  // A local prospect has no NetSuite record, so it can hold no NetSuite
  // contract. Answering directly avoids a pointless SuiteQL round trip and,
  // more importantly, avoids an empty result that reads as "no contracts found"
  // when the truth is "this account does not exist in NetSuite yet".
  if (customerNsId && isLocalAccountId(customerNsId)) {
    return NextResponse.json({
      contracts: [], notLinked: true,
      note: "This is a local prospect. Contracts appear once it is linked to a NetSuite account.",
    });
  }

  try {
    // The overlay carries the notice period, which NetSuite genuinely does not
    // hold — see below. A failed read must not silently drop everyone's notice
    // period and quietly reset every countdown to the end date, so it is
    // reported rather than swallowed.
    const [nsContracts, overlayRes] = await Promise.all([
      fetchNsContracts(),
      getSupabaseAdmin().from("cs_contracts").select("source, notice_period_days"),
    ]);

    const noticeBySource = new Map<string, number | null>();
    for (const o of overlayRes.data ?? []) {
      noticeBySource.set(String(o.source), o.notice_period_days ?? null);
    }

    const wanted = customerNsId
      ? nsContracts.filter(c => c.customerNsId === String(customerNsId))
      : nsContracts;

    const contracts = wanted
      .map(c => decorate(c, noticeBySource.get(`netsuite:${c.nsContractId}`) ?? null))
      // Soonest deadline first: the reason to look at this list is what is due.
      .sort((a, b) => (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999"));

    return NextResponse.json({
      contracts,
      noticeOverlayError: overlayRes.error?.message ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}

function decorate(c: NsContract, noticePeriodDays: number | null) {
  const clock = renewalClock(
    { end_date: c.endDate, notice_period_days: noticePeriodDays } as never);

  return {
    ...c,
    netsuiteUrl: nsContractUrl(c.nsContractId),
    noticePeriodDays,
    /**
     * ⚠ NULL notice period means the countdown runs to the END date, and the UI
     * must say so. NetSuite carries no notice period at all:
     * `custrecord_swe_days_b4_renewal` reads 358 on EVERY contract in the
     * account, so it is a SuiteApp setting for when to raise the renewal
     * transaction — not a per-contract term. Using it as one would generate
     * confident, wrong deadlines, which is worse than none.
     */
    noticeIsEstimated: noticePeriodDays === null,
    ...clock,
    /**
     * ⚠ `auto_renew: false` is deliberate, not a default.
     *
     * NsContract carries no auto-renew field because the NetSuite record has
     * none. Passing `true` would make this line read "auto-renews in 340d" — a
     * claim about the contract's TERMS, invented from nothing, and exactly the
     * failure mode `custrecord_swe_days_b4_renewal` already caused once. With
     * `false` the text only ever restates dates we actually hold.
     */
    summary: renewalSummary(
      { end_date: c.endDate, notice_period_days: noticePeriodDays, auto_renew: false } as never),
  };
}
