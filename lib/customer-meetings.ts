// ─── Meetings on a customer's timeline, matched by who was in the room ───────
//
// `meeting_processing` only has a row once someone runs the Process wizard.
// Measured 29 September 2026 over the last 120 days: **100 meetings, 7
// processed**. So a timeline built from that table alone showed 7% of the calls
// that actually happened, and an account with weekly cadence calls read as
// silent.
//
// This fills the other 93 by matching a Fireflies meeting to a customer through
// the email domain of its EXTERNAL attendees.
//
// ─── Why this is evidence, not a guess ──────────────────────────────────────
//
// The PM tab's meeting list is deliberately "processed only", on the grounds
// that matching an unprocessed meeting to a PROJECT is a guess. That reasoning
// stands and this does not contradict it: a project is one of several a
// customer may have running, and nothing in a meeting says which. A CUSTOMER is
// coarser, and the evidence is direct — the domain map is built from
// `pm_crm_contacts.email`, which is 807 real addresses already keyed to
// customers by a human. `oxidecomputer.com` is Oxide because Oxide's contacts
// have that address, not because a model thought so.
//
// ⚠ DERIVED, NEVER WRITTEN. These are merged at read time and never inserted
// into `pm_crm_activities`. That table is what the whole app trusts, and an
// inference does not belong in it: a contact moving accounts would silently
// change which customer a stored row belonged to, and the row would not know.
// Processed meetings DO get a stored row — because filing one is something the
// app did, not something it worked out.

import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchFirefliesMeetings, firefliesConfigured, type FirefliesMeeting } from "@/lib/fireflies";
import { isInternalEmail } from "@/lib/constants";
import { fetchCsCustomers, fetchCustomerProjectIndex } from "@/lib/cs-customers";

/**
 * Free mailboxes carry no signal about which company someone belongs to, and a
 * customer contact who used a personal address would otherwise drag every
 * meeting containing any gmail.com attendee onto their account.
 */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
  "aol.com", "live.com", "msn.com", "me.com", "protonmail.com", "proton.me",
  "googlemail.com", "ymail.com",
]);

/**
 * ⚠ PARTNERS AND VENDORS WHO SIT IN CUSTOMER MEETINGS BUT ARE NOT THE CUSTOMER.
 *
 * This list exists because of a real false positive, caught before it shipped:
 * `myersholum.com` was learned as **Certified Waste Solutions**. Myers-Holum is
 * a NetSuite partner; their people attended three CWS meetings and no other
 * customer's, so the "claimed by two customers → drop" rule saw nothing
 * ambiguous and accepted it. Any meeting with a Myers-Holum attendee and no
 * other matching domain would then have landed on CWS's timeline.
 *
 * Nothing in the data distinguishes a partner from a customer — both are
 * external people in the room — so this cannot be derived and has to be stated.
 *
 * To find more: run scripts/verify-customer-meetings.ts, which lists every
 * domain learned ONLY from meetings (never confirmed by a customer website or a
 * contact record). Those are the ones worth a human glance; a domain the
 * customer's own NetSuite record or contact list confirms is safe.
 */
const PARTNER_DOMAINS = new Set([
  "myersholum.com",
]);

export interface CustomerMeeting {
  firefliesId: string;
  title:       string;
  date:        string | null;
  durationMin: number | null;
  /** External attendee domains that matched this customer. The evidence. */
  matchedOn:   string[];
  externalAttendees: string[];
  /** True when the Process wizard has recorded it — those also have a stored row. */
  processed:   boolean;
  docUrl:      string | null;
  transcriptUrl: string | null;
}

const domainOf = (email: string | null | undefined): string | null => {
  const d = String(email ?? "").split("@")[1]?.trim().toLowerCase();
  return d || null;
};

/**
 * domain → customer_ns_id, from THREE sources unioned.
 *
 * ⚠ CONTACTS ALONE ARE NOT ENOUGH, and the first version of this was wrong
 * because of it. The map built from `pm_crm_contacts` had 153 domains and
 * matched **two** customers — Oxide, Certified Waste Solutions and Strategic
 * Telecom, the three accounts with the most meetings in the book, were all
 * absent, because none of them has a contact recorded with their own email
 * domain. The contact table is thin exactly where the delivery work is.
 *
 * | Source | Why it is trustworthy |
 * |---|---|
 * | A processed meeting | Its project, and so its customer, was chosen by a human in the wizard. Every external domain in that room belongs to that customer. |
 * | `customer.url` in NetSuite | The company's own website, maintained by the people who own the record |
 * | `pm_crm_contacts.email` | An address a human filed against an account |
 *
 * The first is the strongest and it is self-bootstrapping: processing one
 * meeting for an account teaches the mapping for every other meeting with that
 * customer, past and future.
 *
 * ⚠ A DOMAIN CLAIMED BY TWO CUSTOMERS IS DROPPED, whichever source claimed it.
 * A meeting on the wrong customer's timeline is worse than one missing from it,
 * because the wrong one gets believed. This is what keeps a shared parent
 * company, or a partner address someone filed as a contact, from dragging
 * another account's calls onto this page.
 */
export async function buildDomainMap(): Promise<Map<string, string>> {
  return (await buildDomainMapDetailed()).map;
}

export interface DomainMapDetail {
  map: Map<string, string>;
  /**
   * Domains learned ONLY from a processed meeting — never confirmed by the
   * customer's website or by a contact record. These are where a partner or
   * vendor can slip in, so the verify script prints them for review.
   */
  meetingOnly: string[];
  /** Domains dropped because two customers claimed them. */
  ambiguous: string[];
}

export async function buildDomainMapDetailed(): Promise<DomainMapDetail> {
  const owners = new Map<string, Set<string>>();
  const confirmed = new Set<string>();   // seen in a website or contact record
  const fromMeeting = new Set<string>();
  const claim = (domain: string | null, customer: string | null | undefined) => {
    if (!domain || !customer) return;
    if (PUBLIC_DOMAINS.has(domain) || PARTNER_DOMAINS.has(domain)) return;
    owners.set(domain, (owners.get(domain) ?? new Set()).add(customer));
  };

  const db = getSupabaseAdmin();

  // ── 1. Contacts ──────────────────────────────────────────────────────────
  const { data: contacts, error } = await db
    .from("pm_crm_contacts").select("customer_ns_id, email").not("email", "is", null);
  if (error) throw new Error(`Contacts unreadable: ${error.message}`);
  for (const c of contacts ?? []) {
    // Our own domains say nothing about which customer was in the room.
    if (isInternalEmail(String(c.email))) continue;
    const d = domainOf(c.email);
    if (d) confirmed.add(d);
    claim(d, c.customer_ns_id);
  }

  // ── 2. The customer's own website ────────────────────────────────────────
  const customers = await fetchCsCustomers().catch(() => []);
  for (const c of customers) {
    const host = String(c.website ?? "")
      .replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].trim().toLowerCase();
    if (host) { confirmed.add(host); claim(host, String(c.id)); }
  }

  // ── 3. Meetings a human already filed ────────────────────────────────────
  // The strongest source, and the reason this works at all for the accounts
  // that matter: the wizard recorded which project the meeting belonged to, so
  // everyone external in that room belongs to that project's customer.
  const [{ data: mp }, index] = await Promise.all([
    db.from("meeting_processing").select("fireflies_id, project_ns_id, customer_ns_id"),
    fetchCustomerProjectIndex().catch(() => null),
  ]);

  const custOfMeeting = new Map<string, string>();
  for (const r of mp ?? []) {
    const cust = r.customer_ns_id
      ?? (r.project_ns_id ? index?.byProject[r.project_ns_id]?.customerNsId : undefined);
    if (cust) custOfMeeting.set(r.fireflies_id, cust);
  }

  if (custOfMeeting.size && firefliesConfigured()) {
    const all = await recentMeetings().catch(() => [] as FirefliesMeeting[]);
    for (const m of all) {
      const cust = custOfMeeting.get(m.id);
      if (!cust) continue;
      for (const a of m.external ?? []) {
        const d = domainOf(a.email);
        if (d) fromMeeting.add(d);
        claim(d, cust);
      }
    }
  }

  const map = new Map<string, string>();
  const ambiguous: string[] = [];
  for (const [d, set] of owners) {
    if (set.size === 1) map.set(d, [...set][0]);
    else ambiguous.push(d);
  }

  const meetingOnly = [...fromMeeting]
    .filter(d => map.has(d) && !confirmed.has(d))
    .sort();

  return { map, meetingOnly, ambiguous: ambiguous.sort() };
}

// ─── The Fireflies list is fetched once and shared ──────────────────────────
//
// ⚠ FIREFLIES IS RATE-LIMITED PER DAY on lower plans — Free 50, Pro 500. One
// fetch per customer page view would burn a day's quota in an afternoon of
// normal use. So the list is cached at module scope and every customer reads
// the same copy; worst case is ~144 fetches a day.
//
// The window is deliberately generous and the cache short: a meeting held an
// hour ago should appear on the account this morning.
const TTL_MS = 10 * 60 * 1000;
const WINDOW_DAYS = 180;
let cache: { at: number; meetings: FirefliesMeeting[] } | null = null;
let inFlight: Promise<FirefliesMeeting[]> | null = null;

async function recentMeetings(): Promise<FirefliesMeeting[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.meetings;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetchFirefliesMeetings(
      new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString(),
      new Date().toISOString(),
    );
    cache = { at: Date.now(), meetings: res.meetings ?? [] };
    return cache.meetings;
  })().finally(() => { inFlight = null; });

  return inFlight;
}

export interface CustomerMeetingsResult {
  meetings: CustomerMeeting[];
  /** Null when it worked. A reason the caller must show rather than render empty. */
  unavailable: string | null;
  /** How many meetings were considered, so "none matched" is distinguishable. */
  scanned: number;
}

/**
 * Every Fireflies meeting that belongs to this customer, newest first.
 *
 * Never throws: the Activity tab's stored history is the important half, and a
 * Fireflies outage must not blank it. A failure comes back as `unavailable`
 * with a reason — "we could not look" and "there were none" must not render
 * the same.
 */
export async function fetchCustomerMeetings(
  customerNsId: string,
): Promise<CustomerMeetingsResult> {
  if (!firefliesConfigured()) {
    return { meetings: [], scanned: 0, unavailable: "FIREFLIES_API_KEY is not set." };
  }

  let all: FirefliesMeeting[];
  let domains: Map<string, string>;
  try {
    [all, domains] = await Promise.all([recentMeetings(), buildDomainMap()]);
  } catch (e) {
    return {
      meetings: [], scanned: 0,
      unavailable: `Meetings could not be loaded: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  // Which of this customer's meetings have been through the wizard. Read here
  // rather than inferred, so a processed meeting is labelled as such and its
  // filed document can be offered.
  const processed = new Map<string, { doc_url: string | null }>();
  try {
    const { data } = await getSupabaseAdmin()
      .from("meeting_processing").select("fireflies_id, doc_url");
    for (const r of data ?? []) processed.set(r.fireflies_id, { doc_url: r.doc_url });
  } catch { /* labels degrade; the list still stands */ }

  const out: CustomerMeeting[] = [];
  for (const m of all) {
    // `external` is already computed by normalizeMeeting() using the same
    // isInternalEmail() rule the Zoom tab uses — reused rather than recomputed,
    // so the two tabs cannot disagree about who counts as external.
    const ext = (m.external ?? [])
      .map(a => a.email)
      .filter((e): e is string => Boolean(e));

    const matchedOn = [...new Set(
      ext.map(domainOf).filter((d): d is string => Boolean(d) && !PUBLIC_DOMAINS.has(d!))
    )].filter(d => domains.get(d) === customerNsId);

    if (!matchedOn.length) continue;

    const p = processed.get(m.id);
    out.push({
      firefliesId: m.id,
      title:       m.title || "Meeting",
      date:        m.date ?? null,
      durationMin: m.durationMinutes ?? null,
      matchedOn,
      externalAttendees: [...new Set(ext)],
      processed:   Boolean(p),
      docUrl:      p?.doc_url ?? null,
      transcriptUrl: m.transcriptUrl ?? null,
    });
  }

  out.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return { meetings: out, scanned: all.length, unavailable: null };
}
