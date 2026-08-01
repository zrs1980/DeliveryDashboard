/**
 * Render check for the weekly status report PDF.
 *
 *   PDF_FONT_DIR=./public/fonts npx tsx scripts/verify-status-report-pdf.tsx
 *
 * Renders the real PDF component from synthetic data so layout and style errors
 * surface here rather than in front of a PM.
 *
 * Two scenarios, because the first version of this script only covered the happy
 * path and shipped two bugs to production:
 *
 *   "typical" — a normal project.
 *   "high volume" — enough rows to trigger EVERY "+N more" overflow note, plus a
 *     20-row projecttask tree with nested children. This is what caught (a) the
 *     italic fontStyle in the overflow note, which react-pdf throws on because no
 *     italic weight is registered, and (b) the uncapped budget table.
 *
 * Writes ./status-report-check.pdf (the high-volume one — the harder case).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { deriveStatusReport, EMPTY_BASELINES, type Baselines } from "../lib/status-report-derive";
import { StatusReportPdf } from "../components/reports/StatusReportPdf";
import { budgetTotals, fridayOf, mondayOf, toISODate, type StatusReport } from "../lib/status-report";
import type { CUTask, Project } from "../lib/types";

const weekEnding = fridayOf(new Date());
const monday     = mondayOf(new Date(weekEnding + "T00:00:00"));
const dayMs      = 86_400_000;
const at = (d: number) => String(monday.getTime() + d * dayMs);

let seq = 0;
function task(over: Partial<CUTask> & { name: string }): CUTask {
  seq++;
  return {
    id: `t${seq}`,
    status: { status: "in progress", color: "#000" },
    due_date: at(2),
    assignees: [{ id: 1, username: "Jason Tutanes", color: "#000" }],
    tags: [], time_estimate: null, time_spent: null,
    url: `https://app.clickup.com/t/t${seq}`,
    list: { id: "1", name: "L" },
    ...over,
  };
}

const done    = (n: string, closed: number) => task({ name: n, status: { status: "done", color: "" }, date_done: at(closed) });
const blocked = (n: string) => task({ name: n, status: { status: "on hold", color: "" }, due_date: at(-3) });
const client  = (n: string, d = 1) => task({ name: n, status: { status: "awaiting confirmation", color: "" }, due_date: at(d), assignees: [{ id: 9, username: "todd.h", color: "" }] });
const stone   = (n: string, d: number) => task({ name: n, tags: [{ name: "milestone" }], due_date: at(d) });

const isDoneT = (t: CUTask) => ["done", "complete"].includes(t.status.status.toLowerCase());

/** Mirrors what fetchProjectPhases() returns. */
type PhaseRow = {
  phase_id:       string;
  phase_name:     string;
  budgeted_hours: string;
  actual_hours:   string;
  phase_status:   string;
  parent_id:      string | null;
};

function project(tasks: CUTask[], over: Partial<Project> = {}): Project {
  return {
    id: 18999, entityid: "413",
    projectName: "NS Implementation Phase 2",
    label: "Salt and Stone — NS Implementation Phase 2",
    client: "Salt and Stone",
    projectType: "Implementation",
    pm: "Shai Aradais",
    goliveDate: toISODate(new Date(Date.now() + 46 * dayMs)),
    daysLeft: 46, isOverdue: false,
    budget_hours: 451, actual: 301, billableHours: 288, rem: 150,
    pct: tasks.filter(isDoneT).length / Math.max(1, tasks.length),
    burnRate: 301 / 451, spi: 0.41, budgetGap: 0.4,
    score: 55, health: "yellow",
    nsUrl: "", clickupUrl: null, clickupListId: null,
    tasks,
    blocked:       tasks.filter(t => ["on hold", "blocked"].includes(t.status.status.toLowerCase())),
    clientPending: tasks.filter(t => ["awaiting confirmation", "input required"].includes(t.status.status.toLowerCase())),
    milestones:    tasks.filter(t => t.tags.some(g => g.name === "milestone")),
    timebillWarning: true,
    notes: [], clickupError: null, slackCanvasId: null, projectFolderUrl: null,
    ...over,
  };
}

// ─── Scenario A: typical project ──────────────────────────────────────────────

const typicalTasks = [
  done("ARM process end-to-end test", 1),
  done("Freight accrual process update", 3),
  done("Logistics working session", 2),
  task({ name: "Warranty process testing", due_date: at(4) }),
  task({ name: "FAM & amortization prep", due_date: at(9) }),
  blocked("PO approval signature routing"),
  client("Freight rate data from Vivian"),
  client("UAT retest sign-off", 4),
  stone("Data Migration Kick-Off (Open Balances)", 12),
  task({ name: "DocuSign scoping call", due_date: at(7) }),
];

const typicalPhases: PhaseRow[] = [
  { phase_id: "1", phase_name: "PHASE 1 - Planning and Design",     budgeted_hours: "80",  actual_hours: "80",  phase_status: "COMPLETE",    parent_id: null },
  { phase_id: "2", phase_name: "PHASE 2 - Configuration",           budgeted_hours: "114", actual_hours: "114", phase_status: "COMPLETE",    parent_id: null },
  { phase_id: "3", phase_name: "PHASE 3 - Training and UAT",        budgeted_hours: "117", actual_hours: "107", phase_status: "IN PROGRESS", parent_id: null },
  { phase_id: "4", phase_name: "PHASE 4 - Readiness",               budgeted_hours: "70",  actual_hours: "0",   phase_status: "NOTSTART",    parent_id: null },
  { phase_id: "5", phase_name: "PHASE 5 - Go Live & Stabilization", budgeted_hours: "70",  actual_hours: "0",   phase_status: "NOTSTART",    parent_id: null },
];

// ─── Scenario B: high volume — every overflow path ────────────────────────────
// Mirrors the real Salt and Stone shape: 5 phases plus 15 nested task rows whose
// titles match the loose phase patterns ("design", "planning", "UAT", "PM"…).

const manyTasks: CUTask[] = [
  ...Array.from({ length: 9 },  (_, i) => done(`Completed deliverable ${i + 1} with a deliberately long name to test wrapping`, 1 + (i % 4))),
  ...Array.from({ length: 14 }, (_, i) => task({ name: `Open item ${i + 1} due inside the reporting week`, due_date: at(i % 5) })),
  ...Array.from({ length: 5 },  (_, i) => blocked(`Blocked item ${i + 1}`)),
  ...Array.from({ length: 6 },  (_, i) => client(`Client-side item ${i + 1} awaiting confirmation`, i % 5)),
  ...Array.from({ length: 12 }, (_, i) => stone(`Milestone ${i + 1} — a longer milestone label`, i - 4)),
  ...Array.from({ length: 10 }, (_, i) => task({ name: `Next-week deliverable ${i + 1}`, due_date: at(7 + (i % 5)) })),
  ...Array.from({ length: 4 },  (_, i) => task({ name: `Solutions walkthrough session ${i + 1}`, due_date: at(8 + i) })),
];

const manyPhases: PhaseRow[] = [
  ...typicalPhases,
  // Nested task rows that isPhaseRow() matches on title. selectPhaseRows must drop
  // these — summing them would double-count against the parent phase's actualwork.
  ...Array.from({ length: 15 }, (_, i) => ({
    phase_id: `child-${i}`,
    phase_name: ["Design review", "Planning workshop", "UAT cycle", "Project management", "Config testing"][i % 5] + ` ${i}`,
    budgeted_hours: "12", actual_hours: "9", phase_status: "IN PROGRESS",
    parent_id: String((i % 5) + 1),
  })),
];

// ─── Run ──────────────────────────────────────────────────────────────────────

const baselines: Baselines = {
  ...EMPTY_BASELINES,
  phases:     { "2": { hours: 130, label: "Configuration" }, "3": { hours: 91, label: "Training and UAT" } },
  milestones: { t9: { date: toISODate(new Date(monday.getTime() + 5 * dayMs)), label: "Data Migration Kick-Off" } },
};

function build(p: Project, phases: PhaseRow[], withPrev: boolean): StatusReport {
  const base = deriveStatusReport({ project: p, nsPhases: phases, baselines, prevReport: null, weekEnding, preparedBy: "Shai Aradais" });
  if (!withPrev) return base;
  return deriveStatusReport({
    project: p, nsPhases: phases, baselines, weekEnding, preparedBy: "Shai Aradais",
    prevReport: {
      ...base,
      meta:  { ...base.meta, weekEnding: toISODate(new Date(monday.getTime() - 3 * dayMs)) },
      recap: { ...base.recap, overallStatus: "on_track", metrics: { ...base.recap.metrics, hoursLogged: 274, pctComplete: 0.2 } },
    },
  });
}

function report(label: string, r: StatusReport) {
  const t = budgetTotals(r.budget.rows);
  console.log(`\n── ${label} ──`);
  console.log(`status          : ${r.recap.overallStatus}`);
  console.log(`phase tracker   : ${r.recap.phaseTracker.map(p => `P${p.number}:${p.state}`).join(" ")}`);
  console.log(`budget rows     : ${r.budget.rows.length}  (${r.budget.rows.map(x => x.name).join(" | ")})`);
  console.log(`budget totals   : allocated ${t.allocated} / actual ${t.actual} / remaining ${t.remaining}`);
  console.log(`rebaselined     : ${r.budget.rows.filter(x => x.originalAllocatedHours != null).map(x => `${x.name} (was ${x.originalAllocatedHours})`).join(", ") || "none"}`);
  console.log(`accomplishments : ${r.recap.accomplishments.length}`);
  console.log(`deliverables    : loop ${r.deliverables.loop.length} / customer ${r.deliverables.customer.length}`);
  console.log(`milestones      : ${r.milestones.length} (extended ${r.milestones.filter(m => m.extended).length})`);
  console.log(`next week       : ${r.whatsNext.deliverables.length} deliverables, ${r.whatsNext.meetings.length} meetings`);
  console.log(`risks           : ${r.risks.risks.length} (${r.risks.risks.filter(x => x.severity === "high").length} high)`);
  console.log(`actions         : ${r.actions.items.length}`);
}

/**
 * Static font-style guard.
 *
 * Node can't reach /fonts/*.ttf, so this script always renders under react-pdf's
 * Helvetica fallback — and Helvetica HAS an oblique. That means a `fontStyle:
 * "italic"` renders fine here and then throws in the browser, where DM Sans is
 * registered with weights only. Exactly how that bug reached production. Check the
 * stylesheet directly instead of relying on the render.
 */
function assertFontStylesAreRegistered() {
  const path = "components/reports/StatusReportPdf.tsx";
  const src  = readFileSync(path, "utf8");

  const styles = src.match(/fontStyle\s*:/g);
  if (styles) {
    throw new Error(
      `${path} uses fontStyle ${styles.length}×, but only regular/medium/bold DM Sans ` +
      `is registered — react-pdf will throw "Could not resolve font" in the browser. ` +
      `Register an italic face or drop the style.`,
    );
  }

  const registered = new Set([...src.matchAll(/fontWeight:\s*(\d+)\s*\}/g)].map(m => m[1]));
  const used       = new Set([...src.matchAll(/fontWeight:\s*(\d+)/g)].map(m => m[1]));
  const missing    = [...used].filter(w => !registered.has(w));
  if (missing.length) {
    throw new Error(`${path} uses unregistered fontWeight(s): ${missing.join(", ")} (registered: ${[...registered].join(", ")})`);
  }

  console.log(`✓ font styles: no italics, weights ${[...used].sort().join("/")} all registered`);
}

async function main() {
  assertFontStylesAreRegistered();

  const typical = build(project(typicalTasks), typicalPhases, true);
  const heavy   = build(project(manyTasks), manyPhases, true);

  report("typical", typical);
  report("high volume", heavy);

  // The whole point of scenario B: 20 projecttask rows must collapse to 5 phases,
  // and the totals must match the parent phases alone (451h), not 451 + children.
  const n = heavy.budget.rows.length;
  const allocated = budgetTotals(heavy.budget.rows).allocated;
  if (n !== 5)          throw new Error(`expected 5 phase rows from a 20-row task tree, got ${n}`);
  if (allocated !== 451) throw new Error(`phase children are being double-counted: allocated ${allocated}, expected 451`);
  console.log("\n✓ 20-row projecttask tree collapsed to 5 phases, no double-counting");

  const logo = resolve("public/loop-services-logo.png");
  for (const [name, r] of [["typical", typical], ["high volume", heavy]] as const) {
    const buf = await renderToBuffer(<StatusReportPdf report={r} logoSrc={logo} />);
    console.log(`✓ ${name.padEnd(12)} rendered ${buf.length.toLocaleString()} bytes`);
    if (name === "high volume") writeFileSync(resolve("status-report-check.pdf"), buf);
  }
  console.log(`\n✓ wrote ${resolve("status-report-check.pdf")}`);
}

main().catch(err => { console.error("\n✗", err.message ?? err); process.exit(1); });
