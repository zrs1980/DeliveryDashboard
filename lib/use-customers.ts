"use client";

// Client-side access to the NetSuite customer list.
//
// ─── Why this exists ────────────────────────────────────────────────────────
//
// Four components fetched `/api/customers` independently on mount — CrmView,
// CustomersView, PMView and ProjectManagementView — so a session that touched
// all four paid for the same list four times, and each held its own copy that
// could disagree with the others after a refresh.
//
// ⚠ `/api/customers` IS A LIVE SUITEQL QUERY over ~180 customers with several
// BUILTIN.DF() resolutions per row. It is not the index and it is not cheap.
// The in-flight promise is cached at module scope, so the second, third and
// fourth caller get the first one's result. Exactly the pattern
// lib/use-projects.ts uses for `/api/projects`, for the same reason.
//
// ⚠ IT IS DELIBERATELY NOT SERVED FROM THE `customers` TABLE. That table has
// the right shape and one indexed SELECT would be far faster — but it is
// synced nightly, and these four are mostly PICKERS. A customer created in
// NetSuite this morning has to appear in the dropdown this morning; "it will be
// there tomorrow" is not an acceptable answer when someone is trying to file
// work against a new account. Freshness beats speed here, and the cache below
// buys back most of the cost anyway.
//
// NetSuite is the master. Nothing here writes a customer.

import { useEffect, useState, useCallback } from "react";
import type { CsCustomer } from "@/lib/cs-customers";

export type Customer = CsCustomer;

export interface CustomerData {
  customers: Customer[];
  loading:   boolean;
  error:     string | null;
  /** Refetch, bypassing the cache. */
  refresh:   () => void;
}

let cached: Promise<Customer[]> | null = null;

function load(): Promise<Customer[]> {
  if (cached) return cached;

  cached = (async () => {
    const res = await fetch("/api/customers");
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error ?? `/api/customers ${res.status}`);
    }
    return ((await res.json())?.customers ?? []) as Customer[];
  })().catch(err => {
    // Never cache a failure, or one bad response leaves every consumer
    // permanently empty for the life of the page.
    cached = null;
    throw err;
  });

  return cached;
}

/**
 * The same cached fetch, for imperative callers.
 *
 * CrmView merges this list with local prospects inside its own `loadAccounts`
 * callback, which it also re-runs after creating or linking an account — a
 * hook cannot express that. It shares the cache rather than opening a second
 * connection to the same slow query.
 *
 * Neither of those mutations changes the NETSUITE set (linking targets an
 * account that already exists; a prospect is local only), so neither needs to
 * invalidate. Call invalidateCustomers() if that ever stops being true.
 */
export const fetchCustomers = (): Promise<Customer[]> => load();

export function useCustomers(): CustomerData {
  const [state, setState] = useState<Omit<CustomerData, "refresh">>({
    customers: [], loading: true, error: null,
  });

  const run = useCallback(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    load().then(
      c => { if (live) setState({ customers: c, loading: false, error: null }); },
      e => { if (live) setState({ customers: [], loading: false,
                                  error: e instanceof Error ? e.message : "Unknown error" }); },
    );
    return () => { live = false; };
  }, []);

  useEffect(() => run(), [run]);

  const refresh = useCallback(() => { cached = null; run(); }, [run]);

  return { ...state, refresh };
}

/**
 * Drop the cache without refetching.
 *
 * For a writer that has just changed the customer set — linking a local
 * prospect onto a NetSuite account, say — so the next mount reads fresh rather
 * than serving a list it knows is stale.
 */
export function invalidateCustomers() { cached = null; }

/** The label these views render, with the same fallback chain everywhere. */
export const customerLabel = (c: Customer): string =>
  c.companyname || c.entityid || String(c.id);
