"use client";
import { useState } from "react";
import { C } from "@/lib/constants";
import { fmtH } from "@/lib/health";
import { isDone, isBlocked, taskBucket } from "@/lib/clickup";
import type { Project, CUTask } from "@/lib/types";

interface Props {
  projects: Project[];
}

interface ConsultantSummary {
  name: string;
  totalOpen: number;
  overdue: number;
  thisWeek: number;
  blocked: number;
  estimatedHoursRemaining: number;
  projectBreakdown: Array<{
    project: Project;
    openTasks: number;
    overdueTasks: number;
    estimatedH: number;
  }>;
}

function buildSummaries(projects: Project[]): ConsultantSummary[] {
  const byName = new Map<string, ConsultantSummary>();

  for (const project of projects) {
    for (const task of project.tasks) {
      if (isDone(task)) continue;
      for (const assignee of task.assignees) {
        const name = assignee.username;
        if (!byName.has(name)) {
          byName.set(name, { name, totalOpen: 0, overdue: 0, thisWeek: 0, blocked: 0, estimatedHoursRemaining: 0, projectBreakdown: [] });
        }
        const s = byName.get(name)!;
        s.totalOpen++;

        const bucket = taskBucket(task);
        if (bucket === "overdue") s.overdue++;
        if (bucket === "this_week") s.thisWeek++;
        if (isBlocked(task)) s.blocked++;

        const estH = task.time_estimate ? task.time_estimate / 3600000 : 0;
        const spentH = task.time_spent ? task.time_spent / 3600000 : 0;
        s.estimatedHoursRemaining += Math.max(0, estH - spentH);

        // Project breakdown
        let pb = s.projectBreakdown.find(x => x.project.id === project.id);
        if (!pb) {
          pb = { project, openTasks: 0, overdueTasks: 0, estimatedH: 0 };
          s.projectBreakdown.push(pb);
        }
        pb.openTasks++;
        if (bucket === "overdue") pb.overdueTasks++;
        pb.estimatedH += Math.max(0, estH - spentH);
      }
    }
  }

  return Array.from(byName.values()).sort((a, b) => b.overdue - a.overdue || b.totalOpen - a.totalOpen);
}

// Over/under allocation: rough threshold — if estimated hours remaining > project rem / consultants on that project
function allocationStatus(est: number, totalOpen: number): "over" | "normal" | "light" {
  if (est > 80) return "over";
  if (est < 5 && totalOpen > 0) return "light";
  return "normal";
}

const th: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 11,
  fontWeight: 700,
  color: C.textSub,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: `1px solid ${C.border}`,
  textAlign: "left",
  background: C.alt,
  whiteSpace: "nowrap",
};

export function ResourceAllocation({ projects }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const summaries = buildSummaries(projects);

  if (summaries.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.textSub, fontSize: 13 }}>
        No task assignment data available. Make sure ClickUp tasks are loaded.
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: C.textSub, marginBottom: 16 }}>
        Task assignments from ClickUp. Estimated hours remaining calculated from task time estimates minus time spent.
        Allocation status: <span style={{ color: C.red, fontWeight: 600 }}>Over</span> = &gt;80h estimated remaining,{" "}
        <span style={{ color: C.green, fontWeight: 600 }}>Light</span> = minimal open work.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
          <thead>
            <tr>
              <th style={th}>Consultant</th>
              <th style={{ ...th, textAlign: "center" }}>Open Tasks</th>
              <th style={{ ...th, textAlign: "center" }}>Overdue</th>
              <th style={{ ...th, textAlign: "center" }}>This Week</th>
              <th style={{ ...th, textAlign: "center" }}>Blocked</th>
              <th style={{ ...th, textAlign: "center" }}>Est. Hrs Left</th>
              <th style={{ ...th, textAlign: "center" }}>Allocation</th>
              <th style={{ ...th, textAlign: "center" }}>Projects</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s, i) => {
              const status = allocationStatus(s.estimatedHoursRemaining, s.totalOpen);
              const isExp = expanded === s.name;
              const rowBg = i % 2 === 0 ? C.surface : C.alt;
              return (
                <>
                  <tr key={s.name} style={{ background: rowBg }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13, color: C.text, borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      {s.name}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", fontFamily: C.mono, fontSize: 13, fontWeight: 600, color: C.text, borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      {s.totalOpen}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", fontFamily: C.mono, fontSize: 13, fontWeight: 700, color: s.overdue > 0 ? C.red : C.textSub, borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      {s.overdue > 0 ? `⚠ ${s.overdue}` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", fontFamily: C.mono, fontSize: 13, color: s.thisWeek > 0 ? C.blue : C.textSub, borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      {s.thisWeek || "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", fontFamily: C.mono, fontSize: 13, color: s.blocked > 0 ? C.orange : C.textSub, borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      {s.blocked > 0 ? `🚫 ${s.blocked}` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", fontFamily: C.mono, fontSize: 13, fontWeight: 600, color: s.estimatedHoursRemaining > 0 ? C.text : C.textSub, borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      {s.estimatedHoursRemaining > 0 ? fmtH(Math.round(s.estimatedHoursRemaining)) : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, borderRadius: 4, padding: "2px 8px",
                        background: status === "over" ? C.redBg : status === "light" ? C.greenBg : C.blueBg,
                        color: status === "over" ? C.red : status === "light" ? C.green : C.blue,
                        border: `1px solid ${status === "over" ? C.redBd : status === "light" ? C.greenBd : C.blueBd}`,
                      }}>
                        {status === "over" ? "Over" : status === "light" ? "Light" : "Normal"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", fontSize: 12, color: C.textMid, borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      {s.projectBreakdown.length}
                    </td>
                    <td style={{ padding: "10px 12px", borderBottom: isExp ? "none" : `1px solid ${C.border}` }}>
                      <button
                        onClick={() => setExpanded(isExp ? null : s.name)}
                        style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontFamily: C.font, background: isExp ? C.yellowBg : C.alt, color: isExp ? C.yellow : C.textMid, border: `1px solid ${isExp ? C.yellowBd : C.border}` }}
                      >
                        {isExp ? "▲ Hide" : "▼ Detail"}
                      </button>
                    </td>
                  </tr>

                  {/* Expanded project breakdown */}
                  {isExp && (
                    <tr key={`${s.name}-detail`} style={{ background: rowBg }}>
                      <td colSpan={9} style={{ padding: "0 12px 12px 32px", borderBottom: `1px solid ${C.border}` }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th style={{ ...th, background: "transparent", fontSize: 10 }}>Project</th>
                              <th style={{ ...th, background: "transparent", fontSize: 10, textAlign: "center" }}>Open Tasks</th>
                              <th style={{ ...th, background: "transparent", fontSize: 10, textAlign: "center" }}>Overdue</th>
                              <th style={{ ...th, background: "transparent", fontSize: 10, textAlign: "center" }}>Est. Hrs Left</th>
                              <th style={{ ...th, background: "transparent", fontSize: 10, textAlign: "center" }}>Project Hrs Remaining</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.projectBreakdown.map(pb => (
                              <tr key={pb.project.id}>
                                <td style={{ padding: "5px 12px", color: C.text, fontWeight: 600 }}>{pb.project.client}</td>
                                <td style={{ padding: "5px 12px", textAlign: "center", fontFamily: C.mono }}>{pb.openTasks}</td>
                                <td style={{ padding: "5px 12px", textAlign: "center", fontFamily: C.mono, color: pb.overdueTasks > 0 ? C.red : C.textSub, fontWeight: pb.overdueTasks > 0 ? 700 : 400 }}>
                                  {pb.overdueTasks > 0 ? `⚠ ${pb.overdueTasks}` : "—"}
                                </td>
                                <td style={{ padding: "5px 12px", textAlign: "center", fontFamily: C.mono, color: C.textMid }}>
                                  {pb.estimatedH > 0 ? fmtH(Math.round(pb.estimatedH)) : "—"}
                                </td>
                                <td style={{ padding: "5px 12px", textAlign: "center", fontFamily: C.mono, color: pb.project.rem < 20 ? C.red : C.textMid, fontWeight: pb.project.rem < 20 ? 700 : 400 }}>
                                  {fmtH(pb.project.rem)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
