import { NextResponse } from "next/server";
import { fetchActiveProjects, fetchTimebillHours } from "@/lib/netsuite";
import { fetchListTasks, resolveClickUpListId, extractClickUpListId, isBlocked, isClientPending, isMilestone, isDone, computePct } from "@/lib/clickup";
import { calcHealthScore } from "@/lib/health";
import { EMPLOYEES, PMS, nsProjectUrl } from "@/lib/constants";
import type { Project, ProjectNote } from "@/lib/types";

export const revalidate = 0; // always fresh

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

    // Fetch ClickUp tasks for each project (with ClickUp URL)
    const projects: Project[] = await Promise.all(
      rawProjects.map(async (p) => {
        const id            = parseInt(p.id);
        const budget_hours  = parseFloat(p.budget_hours) || 0;
        const remaining     = parseFloat(p.remaining_hours) || 0;
        const actual        = budget_hours - remaining;
        const clickupListId = extractClickUpListId(p.clickup_url);

        // Fetch ClickUp tasks — resolve view-style URLs to real list IDs first
        let tasks: Awaited<ReturnType<typeof fetchListTasks>> = [];
        let clickupError: string | null = null;
        try {
          if (p.clickup_url) {
            const resolvedListId = await resolveClickUpListId(p.clickup_url);
            if (resolvedListId) {
              tasks = await fetchListTasks(resolvedListId);
            } else {
              clickupError = `Could not resolve list ID from URL: ${p.clickup_url}`;
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
        const goliveDate = p.golive_date ?? null;
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

        return {
          id,
          entityid:      p.entityid,
          label:         `${p.companyname} — ${p.entityid}`,
          client:        p.companyname,
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

    return NextResponse.json({ projects, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/projects]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
