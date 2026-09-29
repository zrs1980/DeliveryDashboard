// ─── Local account ids ──────────────────────────────────────────────────────
//
// A prospect that does not exist in NetSuite yet still needs to own contacts,
// deals, tasks and activity — all of which key on `customer_ns_id text`. Rather
// than add a parallel nullable column to four tables and a branch to every
// query that reads them, a local account borrows the same column under a
// reserved prefix.
//
// `customer_ns_id = "local:<uuid>"`
//
// NetSuite internal ids are integers, so the namespaces cannot collide.
//
// ⚠ CLIENT-SAFE ON PURPOSE. This is imported by CrmView in the browser, so it
// must never pull in NetSuite, Supabase or anything server-only.

export const LOCAL_PREFIX = "local:";

export const isLocalAccountId = (id: string | null | undefined): boolean =>
  typeof id === "string" && id.startsWith(LOCAL_PREFIX);

export const localAccountId = (uuid: string): string => LOCAL_PREFIX + uuid;

/** The bare uuid behind a local id. Returns null for a NetSuite id. */
export const localUuidOf = (id: string | null | undefined): string | null =>
  isLocalAccountId(id) ? (id as string).slice(LOCAL_PREFIX.length) : null;

// ─── Splitting a stored display name ────────────────────────────────────────
//
// 815 contacts predate first_name/last_name and have only `name`. Rather than
// backfill them with a guess, the editor pre-fills the two fields from this
// split so a human sees the proposal and can correct it before saving — the
// same shape as the role suggestions.
//
// ⚠ IT IS A SUGGESTION, NOT A RULE. "Piero Loza Palma" splits correctly here by
// luck; "van der Berg" and any name with a suffix will not. That is precisely
// why it fills a form rather than writing to the database.
export function splitName(full: string | null | undefined): { first: string; last: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}
