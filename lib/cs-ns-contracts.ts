import { runSuiteQLAll } from "@/lib/netsuite";

// ─── Contracts, from NetSuite ───────────────────────────────────────────────
//
// ⚠ CORRECTION TO AN EARLIER BELIEF. Phase 3 was built on the conclusion that
// NetSuite held no contract data, reached by probing for SuiteQL tables named
// `contract`, `subscription` and `billingschedule` — all of which fail — and
// checking the 85 columns on `customer`. That probe was too shallow.
//
// Contracts live in the **Contract Renewals SuiteApp**, as the custom record
// `CUSTOMRECORD_CONTRACTS` (with `CUSTOMRECORD_CONTRACT_ITEM` beneath it and the
// `CUSTOMRECORD_SWE_*` records around it). Custom records are queryable in
// SuiteQL by their script id; `customrecordtype` lists them all, which is the
// probe that should have been run first.
//
// Verified Sep 2026: 5 contracts, 4 distinct customers — Sortera (×2, one
// renewed and superseded), Certified Waste Solutions, The Yaffe Companies,
// Strategic Telecom. Real start and end dates, 12-month renewal terms, annual
// and total values, and an Active / Renewal Processed status.
//
// So contracts are SYNCED, not hand-entered. The one thing NetSuite does not
// carry is a contractual NOTICE PERIOD — see the note on daysB4Renewal below —
// and that remains a local annotation in `cs_contracts`.

export interface NsContract {
  nsContractId:   string;
  name:           string | null;
  customerNsId:   string;
  customerName:   string;
  status:         "active" | "renewed" | "other";
  statusLabel:    string;
  contractType:   string | null;
  startDate:      string | null;   // ISO
  endDate:        string | null;   // ISO
  renewalTermMonths: number | null;
  annualValue:    number | null;
  totalValue:     number | null;
  excluded:       boolean;
  dateRenewed:    string | null;   // ISO
  /**
   * The SuiteApp's "days before renewal" setting — when it generates the
   * renewal transaction. It reads 358 on every contract in the account, i.e. a
   * fixed configuration rather than a per-contract term, so it is NOT a notice
   * period and must not be used as one. Surfaced for reference only.
   */
  daysBeforeRenewal: number | null;
}

const num = (v: string | null): number | null => {
  if (v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Every contract in the account.
 *
 * Dates are normalised to ISO in SQL with TO_CHAR. SuiteQL returns M/D/YYYY,
 * which does not sort lexicographically and which `new Date()` parses
 * inconsistently — the same trap that made last-activity dates wrong earlier.
 */
export async function fetchNsContracts(): Promise<NsContract[]> {
  const rows = await runSuiteQLAll<Record<string, string | null>>(`
    SELECT
      c.id                                            AS ns_contract_id,
      c.name                                          AS name,
      c.custrecord_contracts_end_user                 AS customer_id,
      BUILTIN.DF(c.custrecord_contracts_end_user)     AS customer_name,
      c.custrecord_contract_status                    AS status_id,
      BUILTIN.DF(c.custrecord_contract_status)        AS status_label,
      BUILTIN.DF(c.custrecord_swe_contract_type)      AS type_label,
      TO_CHAR(c.custrecord_contracts_start_date, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(c.custrecord_contracts_end_date,   'YYYY-MM-DD') AS end_date,
      TO_CHAR(c.custrecord_contract_date_renewed,'YYYY-MM-DD') AS date_renewed,
      c.custrecord_contract_renewal_terms             AS renewal_terms,
      c.custrecord_swe_days_b4_renewal                AS days_b4_renewal,
      c.custrecord_swe_annual_renew_val_net           AS annual_value,
      c.custrecord_swe_contract_value_olr             AS total_value,
      c.custrecord_contracts_renewals_exclusion       AS excluded
    FROM CUSTOMRECORD_CONTRACTS c
    WHERE c.isinactive = 'F'
  `);

  return (rows ?? [])
    .filter(r => r.customer_id)
    .map(r => ({
      nsContractId: String(r.ns_contract_id),
      name:         r.name,
      customerNsId: String(r.customer_id),
      customerName: r.customer_name ?? "",
      // Status 2 = Active, 6 = Renewal Processed. Mapped rather than passed
      // through, so a new status value degrades to "other" instead of being
      // silently treated as active by a rule.
      status: r.status_id === "2" ? "active" : r.status_id === "6" ? "renewed" : "other",
      statusLabel: r.status_label ?? "",
      contractType: r.type_label ?? null,
      startDate: r.start_date ?? null,
      endDate:   r.end_date ?? null,
      renewalTermMonths: num(r.renewal_terms),
      annualValue: num(r.annual_value),
      totalValue:  num(r.total_value),
      excluded:    r.excluded === "T",
      dateRenewed: r.date_renewed ?? null,
      daysBeforeRenewal: num(r.days_b4_renewal),
    }));
}

/**
 * The contract that actually governs each customer today.
 *
 * A customer can hold several rows — Sortera has a 2025-26 term marked "Renewal
 * Processed" and the 2026-27 term that replaced it. Taking the first row would
 * report an expired contract as current, so: prefer Active, then the latest end
 * date. Contracts flagged as excluded from renewals are skipped entirely.
 */
export function currentContractByCustomer(contracts: NsContract[]): Record<string, NsContract> {
  const best: Record<string, NsContract> = {};
  for (const c of contracts) {
    if (c.excluded) continue;
    const cur = best[c.customerNsId];
    if (!cur) { best[c.customerNsId] = c; continue; }

    const rank = (x: NsContract) => (x.status === "active" ? 2 : x.status === "other" ? 1 : 0);
    if (rank(c) > rank(cur)) { best[c.customerNsId] = c; continue; }
    if (rank(c) === rank(cur) && (c.endDate ?? "") > (cur.endDate ?? "")) best[c.customerNsId] = c;
  }
  return best;
}

/**
 * Internal id of the CUSTOMRECORD_CONTRACTS record type, for deep links.
 * Verified September 2026: `SELECT internalid, scriptid FROM customrecordtype`
 * returns 463 for CUSTOMRECORD_CONTRACTS (458 is Contract Item — a different
 * record, and linking to it would open the wrong page).
 */
export const CONTRACT_RECTYPE = 463;

/** Live link to a contract record in NetSuite. */
export const nsContractUrl = (nsContractId: string) =>
  `https://system.na1.netsuite.com/app/common/custom/custrecordentry.nl`
  + `?rectype=${CONTRACT_RECTYPE}&id=${nsContractId}`;
