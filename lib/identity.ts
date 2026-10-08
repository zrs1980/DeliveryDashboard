// ─── One person, several addresses ───────────────────────────────────────────
//
// ⚠ THE COMPANY IS MID-DOMAIN-MIGRATION AND THIS APP MATCHED EMAILS EXACTLY.
// The staff roster today holds 50 addresses at cebasolutions.com, 8 at
// looperp.ai and 3 at loopservices.co — the same people, moving between
// domains. At least four things keyed on an exact string match:
//
//     hasCsLayer()          an allow-list of literal addresses
//     resolveOwner()        roster email === session email
//     the digest            DIGEST_RECIPIENTS matched against the roster
//     pm_crm_tasks          assigned_to, and the "mine" filter over it
//
// So signing in as zabe@loopservices.co while NetSuite holds
// zabe@cebasolutions.com silently loses the whole CS layer, the "Mine" filter,
// every digest and every task assigned to the other address — while still
// signing in successfully, because AUTH_ALLOWED_DOMAIN permits both. Half
// working is worse than not working: nothing reports an error, the screens are
// simply emptier than they should be.
//
// ─── What counts as the same person ─────────────────────────────────────────
//
// ⚠ SAME LOCAL PART **AND** BOTH DOMAINS OURS. `zabe@` at two of our domains is
// one person; `zabe@` at a customer's domain is a stranger who happens to share
// a first name. The domain list is the one that already defines "us" for the
// meetings tabs, so there is one answer to that question rather than two.
//
// This is a bridge for a migration, not a permanent identity model. When every
// address has moved, the aliasing becomes a no-op on its own.

import { INTERNAL_EMAIL_DOMAINS } from "@/lib/constants";

export const normaliseEmail = (e: string | null | undefined): string =>
  String(e ?? "").trim().toLowerCase();

const parts = (e: string): { local: string; domain: string } | null => {
  const at = e.lastIndexOf("@");
  if (at <= 0) return null;
  return { local: e.slice(0, at), domain: e.slice(at + 1) };
};

/** One of ours — the same rule the meetings tabs use for internal attendees. */
export function isInternalDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return INTERNAL_EMAIL_DOMAINS.some(
    internal => d === internal || d.endsWith(`.${internal}`));
}

/**
 * Are these two addresses the same colleague?
 *
 * Exact match, or the same local part at two of our own domains. Never treats
 * a local part at an outside domain as a match — `dana@oxidecomputer.com` and
 * `dana@cebasolutions.com` are two different people and conflating them would
 * hand a customer's contact our staff's permissions.
 */
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normaliseEmail(a), y = normaliseEmail(b);
  if (!x || !y) return false;
  if (x === y) return true;

  const px = parts(x), py = parts(y);
  if (!px || !py) return false;
  if (px.local !== py.local) return false;
  return isInternalDomain(px.domain) && isInternalDomain(py.domain);
}

/** Does this address appear in that list, allowing for a domain move? */
export function matchesAny(email: string | null | undefined, list: readonly string[]): boolean {
  return list.some(entry => samePerson(email, entry));
}
