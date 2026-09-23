"use client";

// Client-side access to the NetSuite project portfolio, for views outside the
// main dashboard page.
//
// ⚠ `/api/projects` IS THE EXPENSIVE ONE. It fans out to ClickUp once per
// project, so it takes seconds and must not be refetched on every tab switch.
// The in-flight promise is cached at module scope, so opening Projects, then an
// account, then Projects again costs one request.
//
// ⚠ THE HOMESCREEN DOES NOT USE THIS. `app/page.tsx` owns its own copy, driven
// by the header's Refresh Data button and interleaved with cases, allocations
// and the roster. Wiring it through here would mean reworking that button's
// semantics, so the two are deliberately separate — the cost is one extra fetch
// per session if you use both, not one per navigation. If they are ever
// unified, this is the place to unify them into.
//
// NetSuite is the master. Nothing here writes a project.

import { useEffect, useState, useCallback } from "react";
import type { Project, ProjectPhase } from "@/lib/types";

export interface ProjectData {
  projects: Project[];
  phases: ProjectPhase[];
  loading: boolean;
  error: string | null;
  /** Refetch, bypassing the cache. */
  refresh: () => void;
}

interface Loaded { projects: Project[]; phases: ProjectPhase[]; error: string | null }

let cached: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  if (cached) return cached;

  cached = (async () => {
    // Phase RAG is fetched alongside, same as the dashboard does, because
    // ProjectTable takes both and renders the phase column from the second.
    const [pRes, phRes] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/reports/phase-rag"),
    ]);

    if (!pRes.ok) {
      const j = await pRes.json().catch(() => ({}));
      throw new Error(j?.error ?? `/api/projects ${pRes.status}`);
    }
    const pJson = await pRes.json();

    // A phase failure degrades the phase column; it does not blank the table.
    // The hours, budget and go-live columns are the reason to open this view.
    let phases: ProjectPhase[] = [];
    let error: string | null = null;
    if (phRes.ok) {
      phases = (await phRes.json())?.phases ?? [];
    } else {
      error = "Phase data is unavailable, so the Phase column is blank.";
    }

    return { projects: (pJson.projects ?? []) as Project[], phases, error };
  })().catch(err => {
    // Never cache a failure, or one bad response leaves the view permanently
    // empty for the life of the page.
    cached = null;
    throw err;
  });

  return cached;
}

export function useProjects(): ProjectData {
  const [state, setState] = useState<Omit<ProjectData, "refresh">>({
    projects: [], phases: [], loading: true, error: null,
  });

  const run = useCallback(() => {
    let live = true;
    setState(s => ({ ...s, loading: true, error: null }));
    load().then(
      d => { if (live) setState({ projects: d.projects, phases: d.phases, loading: false, error: d.error }); },
      e => { if (live) setState({ projects: [], phases: [], loading: false, error: e instanceof Error ? e.message : "Unknown error" }); },
    );
    return () => { live = false; };
  }, []);

  useEffect(() => run(), [run]);

  const refresh = useCallback(() => { cached = null; run(); }, [run]);

  return { ...state, refresh };
}

/** Everything delivered for one customer. NetSuite's customer id is the key. */
export function projectsForCustomer(projects: Project[], customerNsId: string): Project[] {
  return projects.filter(p => p.customerNsId === customerNsId);
}
