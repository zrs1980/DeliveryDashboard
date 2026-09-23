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
