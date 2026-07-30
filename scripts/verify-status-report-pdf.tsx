/**
 * Render check for the weekly status report PDF.
 *
 *   PDF_FONT_DIR=./public/fonts npx tsx scripts/verify-status-report-pdf.tsx
 *
 * Feeds synthetic-but-realistic NetSuite/ClickUp data through deriveStatusReport
 * and renders the real PDF component to a file, so layout or style errors surface
 * here rather than in front of a PM. Writes ./status-report-check.pdf.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { deriveStatusReport, EMPTY_BASELINES } from "../lib/status-report-derive";
import { StatusReportPdf } from "../components/reports/StatusReportPdf";
import { fridayOf, mondayOf, toISODate } from "../lib/status-report";
import type { CUTask, Project } from "../lib/types";

const weekEnding = fridayOf(new Date());
const monday     = mondayOf(new Date(weekEnding + "T00:00:00"));
const dayMs      = 86_400_000;
const at = (offsetDays: number) => String(monday.getTime() + offsetDays * dayMs);

let n = 0;
function task(over: Partial<CUTask> & { name: string }): CUTask {
  n++;
  return {
    id: `t${n}`,
    status: { status: "in progress", color: "#000" },
    due_date: at(2),
    assignees: [{ id: 1, username: "Jason Tutanes", color: "#000" }],
    tags: [],
    time_estimate: null,
    time_spent: null,
    url: `https://app.clickup.com/t/t${n}`,
    list: { id: "1", name: "Oxide" },
    ...over,
  };
}

const tasks: CUTask[] = [
  // Closed inside the reporting week → accomplishments
  task({ name: "ARM process end-to-end test",      status: { status: "done", color: "" }, date_done: at(1) }),
  task({ name: "Freight accrual process update",   status: { status: "done", color: "" }, date_done: at(3) }),
  task({ name: "Logistics working session",        status: { status: "done", color: "" }, date_done: at(2) }),
  // Open, Loop side
  task({ name: "Warranty process testing",         due_date: at(4) }),
  task({ name: "FAM & amortization prep",          due_date: at(9), assignees: [{ id: 1, username: "Jason Tutanes", color: "" }] }),
  // Blocked
  task({ name: "PO approval signature routing",    status: { status: "on hold", color: "" }, due_date: at(-3) }),
  // Awaiting the client
  task({ name: "Freight rate data from Vivian",    status: { status: "awaiting confirmation", color: "" }, due_date: at(1), assignees: [{ id: 9, username: "vivian.k", color: "" }] }),
  task({ name: "UAT retest sign-off",              status: { status: "input required", color: "" }, due_date: at(4), assignees: [{ id: 8, username: "todd.h", color: "" }] }),
  // Milestones
  task({ name: "Data Migration Kick-Off (Open Balances)", tags: [{ name: "milestone" }], due_date: at(12) }),
  task({ name: "Phase 3: Training and UAT Commence",      tags: [{ name: "milestone" }], status: { status: "done", color: "" }, due_date: at(-30), date_done: at(-28) }),
  // Meeting next week
  task({ name: "DocuSign scoping call",            due_date: at(7) }),
];

const isDone = (t: CUTask) => ["done", "complete"].includes(t.status.status.toLowerCase());

const project: Project = {
  id: 18999, entityid: "421",
  projectName: "NetSuite Implementation",
  label: "Oxide Computer Company — NetSuite Implementation",
  client: "Oxide Computer Company",
  projectType: "Implementation",
  pm: "Shai Aradais",
  goliveDate: toISODate(new Date(Date.now() + 46 * dayMs)),
  daysLeft: 46, isOverdue: false,
  budget_hours: 451, actual: 301, billableHours: 288, rem: 150,
  pct: tasks.filter(isDone).length / tasks.length,
  burnRate: 301 / 451, spi: 0.41, budgetGap: 0.4,
  score: 55, health: "yellow",
  nsUrl: "https://system.na1.netsuite.com/app/accounting/project/project.nl?id=18999",
  clickupUrl: "https://app.clickup.com/x/y", clickupListId: "1",
  tasks,
  blocked:       tasks.filter(t => ["on hold", "blocked"].includes(t.status.status.toLowerCase())),
  clientPending: tasks.filter(t => ["awaiting confirmation", "input required"].includes(t.status.status.toLowerCase())),
  milestones:    tasks.filter(t => t.tags.some(g => g.name === "milestone")),
  timebillWarning: true,
  notes: [], clickupError: null, slackCanvasId: null,
};

const nsPhases = [
  { phase_id: "1", phase_name: "PHASE 1 - Planning and Design",     budgeted_hours: "80",  actual_hours: "80",  phase_status: "COMPLETE" },
  { phase_id: "2", phase_name: "PHASE 2 - Configuration",           budgeted_hours: "114", actual_hours: "114", phase_status: "COMPLETE" },
  { phase_id: "3", phase_name: "PHASE 3 - Training and UAT",        budgeted_hours: "117", actual_hours: "107", phase_status: "IN PROGRESS" },
  { phase_id: "4", phase_name: "PHASE 4 - Readiness",               budgeted_hours: "70",  actual_hours: "0",   phase_status: "NOTSTART" },
  { phase_id: "5", phase_name: "PHASE 5 - Go Live & Stabilization", budgeted_hours: "70",  actual_hours: "0",   phase_status: "NOTSTART" },
];

// Exercise the "(was N)" re-baseline path and an original milestone date.
const baselines = {
  ...EMPTY_BASELINES,
  phases:     { "2": { hours: 130, label: "Configuration" }, "3": { hours: 91, label: "Training and UAT" } },
  milestones: { t9: { date: toISODate(new Date(monday.getTime() + 5 * dayMs)), label: "Data Migration Kick-Off" } },
};

const report = deriveStatusReport({
  project, nsPhases, baselines, prevReport: null, weekEnding,
  preparedBy: "Shai Aradais",
});

// Second pass with a prior week, to exercise the week-over-week delta block.
const withDelta = deriveStatusReport({
  project, nsPhases, baselines, weekEnding, preparedBy: "Shai Aradais",
  prevReport: {
    ...report,
    meta:  { ...report.meta, weekEnding: toISODate(new Date(monday.getTime() - 3 * dayMs)) },
    recap: { ...report.recap, overallStatus: "on_track", metrics: { ...report.recap.metrics, hoursLogged: 274, pctComplete: 0.2 } },
  },
});

console.log("── derived report ──");
console.log(`status          : ${withDelta.recap.overallStatus} (${withDelta.recap.statusReason})`);
console.log(`phase tracker   : ${withDelta.recap.phaseTracker.map(p => `P${p.number}:${p.state}`).join(" ")}`);
console.log(`accomplishments : ${withDelta.recap.accomplishments.length}`);
console.log(`deliverables    : loop ${withDelta.deliverables.loop.length} / customer ${withDelta.deliverables.customer.length}`);
console.log(`milestones      : ${withDelta.milestones.length} (extended: ${withDelta.milestones.filter(m => m.extended).length})`);
console.log(`next week       : ${withDelta.whatsNext.deliverables.length} deliverables, ${withDelta.whatsNext.meetings.length} meetings`);
console.log(`risks           : ${withDelta.risks.risks.length} (${withDelta.risks.risks.filter(r => r.severity === "high").length} high)`);
console.log(`budget rows     : ${withDelta.budget.rows.length}, rebaselined: ${withDelta.budget.rows.filter(r => r.originalAllocatedHours != null).map(r => r.name).join(", ") || "none"}`);
console.log(`actions         : ${withDelta.actions.items.length}`);
console.log(`delta           : ${JSON.stringify(withDelta.recap.delta)}`);

async function main() {
  const buf = await renderToBuffer(
    <StatusReportPdf report={withDelta} logoSrc={resolve("public/loop-services-logo.png")} />,
  );
  const out = resolve("status-report-check.pdf");
  writeFileSync(out, buf);
  console.log(`\n✓ rendered ${buf.length.toLocaleString()} bytes → ${out}`);
}

main().catch(err => { console.error(err); process.exit(1); });
