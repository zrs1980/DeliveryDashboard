// ─── Who owns an account ─────────────────────────────────────────────────────
//
// ⚠ EVERY CS LIST WAS THE WHOLE BOOK. Focus, Triage, the draft queue and the
// accounts table carried no ownership filter at all, so a CSM with 25 accounts
// opened a list of 87 and mentally filtered out other people's customers every
// morning. A shared list with no owner also means a flagged account is
// everyone's problem and therefore nobody's.
//
// The data was already there and unused: `salesrep_ns_id` and
// `consultant_ns_id` on every `cs_customer_index` row, `consultant_ns_id` on
// every health check.
//
// ⚠ IT IS A FILTER, NEVER A PERMISSION. "Not mine" still shows on All, and
// every route still enforces requireCsLayer() on its own. Hiding another
// person's account from a list is a convenience; it must never be mistaken for
// access control, and nothing here is on the path that decides what the server
// returns.
//
// SERVER ONLY — reads the NetSuite roster.

import { getStaffRoster } from "@/lib/roster";
import { samePerson } from "@/lib/identity";

export interface Owner {
  nsId: number | null;
  name: string | null;
  email: string;
}

/**
 * The signed-in user as a NetSuite employee.
 *
 * Matched on email, lower-cased both sides. Returns `nsId: null` for someone
 * with no NetSuite employee record — a contractor, or an address that differs
 * from the one in NetSuite. That is not an error and must not empty their
 * screen: the caller falls back to showing everything, because a CSM who
 * cannot be resolved is better served by the whole book than by nothing.
 */
export async function resolveOwner(email: string | null | undefined): Promise<Owner> {
  const addr = String(email ?? "").trim().toLowerCase();
  if (!addr) return { nsId: null, name: null, email: "" };

  try {
    const roster = await getStaffRoster();
    // Domain-tolerant: NetSuite may still hold the old address while someone
    // signs in with the new one. An exact match here cost them the "Mine"
    // filter and half of My Work, with nothing on screen to explain it.
    const hit = Object.values(roster.byId).find(s => samePerson(s.email, addr));
    return { nsId: hit ? Number(hit.id) : null, name: hit?.name ?? null, email: addr };
  } catch {
    // The roster is a NetSuite read and can fail. Treat it as "unknown owner",
    // which shows everything, rather than as "owns nothing", which shows
    // nothing and reads as a broken page.
    return { nsId: null, name: null, email: addr };
  }
}

/** Does this account belong to that person, by either field NetSuite carries? */
export function ownsAccount(
  owner: Owner,
  row: { salesrep_ns_id?: number | null; consultant_ns_id?: number | null },
): boolean {
  if (owner.nsId === null) return false;
  return row.salesrep_ns_id === owner.nsId || row.consultant_ns_id === owner.nsId;
}
