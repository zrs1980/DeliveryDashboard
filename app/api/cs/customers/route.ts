import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import {
  fetchCsCustomers,
  fetchCustomerProjectIndex,
  fetchCustomerHours,
  fetchCustomerLastActivity,
  daysSince,
} from "@/lib/cs-customers";

export const revalidate  = 0;
export const maxDuration = 60;

/**
 * The customer base as the CS layer sees it: every account, with how much work
 * has actually happened on it and how long it has been silent.
 *
 * This is the first route behind requireCsLayer(), and deliberately so — the
 * permission existed since Phase 0 but had no call site, which meant the
 * boundary was asserted and never exercised. Note the route is double-gated:
 * proxy.ts requires a session for everything except /api/cs/cron, and this adds
 * the cs_layer check on top. Unauthorised callers get JSON, not a login redirect.
 *
 * No scoring here. Hours and silence are facts; turning them into a judgment is
 * Phase 2's job, and it needs contracts first — see the note below.
 */

const ACTIVITY_WINDOW_DAYS = 90;

export async function GET() {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  try {
    // The index is built once and handed to both rollups — each would otherwise
    // re-query every job in the account.
    const index = await fetchCustomerProjectIndex();

    const [customers, hours, lastActivity] = await Promise.all([
      fetchCsCustomers(),
      fetchCustomerHours(ACTIVITY_WINDOW_DAYS, index),
      fetchCustomerLastActivity(index),
    ]);

    const rows = customers.map(c => {
      const key  = String(c.id);
      const last = lastActivity[key] ?? null;
      return {
        customerNsId:      key,
        name:              c.companyname,
        entityid:          c.entityid,
        email:             c.email,
        projectCount:      index.byCustomer[key]?.length ?? 0,
        hoursInWindow:     Math.round((hours[key] ?? 0) * 10) / 10,
        lastActivity:      last,
        daysSinceActivity: daysSince(last),
      };
    });

    // Quietest first — a customer with no recorded time at all sorts above one
    // that merely went quiet, because it is the state least likely to be noticed.
    rows.sort((a, b) => {
      if (a.daysSinceActivity === null && b.daysSinceActivity === null) return 0;
      if (a.daysSinceActivity === null) return -1;
      if (b.daysSinceActivity === null) return 1;
      return b.daysSinceActivity - a.daysSinceActivity;
    });

    // Expect this to be high — 40 of 55 when measured 18 Sep 2026 — because most
    // of those implementations finished successfully. That is why contracts
    // (Phase 3) have to land before the rules engine (Phase 2): nothing here
    // distinguishes "delivered and done" from "going quiet", and flagging all of
    // them on day one would make the triage list useless.
    // A LOW number here means the timetype='A' filter has stopped working and
    // forward-dated allocation rows are being counted as activity.
    const quiet = rows.filter(
      r => r.daysSinceActivity === null || r.daysSinceActivity >= ACTIVITY_WINDOW_DAYS,
    ).length;

    return NextResponse.json({
      windowDays: ACTIVITY_WINDOW_DAYS,
      total:      rows.length,
      quiet,
      customers:  rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
