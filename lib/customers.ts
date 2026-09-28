// ─── The customer record ──────────────────────────────────────────────────────
//
// `customers` is the identity table every other table finally hangs a foreign
// key off. See supabase/customers.sql for why it exists and why it is NOT
// cs_customer_index (that one is a cache and is allowed to be truncated; this
// one is referenced by ~20 tables and is not).
//
// This module owns exactly two things: keeping the table in step with its two
// sources, and turning a `customer_ns_id` value into a `customers.id`.
//
// ⚠ SERVER ONLY. Pulls in NetSuite and the service-role Supabase client.
// The client-safe half of the `local:` convention lives in lib/crm-accounts.ts
// and stays there.

import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchCsCustomers } from "@/lib/cs-customers";
import { LOCAL_PREFIX, localAccountId } from "@/lib/crm-accounts";

export interface CustomerRow {
  id:             string;
  key:            string;
  ns_id:          string | null;
  local_id:       string | null;
  name:           string;
  entityid:       string | null;
  email:          string | null;
  phone:          string | null;
  website:        string | null;
  industry:       string | null;
  subsidiary_id:  number | null;
  stage:          string | null;
  source:         "netsuite" | "local";
  is_active:      boolean;
  deactivated_at: string | null;
  merged_into:    string | null;
  first_seen_at:  string;
  refreshed_at:   string;
}

export interface SyncResult {
  netsuite:     number;
  local:        number;
  deactivated:  number;
  merged:       number;
  warnings:     string[];
}

/**
 * Bring `customers` into step with NetSuite and the local prospect holding pen.
 *
 * Idempotent, and safe to run as often as you like. Runs at the START of the
 * nightly job — before scoring, not after it like the index rebuild — because
 * every other table's foreign key points here: a customer that appeared in
 * NetSuite today must have a row before anything tries to reference it.
 *
 * ⚠ NOTHING IS EVER DELETED. A customer that goes inactive in NetSuite is
 * marked `is_active = false`. Deleting would take real CRM history with it, or
 * fail on the foreign keys and abort the whole run — and "this account went
 * quiet and then vanished" is precisely the history worth keeping.
 */
export async function syncCustomers(): Promise<SyncResult> {
  const warnings: string[] = [];
  const supabase = getSupabaseAdmin();

  // ─── Source 1: NetSuite ───────────────────────────────────────────────────
  // Same universe as the index — every active customer record, prospects and
  // leads included. `stage` is what separates someone to score from someone to
  // sell to; being in this table is not a judgment about either.
  const nsCustomers = await fetchCsCustomers();

  // ─── Source 2: the local holding pen ──────────────────────────────────────
  // Only rows still waiting for NetSuite. A linked row is handled below: it is
  // retired and pointed at the NetSuite account that took it over, rather than
  // being resurrected here every night.
  const { data: locals, error: localErr } = await supabase
    .from("pm_crm_accounts")
    .select("id, name, domain, website, phone, email, industry, subsidiary_id, stage, linked_ns_id");
  if (localErr) {
    // Not fatal, but it must be said out loud: without this read every local
    // prospect would look like it had vanished and get deactivated.
    throw new Error(
      `Could not read pm_crm_accounts: ${localErr.message}. ` +
      `Refusing to sync customers, because every local prospect would be ` +
      `deactivated as missing.`,
    );
  }

  const liveLocals   = (locals ?? []).filter(a => !a.linked_ns_id);
  const linkedLocals = (locals ?? []).filter(a => a.linked_ns_id);

  const now = new Date().toISOString();

  const rows = [
    ...nsCustomers.map(c => ({
      key:           String(c.id),
      ns_id:         String(c.id),
      local_id:      null,
      name:          c.companyname,
      entityid:      c.entityid || null,
      email:         c.email,
      phone:         c.phone,
      website:       c.website,
      industry:      c.industry,
      subsidiary_id: c.subsidiaryId,
      stage:         c.stage,
      source:        "netsuite" as const,
      is_active:     true,
      deactivated_at: null,
      refreshed_at:  now,
    })),
    ...liveLocals.map(a => ({
      key:           localAccountId(a.id),
      ns_id:         null,
      local_id:      a.id,
      name:          a.name,
      entityid:      null,
      email:         a.email ?? null,
      phone:         a.phone ?? null,
      website:       a.website ?? a.domain ?? null,
      industry:      a.industry ?? null,
      subsidiary_id: a.subsidiary_id ?? null,
      stage:         a.stage ?? "PROSPECT",
      source:        "local" as const,
      is_active:     true,
      deactivated_at: null,
      refreshed_at:  now,
    })),
  ];

  // `first_seen_at` is deliberately absent from the payload. Supabase's upsert
  // writes every column it is given, so including it would reset "we have
  // known about this customer since…" to today on every nightly run.
  if (rows.length) {
    const { error } = await supabase.from("customers").upsert(rows, { onConflict: "key" });
    if (error) {
      throw new Error(
        `Could not write customers: ${error.message}. ` +
        `Run supabase/customers.sql in the Supabase SQL Editor.`,
      );
    }
  }

  // ─── Retire what is no longer there ───────────────────────────────────────
  // Soft, and only for rows that were active. A customer reappearing in
  // NetSuite comes back through the upsert above with is_active = true, so this
  // is reversible by itself.
  let deactivated = 0;
  const keep = rows.map(r => r.key);
  if (keep.length) {
    const { data: gone, error: deErr } = await supabase
      .from("customers")
      .update({ is_active: false, deactivated_at: now })
      .eq("is_active", true)
      .not("key", "in", `(${keep.map(k => `"${k}"`).join(",")})`)
      .select("id");
    if (deErr) warnings.push(`Departed customers not retired: ${deErr.message}`);
    deactivated = gone?.length ?? 0;
  }

  // ─── A local prospect that became real ────────────────────────────────────
  // The CRM records written under its `local:` key are still keyed that way,
  // so the row stays and points at the NetSuite account that took over. That
  // pointer is what lets slice 2's backfill resolve the old key to the right
  // customer instead of orphaning it.
  let merged = 0;
  if (linkedLocals.length) {
    const { data: nsRows } = await supabase
      .from("customers").select("id, ns_id").in("ns_id", linkedLocals.map(a => a.linked_ns_id!));
    const idByNs = new Map((nsRows ?? []).map(r => [r.ns_id, r.id]));

    for (const a of linkedLocals) {
      const target = idByNs.get(a.linked_ns_id!);
      if (!target) continue;  // the NetSuite account is not active; leave it alone
      const { error } = await supabase
        .from("customers")
        .update({ is_active: false, deactivated_at: now, merged_into: target })
        .eq("local_id", a.id)
        .is("merged_into", null);
      if (error) { warnings.push(`Local account ${a.name} not merged: ${error.message}`); continue; }
      merged++;
    }
  }

  return {
    netsuite: nsCustomers.length,
    local:    liveLocals.length,
    deactivated,
    merged,
    warnings,
  };
}

/**
 * `customer_ns_id` → `customers.id`, for the whole table at once.
 *
 * Slice 2's backfill and every read path that still speaks in keys go through
 * this. Retired rows are included on purpose: a key that stopped being active
 * still has history hanging off it, and resolving it to null would quietly
 * drop that history from any joined query.
 */
export async function customerIdByKey(): Promise<Map<string, string>> {
  const { data, error } = await getSupabaseAdmin()
    .from("customers").select("id, key, merged_into");
  if (error) throw new Error(`Could not read customers: ${error.message}`);

  // A merged local key resolves to the account that took it over, so history
  // written before the link shows up on the real customer rather than on a
  // retired shell nobody opens.
  return new Map((data ?? []).map(r => [r.key, r.merged_into ?? r.id]));
}

/** One key, for the one-off case. Prefer the map when resolving more than a few. */
export async function customerIdOfKey(key: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("customers").select("id, merged_into").eq("key", key).maybeSingle();
  return data ? (data.merged_into ?? data.id) : null;
}

/** True for a key in the `local:<uuid>` namespace. Re-exported so server code
 *  does not have to reach into the client-safe module for one predicate. */
export const isLocalKey = (key: string): boolean => key.startsWith(LOCAL_PREFIX);
