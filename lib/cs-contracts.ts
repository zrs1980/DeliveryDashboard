// ─── Contracts and the renewal clock ────────────────────────────────────────
//
// docs/01-DATA-MODEL.md calls contracts "the most commonly missing piece, and
// renewal motion is dead without it". Confirmed against the live account
// (Sep 2026): NetSuite holds no contract data at all — there is no `contract`,
// `subscription` or `billingschedule` table in SuiteQL, and the customer record
// carries no renewal date, notice period or annual value. The nearest thing is
// `custentity9`, contracted monthly MSA hours on the job.
//
// So `cs_contracts` is hand-entered, and this module owns what can be derived
// from it.
//
// ⚠ THE DEADLINE IS THE NOTICE DATE, NOT THE END DATE.
//
// A contract with a 90-day notice period and a 31 Dec end date must be acted on
// by 2 Oct. Miss that and it auto-renews — the end date was never the deadline,
// it was the date it became too late. Every alert here counts down to
// noticeDeadline, and `daysToRenewal` exists only for display.
//
// Derived, never stored (the spec is explicit): storing days-to-renewal would
// be wrong by one every midnight.

export type ContractProduct = "netsuite" | "loop_erp" | "services" | "other";
export type ContractStatus  = "active" | "pending_renewal" | "renewed" | "churned";

export interface CsContract {
  id:                 string;
  customer_ns_id:     string;
  customer_name:      string;
  product:            ContractProduct;
  start_date:         string | null;
  end_date:           string | null;
  notice_period_days: number;
  auto_renew:         boolean;
  annual_value:       number | null;
  seat_count:         number | null;
  licence_count:      number | null;
  modules:            string[];
  status:             ContractStatus;
  source:             string | null;
  notes:              string | null;
}

export interface RenewalClock {
  /** Days until end_date. Null when no end date is set. */
  daysToRenewal:  number | null;
  /** Days until notice must be given. THE deadline. Null when no end date. */
  daysToNotice:   number | null;
  /** ISO date notice is due. */
  noticeDeadline: string | null;
  /** Past the notice date but not yet ended — on an auto-renew contract, already committed. */
  noticePassed:   boolean;
  /** The alert band the spec asks for: 120 / 90 / 60 / 30 days to NOTICE. */
  alertBand:      120 | 90 | 60 | 30 | null;
  /** Already over. */
  expired:        boolean;
}

/**
 * Parse an ISO date at LOCAL midnight.
 *
 * `new Date("2026-12-31")` is read as UTC and renders as the 30th for anyone
 * behind Greenwich — which on a renewal countdown is a day of someone's notice
 * period. Same trap ResourceAllocation.tsx documents for its date inputs.
 */
export function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY = 86_400_000;

/** Whole days from today (local midnight) to `date`. Negative = past. */
function daysUntil(date: Date, today: Date): number {
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((b - a) / DAY);
}

export function renewalClock(c: Pick<CsContract, "end_date" | "notice_period_days">, today = new Date()): RenewalClock {
  const end = parseISODate(c.end_date);
  if (!end) {
    return { daysToRenewal: null, daysToNotice: null, noticeDeadline: null,
             noticePassed: false, alertBand: null, expired: false };
  }

  const noticeDays = Math.max(0, Math.floor(c.notice_period_days ?? 0));
  const notice     = new Date(end.getTime() - noticeDays * DAY);

  const daysToRenewal = daysUntil(end, today);
  const daysToNotice  = daysUntil(notice, today);

  // Bands are on the NOTICE clock, not the end date — that is the whole point.
  // The band is the tightest one crossed, so an alert escalates as it nears.
  let alertBand: RenewalClock["alertBand"] = null;
  if (daysToNotice >= 0) {
    if (daysToNotice <= 30)       alertBand = 30;
    else if (daysToNotice <= 60)  alertBand = 60;
    else if (daysToNotice <= 90)  alertBand = 90;
    else if (daysToNotice <= 120) alertBand = 120;
  }

  return {
    daysToRenewal,
    daysToNotice,
    noticeDeadline: toISO(notice),
    noticePassed:   daysToNotice < 0 && daysToRenewal >= 0,
    alertBand,
    expired:        daysToRenewal < 0,
  };
}

export function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * One line saying what actually has to happen, and by when.
 *
 * Deliberately plain: this text goes in a triage row and a flag reason, and
 * "Notice due in 12 days" is actionable in a way that "renewal approaching" is
 * not.
 */
export function renewalSummary(c: Pick<CsContract, "end_date" | "notice_period_days" | "auto_renew">, today = new Date()): string {
  const k = renewalClock(c, today);
  if (k.daysToRenewal === null) return "No end date set";
  if (k.expired)      return `Ended ${Math.abs(k.daysToRenewal)}d ago`;
  if (k.noticePassed) {
    return c.auto_renew
      ? `Notice window closed — auto-renews in ${k.daysToRenewal}d`
      : `Notice window closed — ends in ${k.daysToRenewal}d`;
  }
  if (k.daysToNotice === 0) return "Notice due TODAY";
  return `Notice due in ${k.daysToNotice}d · ends in ${k.daysToRenewal}d`;
}

export const PRODUCTS: ContractProduct[] = ["netsuite", "loop_erp", "services", "other"];
export const STATUSES: ContractStatus[]  = ["active", "pending_renewal", "renewed", "churned"];

export const PRODUCT_LABEL: Record<ContractProduct, string> = {
  netsuite: "NetSuite", loop_erp: "Loop ERP", services: "Services", other: "Other",
};
export const STATUS_LABEL: Record<ContractStatus, string> = {
  active: "Active", pending_renewal: "Pending renewal", renewed: "Renewed", churned: "Churned",
};
