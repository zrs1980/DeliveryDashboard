"use client";

// Client-side access to the people who can be assigned work (see
// app/api/users/route.ts for the server half, which merges the signed-in users
// with the active NetSuite roster).
//
// Same shape and same sharing as useStaff: the in-flight promise is cached, so
// several pickers mounting at once cost one round trip rather than four.
//
// ⚠ This is who can RECEIVE a task, not what anyone is allowed to do. Keep
// authorisation in AUTH_ALLOWED_DOMAIN and lib/cs-permissions.ts.

import { useEffect, useState } from "react";

export interface AppUser {
  email: string;
  name: string;
  /** False = works here and could sign in, but never has. Still assignable. */
  hasSignedIn: boolean;
  lastSeenAt: string | null;
  imageUrl: string | null;
  source: "app" | "roster";
}

export interface AppUsers {
  users: AppUser[];
  /** The signed-in user's own address, lower-cased. "" until loaded. */
  me: string;
  warnings: string[];
}

const EMPTY: AppUsers = { users: [], me: "", warnings: [] };
let cached: Promise<AppUsers> | null = null;

function load(): Promise<AppUsers> {
  if (cached) return cached;

  cached = fetch("/api/users")
    .then(async res => {
      if (!res.ok) throw new Error(`/api/users ${res.status}`);
      const d = await res.json();
      return {
        users: (d.users ?? []) as AppUser[],
        me: String(d.me ?? ""),
        warnings: (d.warnings ?? []) as string[],
      };
    })
    .catch(err => {
      // Never cache a failure: a picker that empties once should refill on the
      // next mount rather than staying empty for the life of the page.
      cached = null;
      console.error("[useAppUsers]", err);
      return EMPTY;
    });

  return cached;
}

/** The assignable people, fetched once per page load. Empty until it arrives. */
export function useAppUsers(): AppUsers {
  const [state, setState] = useState<AppUsers>(EMPTY);

  useEffect(() => {
    let live = true;
    load().then(s => { if (live) setState(s); });
    return () => { live = false; };
  }, []);

  return state;
}

/**
 * Display name for an `assigned_to` value.
 *
 * Falls back to the raw string rather than blanking: tasks created before this
 * picker existed hold free text (a first name, a nickname, anything typed), and
 * showing nothing would look like the task is unassigned when it is not.
 */
export function assigneeName(users: AppUser[], assignedTo: string | null): string {
  if (!assignedTo) return "";
  const hit = users.find(u => u.email === assignedTo.toLowerCase());
  return hit?.name ?? assignedTo;
}
