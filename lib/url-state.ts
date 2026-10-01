"use client";

// ─── Where you are, in the address bar ───────────────────────────────────────
//
// ⚠ NOTHING IN THIS APP WAS LINKABLE. Every screen lived in `useState`, so you
// could not bookmark a customer, could not paste one into Slack, lost your
// place on refresh, and browser Back did nothing.
//
// That compounded: the morning digest says "Certified Waste Solutions needs a
// health check" and had no link to put next to it. A push channel that cannot
// point at anything makes the reader go hunting, which is most of the value
// gone.
//
// ⚠ `history.replaceState`, NOT next/navigation. `useSearchParams` forces a
// Suspense boundary on this page and triggers a re-render of the whole
// dashboard on every tab click — which re-runs the fetches these views own.
// Writing the URL directly changes the address bar and nothing else, which is
// exactly the amount of work this needs.
//
// Reads are one-shot on mount, deliberately: this restores a link someone
// opened, it does not make the URL a second source of truth that fights the
// component's own state.

import { useCallback, useEffect, useState } from "react";

export type UrlState = Record<string, string | null | undefined>;

/** Everything in the query string, as a plain object. */
export function readUrl(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  new URLSearchParams(window.location.search).forEach((v, k) => { out[k] = v; });
  return out;
}

/**
 * Merge keys into the query string. A null or empty value removes its key, so
 * closing a customer cleans up after itself rather than leaving a stale id
 * behind for the next person who copies the link.
 */
export function writeUrl(patch: UrlState) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  window.history.replaceState(
    null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}

/**
 * A piece of component state that also lives in the URL.
 *
 * The initial value is taken from the URL when present, so a shared link opens
 * where it was shared from. After that the component owns it and the URL
 * follows.
 */
export function useUrlState(
  key: string,
  initial: string,
): [string, (v: string) => void] {
  // Lazy initialiser: the URL is read once, on mount, before the first paint.
  const [value, setValue] = useState<string>(() => readUrl()[key] || initial);

  useEffect(() => { writeUrl({ [key]: value === initial ? null : value }); }, [key, value, initial]);

  const set = useCallback((v: string) => setValue(v), []);
  return [value, set];
}

/** Absolute link to a screen — for a digest, a Slack message, an email. */
export function appUrl(base: string, params: UrlState): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, String(v));
  return u.toString();
}
