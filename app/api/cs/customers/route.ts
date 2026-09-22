import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { readCustomerIndex } from "@/lib/cs-customer-index";
import {
  fetchCsCustomers, fetchCustomerProjectIndex, fetchCustomerHours,
  fetchCustomerLastActivity, daysSince,
} from "@/lib/cs-customers";

export const revalidate  = 0;
export const maxDuration = 60;

/**
 * The customer base as the CS layer sees it.
 *
 * Reads `cs_customer_index` — one row per active customer with every source
 * already joined, rebuilt by the nightly run. That is the whole point of the
 * index: this used to be four SuiteQL round trips on every page load.
 *
 * ⚠ FALLS BACK TO LIVE NETSUITE when the index is empty or missing, so the tab
 * keeps working before supabase/cs-customer-index.sql has been run and before
 * the first nightly rebuild. The fallback is the previous implementation, and
 * the response says which path served it — a silently degraded view that looks
 * identical to a fresh one is how stale data gets trusted.
 */

const ACTIVITY_WINDOW_DAYS = 90;

export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const stage        = url.searchParams.get("stage") ?? undefined;
  const subsidiaryId = url.searchParams.get("subsidiary");

  try {
    let indexError: string | null = null;

    try {
      const rows = await readCustomerIndex({
        stage,
        subsidiaryId: subsidiaryId ? Number(subsidiaryId) : undefined,
      });

      if (rows.length) {
        const customers = rows.map(r => ({
          customerNsId:      r.customer_ns_id,
          name:              r.name,
          entityid:          r.entityid ?? "",
          email:             r.email,
          subsidiaryId:      r.subsidiary_id,
          subsidiaryName:    r.subsidiary_name,
          inBothSubsidiaries: r.in_both_subsidiaries,
          stage:             r.stage,
          entitystatusLabel: r.entitystatus_label,
          industry:          r.industry,
          salesrepName:      r.salesrep_name,
          consultantName:    r.consultant_name,
          driveFolderId:     r.drive_folder_id,
          projectCount:      r.project_count,
          activeProjectCount: r.active_project_count,
          hoursInWindow:     r.hours_90d,
          lastActivity:      r.last_activity_date,
          daysSinceActivity: r.days_since_activity,
          openCases:         r.open_cases,
          contractEndDate:   r.contract_end_date,
          noticeDate:        r.notice_date,
          annualValue:       r.annual_value,
          hasProfile:        r.has_profile,
          profileVerified:   r.profile_verified,
          healthScore:       r.health_score,
          healthBand:        r.health_band,
          openFlagCount:     r.open_flag_count,
          lastHealthcheckAt: r.last_healthcheck_at,
          quarterStatus:     r.current_quarter_status,
        }));

        // Quietest first, as before — an account with nothing happening
        // generates no events and would never surface on its own.
        customers.sort((a, b) => {
          if (a.daysSinceActivity === null && b.daysSinceActivity === null) return 0;
          if (a.daysSinceActivity === null) return -1;
          if (b.daysSinceActivity === null) return 1;
          return b.daysSinceActivity - a.daysSinceActivity;
        });

        const quiet = customers.filter(
          c => c.daysSinceActivity === null || c.daysSinceActivity >= ACTIVITY_WINDOW_DAYS,
        ).length;

        return NextResponse.json({
          source: "index",
          refreshedAt: rows[0].refreshed_at,
          windowDays: ACTIVITY_WINDOW_DAYS,
          total: customers.length,
          quiet,
          customers,
        });
      }
      indexError = "The customer index is empty — it is rebuilt by the nightly run.";
    } catch (e) {
      indexError = e instanceof Error ? e.message : "Index unreadable";
    }

    // ── Live fallback ──────────────────────────────────────────────────────
    const index = await fetchCustomerProjectIndex();
    const [all, hours, lastActivity] = await Promise.all([
      fetchCsCustomers(),
      fetchCustomerHours(ACTIVITY_WINDOW_DAYS, index),
      fetchCustomerLastActivity(index),
    ]);

    const filtered = all.filter(c =>
      (!stage || c.stage === stage) &&
      (!subsidiaryId || c.subsidiaryId === Number(subsidiaryId) || c.inBothSubsidiaries));

    const customers = filtered.map(c => {
      const key  = String(c.id);
      const last = lastActivity[key] ?? null;
      return {
        customerNsId: key,
        name: c.companyname,
        entityid: c.entityid,
        email: c.email,
        subsidiaryId: c.subsidiaryId,
        subsidiaryName: c.subsidiaryName,
        inBothSubsidiaries: c.inBothSubsidiaries,
        stage: c.stage,
        entitystatusLabel: c.entitystatusLabel,
        industry: c.industry,
        salesrepName: c.salesrepName,
        consultantName: null,
        driveFolderId: null,
        projectCount: index.byCustomer[key]?.length ?? 0,
        activeProjectCount: null,
        hoursInWindow: Math.round((hours[key] ?? 0) * 10) / 10,
        lastActivity: last,
        daysSinceActivity: daysSince(last),
        openCases: null,
        contractEndDate: null, noticeDate: null, annualValue: null,
        hasProfile: null, profileVerified: null,
        healthScore: null, healthBand: null, openFlagCount: null,
        lastHealthcheckAt: null, quarterStatus: null,
      };
    });

    customers.sort((a, b) => {
      if (a.daysSinceActivity === null && b.daysSinceActivity === null) return 0;
      if (a.daysSinceActivity === null) return -1;
      if (b.daysSinceActivity === null) return 1;
      return b.daysSinceActivity - a.daysSinceActivity;
    });

    return NextResponse.json({
      source: "live",
      indexError,
      hint: "Run supabase/cs-customer-index.sql, then trigger a scoring run to populate the index.",
      windowDays: ACTIVITY_WINDOW_DAYS,
      total: customers.length,
      quiet: customers.filter(
        c => c.daysSinceActivity === null || c.daysSinceActivity >= ACTIVITY_WINDOW_DAYS).length,
      customers,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
