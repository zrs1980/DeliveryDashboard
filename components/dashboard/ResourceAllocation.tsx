"use client";
import { C, EMPLOYEES } from "@/lib/constants";
import { fmtH } from "@/lib/health";
import type { Project } from "@/lib/types";

interface Props {
  projects: Project[];
  timebill: Array<{ employee: number; project_id: number; total_hours: number }>;
}

function getMondayWeeks(n = 8): string[] {
  const weeks: string[] = [];
  const now = new Date();
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  // Start 2 weeks ago
  mon.setDate(mon.getDate() - 14);
  for (let i = 0; i < n; i++) {
    weeks.push(mon.toISOString().slice(0, 10));
    mon.setDate(mon.getDate() + 7);
  }
  return weeks;
}

function currentWeekMonday(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return now.toISOString().slice(0, 10);
}

export function ResourceAllocation({ projects, timebill }: Props) {
  const weeks    = getMondayWeeks(8);
  const currentW = currentWeekMonday();

  // Group timebill by employee
  const byEmployee: Record<number, { projectId: number; hours: number }[]> = {};
  for (const row of timebill) {
    if (!byEmployee[row.employee]) byEmployee[row.employee] = [];
    byEmployee[row.employee].push({ projectId: row.project_id, hours: row.total_hours });
  }

  const employeeIds = Object.keys(byEmployee).map(Number).filter(id => EMPLOYEES[id]);

  const th: React.CSSProperties = {
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: C.textSub,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: `1px solid ${C.border}`,
    textAlign: "center" as const,
    whiteSpace: "nowrap",
  };

  const weekLabel = (w: string) => {
    const d = new Date(w);
    return `${d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
  };

  return (
    <div>
      <p style={{ fontSize: 12, color: C.textSub, marginBottom: 12 }}>
        Hours are totals from NetSuite timebill. Weekly breakdown requires time entry date data — showing aggregate per consultant per project.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: C.font }}>
          <thead>
            <tr style={{ background: C.alt }}>
              <th style={{ ...th, textAlign: "left" }}>Consultant</th>
              {projects.map(p => (
                <th key={p.id} style={th}>{p.client.split(" ")[0]}</th>
              ))}
              <th style={{ ...th, background: C.blueBg, color: C.blue }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {employeeIds.map((empId, i) => {
              const rows  = byEmployee[empId] ?? [];
              const total = rows.reduce((s, r) => s + r.hours, 0);
              return (
                <tr key={empId} style={{ background: i % 2 === 0 ? C.surface : C.alt }}>
                  <td style={{ padding: "9px 10px", fontWeight: 600, fontSize: 13, color: C.text, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
                    {EMPLOYEES[empId]}
                  </td>
                  {projects.map(p => {
                    const row = rows.find(r => r.projectId === p.id);
                    const hrs = row?.hours ?? 0;
                    return (
                      <td key={p.id} style={{
                        padding: "9px 10px",
                        textAlign: "center",
                        fontFamily: C.mono,
                        fontSize: 12,
                        color: hrs > 0 ? C.text : C.border,
                        borderBottom: `1px solid ${C.border}`,
                        fontWeight: hrs > 0 ? 600 : 400,
                      }}>
                        {hrs > 0 ? fmtH(hrs) : "—"}
                      </td>
                    );
                  })}
                  <td style={{
                    padding: "9px 10px",
                    textAlign: "center",
                    fontFamily: C.mono,
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.blue,
                    background: C.blueBg,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {fmtH(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
