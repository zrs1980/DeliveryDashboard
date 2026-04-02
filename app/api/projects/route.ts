import { NextResponse } from "next/server";
import { fetchActiveProjects, fetchTimebillHours } from "@/lib/netsuite";
import { fetchListTasks, resolveClickUpListId, extractClickUpListId, getWorkspaceLists, matchListByCompanyName, isBlocked, isClientPending, isMilestone, isDone, computePct } from "@/lib/clickup";
import { calcHealthScore } from "@/lib/health";
import { EMPLOYEES, PMS, nsProjectUrl, CLICKUP_LIST_OVERRIDES, STANDALONE_CLICKUP_LISTS } from "@/lib/constants";
import type { Project, ProjectNote } from "@/lib/types";

export const revalidate = 0; // always fresh

// SuiteQL returns dates as "M/D/YYYY" — normalize to "YYYY-MM-DD"
function normalizeNSDate(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split("/");
  if (parts.length === 3) {
    const [m, d, y] = parts;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return raw; // already ISO or unknown — pass through
}

function parseNotes(raw: string | null): ProjectNote[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const rawProjects = await fetchActiveProjects();
    const projectIds  = rawProjects.map(p => parseInt(p.id));

    // Fetch timebill hours for all projects in one query
    const timebillRows = await fetchTimebillHours(projectIds);

    // Build timebill map: projectId → total hours logged
    const timebillByProject: Record<number, number> = {};
    for (const row of timebillRows) {
      const pid = parseInt(row.project_id);
      timebillByProject[pid] = (timebillByProject[pid] ?? 0) + parseFloat(row.total_hours);
    }

    // Pre-fetch workspace lists for name-based fallback matching (cached 1h)
    const TEAM_ID = process.env.CLICKUP_TEAM_ID!;
    const workspaceLists = await getWorkspaceLists(TEAM_ID).catch(() => []);

    // Fetch ClickUp tasks for each project (with ClickUp URL)
    const projects: Project[] = await Promise.all(
      rawProjects.map(async (p) => {
        const id            = parseInt(p.id);
        const budget_hours  = parseFloat(p.budget_hours) || 0;
        const remaining     = parseFloat(p.remaining_hours) || 0;
        const actual        = budget_hours - remaining;
        const clickupListId = extractClickUpListId(p.clickup_url);

        // Fetch ClickUp tasks — priority: override map → URL resolution → name match
        let tasks: Awaited<ReturnType<typeof fetchListTasks>> = [];
        let clickupError: string | null = null;
        try {
          const overrideListId = CLICKUP_LIST_OVERRIDES[id];
          if (overrideListId) {
            tasks = await fetchListTasks(overrideListId);
          } else if (p.clickup_url) {
            const resolvedListId = await resolveClickUpListId(p.clickup_url);
            if (resolvedListId) {
              tasks = await fetchListTasks(resolvedListId);
            } else {
              // Fall back to matching by company name in workspace list catalog
              const nameListId = matchListByCompanyName(p.companyname, workspaceLists);
              if (nameListId) {
                tasks = await fetchListTasks(nameListId);
              } else {
                clickupError = `Could not resolve list ID from URL: ${p.clickup_url}`;
              }
            }
          } else if (workspaceLists.length > 0) {
            // No URL — try name match anyway
            const nameListId = matchListByCompanyName(p.companyname, workspaceLists);
            if (nameListId) {
              tasks = await fetchListTasks(nameListId);
            } else {
              clickupError = "No ClickUp URL set on this project (custentity20 is empty)";
            }
          } else {
            clickupError = "No ClickUp URL set on this project (custentity20 is empty)";
          }
        } catch (e) {
          clickupError = e instanceof Error ? e.message : String(e);
          console.error(`[ClickUp] project ${p.id} (${p.companyname}):`, clickupError);
        }

        const pct       = computePct(tasks);
        const totalH    = actual + remaining;
        const burnRate  = totalH > 0 ? actual / totalH : 0;
        const spi       = burnRate > 0.01 ? Math.min(pct / burnRate, 2) : 1;
        const budgetGap = burnRate - pct;

        // Go-live date & days left
        const goliveDate = normalizeNSDate(p.golive_date);
        let daysLeft: number | null = null;
        let isOverdue = false;
        if (goliveDate) {
          const gl = new Date(goliveDate);
          gl.setHours(0, 0, 0, 0);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          daysLeft = Math.round((gl.getTime() - today.getTime()) / 86400000);
          isOverdue = daysLeft < 0 && pct < 1;
        }

        const { score, health } = calcHealthScore({ actual, rem: remaining, pct, isOverdue });

        // Find PM from timebill rows (employee with most hours who is a PM)
        const pmEntry = timebillRows
          .filter(r => parseInt(r.project_id) === id && PMS[parseInt(r.employee)])
          .sort((a, b) => parseFloat(b.total_hours) - parseFloat(a.total_hours))[0];
        const pm = pmEntry ? PMS[parseInt(pmEntry.employee)] : "—";

        // Timebill integrity warning
        const timebillTotal = timebillByProject[id] ?? 0;
        const consumed = budget_hours - remaining;
        const timebillWarning = timebillTotal > consumed + 20;

        const clientName = p.customer_name || p.companyname;

        return {
          id,
          entityid:      p.entityid,
          label:         `${clientName} — ${p.entityid}`,
          client:        clientName,
          projectType:   parseInt(p.jobtype) === 1 ? "Implementation" : "Service",
          pm,
          goliveDate,
          daysLeft,
          isOverdue,
          budget_hours,
          actual,
          rem:           remaining,
          pct,
          burnRate,
          spi,
          budgetGap,
          score,
          health,
          nsUrl:         nsProjectUrl(id),
          clickupUrl:    p.clickup_url ?? null,
          clickupListId,
          tasks,
          blocked:       tasks.filter(isBlocked),
          clientPending: tasks.filter(t => isClientPending(t) && !isDone(t)),
          milestones:    tasks.filter(isMilestone),
          timebillWarning,
          notes: parseNotes(p.user_notes),
          clickupError,
        } satisfies Project;
      })
    );

    // Fetch standalone internal ClickUp lists (no NS project backing)
    const standaloneProjects: Project[] = await Promise.all(
      STANDALONE_CLICKUP_LISTS.map(async ({ listId, label }, idx) => {
        let tasks: Awaited<ReturnType<typeof fetchListTasks>> = [];
        let clickupError: string | null = null;
        try {
          tasks = await fetchListTasks(listId);
        } catch (e) {
          clickupError = e instanceof Error ? e.message : String(e);
        }
        const pct = computePct(tasks);
        return {
          id:            -(idx + 1),
          entityid:      "INTERNAL",
          label,
          client:        "CEBA Internal",
          projectType:   "Service" as const,
          pm:            "—",
          goliveDate:    null,
          daysLeft:      null,
          isOverdue:     false,
          budget_hours:  0,
          actual:        0,
          rem:           0,
          pct,
          burnRate:      0,
          spi:           1,
          budgetGap:     0,
          score:         100,
          health:        "green" as const,
          nsUrl:         "",
          clickupUrl:    `https://app.clickup.com/42022327/v/l/li/${listId}`,
          clickupListId: listId,
          tasks,
          blocked:       tasks.filter(isBlocked),
          clientPending: tasks.filter(t => isClientPending(t) && !isDone(t)),
          milestones:    tasks.filter(isMilestone),
          timebillWarning: false,
          notes:         [],
          clickupError,
          isInternal:    true,
        } satisfies Project;
      })
    );

    return NextResponse.json({ projects: [...projects, ...standaloneProjects], updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/projects]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
