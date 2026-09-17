"use client";

// Client-side access to the live staff roster (see lib/roster.ts for the server
// half). Components used to import the hardcoded EMPLOYEES map; they fetch this
// instead, so a new hire needs no code change.
//
// The in-flight promise is shared per category: four components mount at once on
// the PM and Customers tabs, and each should not cost its own round trip.

import { useEffect, useState } from "react";

export type StaffCategory = "all" | "consultants" | "pms";

export interface StaffOption {
  id:                number;
  name:              string;
  email:             string;
  category:          string;
  employeeType:      string;
  targetUtilization: number;
}

const cache = new Map<StaffCategory, Promise<StaffOption[]>>();

function load(category: StaffCategory): Promise<StaffOption[]> {
  const hit = cache.get(category);
  if (hit) return hit;

  const p = fetch(`/api/staff?category=${category}`)
    .then(async res => {
      if (!res.ok) throw new Error(`/api/staff ${res.status}`);
      const d = await res.json();
      return (d.employees ?? []) as StaffOption[];
    })
    .catch(err => {
      // Don't cache a failure — a dropdown that empties once should refill on the
      // next mount rather than staying empty for the life of the page.
      cache.delete(category);
      console.error("[useStaff]", err);
      return [] as StaffOption[];
    });

  cache.set(category, p);
  return p;
}

/** The roster, fetched once per category per page load. `[]` until it arrives. */
export function useStaff(category: StaffCategory = "all"): StaffOption[] {
  const [staff, setStaff] = useState<StaffOption[]>([]);

  useEffect(() => {
    let live = true;
    load(category).then(s => { if (live) setStaff(s); });
    return () => { live = false; };
  }, [category]);

  return staff;
}
