// ─── Weekly Status Report — Claude integration (server-only) ──────────────────
//
// One shared contract for both /draft and /refine: Claude returns a *patch* whose
// top-level keys are report sections. Each provided field replaces the existing
// one (arrays wholesale), so the result is predictable and never half-merged.
//
// Deliberately NOT patchable: budget.rows, recap.metrics and recap.phaseTracker.
// Those are NetSuite facts — the model may describe them but must never restate
// them, or the deck would show numbers that don't reconcile with NetSuite.

import type Anthropic from "@anthropic-ai/sdk";
import {
  type ActionItem, type Bullet, type Deliverable, type DeliverableState,
  type Meeting, type MilestoneRow, type MilestoneState, type OverallStatus,
  type Risk, type Severity, type StatusReport,
  budgetTotals, fmtHrs, fmtShort, newId,
} from "./status-report";

export const REPORT_MODEL = "claude-sonnet-4-6";

// ─── Tool schema ──────────────────────────────────────────────────────────────

const bulletSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      lead:   { type: "string", description: "Short bolded lead-in, 2–6 words. No trailing colon." },
      detail: { type: "string", description: "One sentence of supporting detail." },
    },
    required: ["lead", "detail"],
  },
} as const;

const PATCH_SCHEMA = {
  type: "object",
  properties: {
    recap: {
      type: "object",
      description: "Section 1 — quick recap of project status.",
      properties: {
        overallStatus: { type: "string", enum: ["on_track", "at_risk", "critical"] },
        statusReason:  { type: "string", description: "One sentence justifying the RAG status." },
        keyMessage:    { type: "string", description: "3–5 sentence narrative for the client. Name people and dates. No bullet points." },
        accomplishments: { ...bulletSchema, description: "What was delivered this week, most significant first. Max 6." },
      },
    },
    deliverables: {
      type: "object",
      description: "Section 2 — Loop Services deliverables vs the customer's.",
      properties: {
        loop:     { $ref: "#/$defs/deliverableList" },
        customer: { $ref: "#/$defs/deliverableList" },
      },
    },
    whatsNext: {
      type: "object",
      description: "Section 3 — the upcoming week.",
      properties: {
        phase: { type: "string", description: "Current phase, or a 'Phase A → Phase B' transition." },
        focus: { type: "string", description: "1–2 sentences on next week's focus." },
        deliverables: { ...bulletSchema, description: "What will be delivered next week. Max 6." },
        meetings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title:     { type: "string" },
              date:      { type: ["string", "null"], description: "YYYY-MM-DD" },
              attendees: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
    },
    risks: {
      type: "object",
      description: "Section 4 — risk review and assessment.",
      properties: {
        assessment: { type: "string", description: "2–3 sentence overall risk assessment naming the top risks." },
        risks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title:      { type: "string", description: "Short risk name." },
              severity:   { type: "string", enum: ["high", "medium", "low"] },
              impact:     { type: "string", description: "Concrete consequence if unmitigated." },
              mitigation: { type: "string", description: "Specific action, starting with a verb." },
              owner:      { type: "string" },
            },
            required: ["title", "severity", "impact", "mitigation", "owner"],
          },
        },
      },
    },
    budget: {
      type: "object",
      description: "Section 5 — budget commentary only. Hour figures come from NetSuite and cannot be changed here.",
      properties: {
        note:        { type: "string" },
        dataWarning: { type: ["string", "null"] },
      },
    },
    milestones: {
      type: "array",
      description: "Milestone table rows.",
      items: {
        type: "object",
        properties: {
          name:        { type: "string" },
          highlight:   { type: "string", description: "Short description of what the milestone covers." },
          estDueDate:  { type: ["string", "null"], description: "YYYY-MM-DD" },
          origDueDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
          status:      { type: "string", enum: ["complete", "in_progress", "on_track", "at_risk", "upcoming"] },
        },
        required: ["name", "status"],
      },
    },
    actions: {
      type: "object",
      description: "Section 6 — recap and action items.",
      properties: {
        recap: { type: "string", description: "2–3 sentence closing recap of the week and what must happen next." },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action:    { type: "string", description: "Action starting with a verb." },
              owner:     { type: "string" },
              ownerSide: { type: "string", enum: ["loop", "customer"] },
              dueDate:   { type: ["string", "null"], description: "YYYY-MM-DD" },
              status:    { type: "string" },
            },
            required: ["action", "owner", "ownerSide"],
          },
        },
      },
    },
  },
  $defs: {
    deliverableList: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title:   { type: "string" },
          owner:   { type: "string" },
          status:  { type: "string", description: "Human-readable status label." },
          dueDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
          state:   { type: "string", enum: ["done", "in_progress", "blocked", "pending"] },
          note:    { type: "string" },
        },
        required: ["title", "owner", "state"],
      },
    },
  },
} as const;

export const WRITE_REPORT_TOOL: Anthropic.Tool = {
  name: "write_report_sections",
  description:
    "Write or rewrite sections of the weekly project status report. Only include the sections and " +
    "fields you are changing — anything omitted is left exactly as it is.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "One or two sentences for the PM explaining what you changed. Plain text, no markdown.",
      },
      patch: PATCH_SCHEMA,
    },
    required: ["reply", "patch"],
  } as Anthropic.Tool.InputSchema,
};

// ─── Sanitising and merging ───────────────────────────────────────────────────

const str  = (v: unknown, fb = ""): string => (typeof v === "string" ? v : fb);
const nstr = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fb: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fb;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const OVERALL: readonly OverallStatus[]     = ["on_track", "at_risk", "critical"];
const SEVERITIES: readonly Severity[]       = ["high", "medium", "low"];
const MSTATES: readonly MilestoneState[]    = ["complete", "in_progress", "on_track", "at_risk", "upcoming"];
const DSTATES: readonly DeliverableState[]  = ["done", "in_progress", "blocked", "pending"];

/** Keep an existing id when the model echoes one back, otherwise mint a fresh one. */
const idOf = (raw: Record<string, unknown>, prefix: string) =>
  typeof raw.id === "string" && raw.id ? raw.id : newId(prefix);

const toBullets = (v: unknown): Bullet[] =>
  arr(v).map(x => {
    const o = obj(x);
    return { id: idOf(o, "b"), lead: str(o.lead), detail: str(o.detail) };
  }).filter(b => b.lead || b.detail);

const toDeliverables = (v: unknown): Deliverable[] =>
  arr(v).map(x => {
    const o = obj(x);
    return {
      id:      idOf(o, "d"),
      title:   str(o.title),
      owner:   str(o.owner, "Unassigned"),
      status:  str(o.status),
      dueDate: nstr(o.dueDate),
      state:   oneOf(o.state, DSTATES, "pending"),
      note:    str(o.note),
    };
  }).filter(d => d.title);

const toMeetings = (v: unknown): Meeting[] =>
  arr(v).map(x => {
    const o = obj(x);
    return { id: idOf(o, "mtg"), title: str(o.title), date: nstr(o.date), attendees: str(o.attendees) };
  }).filter(m => m.title);

const toRisks = (v: unknown): Risk[] =>
  arr(v).map(x => {
    const o = obj(x);
    return {
      id:         idOf(o, "risk"),
      title:      str(o.title),
      severity:   oneOf(o.severity, SEVERITIES, "medium"),
      impact:     str(o.impact),
      mitigation: str(o.mitigation),
      owner:      str(o.owner),
      source:     o.source === "auto" ? "auto" as const : "manual" as const,
    };
  }).filter(r => r.title);

const toMilestones = (v: unknown): MilestoneRow[] =>
  arr(v).map(x => {
    const o = obj(x);
    const est  = nstr(o.estDueDate);
    const orig = nstr(o.origDueDate);
    return {
      id:          idOf(o, "ms"),
      name:        str(o.name),
      highlight:   str(o.highlight),
      estDueDate:  est,
      origDueDate: orig,
      status:      oneOf(o.status, MSTATES, "upcoming"),
      extended:    !!(est && orig && est > orig),
    };
  }).filter(m => m.name);

const toActions = (v: unknown): ActionItem[] =>
  arr(v).map(x => {
    const o = obj(x);
    return {
      id:        idOf(o, "act"),
      action:    str(o.action),
      owner:     str(o.owner),
      ownerSide: oneOf(o.ownerSide, ["loop", "customer"] as const, "loop"),
      dueDate:   nstr(o.dueDate),
      status:    str(o.status, "Open"),
    };
  }).filter(a => a.action);

/**
 * Apply a model-produced patch onto a report. Every value is re-validated here —
 * the model is never trusted to have produced a well-formed section.
 */
export function applyPatch(report: StatusReport, rawPatch: unknown): StatusReport {
  const patch = obj(rawPatch);
  const next: StatusReport = { ...report };

  if (patch.recap) {
    const p = obj(patch.recap);
    next.recap = {
      ...report.recap,
      ...(p.overallStatus !== undefined && { overallStatus: oneOf(p.overallStatus, OVERALL, report.recap.overallStatus) }),
      ...(p.statusReason  !== undefined && { statusReason: str(p.statusReason, report.recap.statusReason) }),
      ...(p.keyMessage    !== undefined && { keyMessage: str(p.keyMessage, report.recap.keyMessage) }),
      ...(p.accomplishments !== undefined && { accomplishments: toBullets(p.accomplishments) }),
      // metrics and phaseTracker are NetSuite/ClickUp facts — never patched.
      metrics:      report.recap.metrics,
      phaseTracker: report.recap.phaseTracker,
      delta:        report.recap.delta,
    };
  }

  if (patch.deliverables) {
    const p = obj(patch.deliverables);
    next.deliverables = {
      loop:     p.loop     !== undefined ? toDeliverables(p.loop)     : report.deliverables.loop,
      customer: p.customer !== undefined ? toDeliverables(p.customer) : report.deliverables.customer,
    };
  }

  if (patch.whatsNext) {
    const p = obj(patch.whatsNext);
    next.whatsNext = {
      ...report.whatsNext,
      ...(p.phase !== undefined && { phase: str(p.phase, report.whatsNext.phase) }),
      ...(p.focus !== undefined && { focus: str(p.focus, report.whatsNext.focus) }),
      ...(p.deliverables !== undefined && { deliverables: toBullets(p.deliverables) }),
      ...(p.meetings     !== undefined && { meetings: toMeetings(p.meetings) }),
    };
  }

  if (patch.risks) {
    const p = obj(patch.risks);
    next.risks = {
      assessment: p.assessment !== undefined ? str(p.assessment, report.risks.assessment) : report.risks.assessment,
      risks:      p.risks      !== undefined ? toRisks(p.risks) : report.risks.risks,
    };
  }

  if (patch.budget) {
    const p = obj(patch.budget);
    next.budget = {
      ...report.budget,
      ...(p.note        !== undefined && { note: str(p.note, report.budget.note) }),
      ...(p.dataWarning !== undefined && { dataWarning: nstr(p.dataWarning) }),
      rows: report.budget.rows,   // NetSuite hours — never patched.
    };
  }

  if (patch.milestones !== undefined) {
    const ms = toMilestones(patch.milestones);
    // Preserve captured baselines: the model may not echo origDueDate back.
    next.milestones = ms.map(m => {
      const existing = report.milestones.find(x => x.id === m.id);
      const orig = m.origDueDate ?? existing?.origDueDate ?? m.estDueDate;
      return { ...m, origDueDate: orig, extended: !!(m.estDueDate && orig && m.estDueDate > orig) };
    });
  }

  if (patch.actions) {
    const p = obj(patch.actions);
    next.actions = {
      recap: p.recap !== undefined ? str(p.recap, report.actions.recap) : report.actions.recap,
      items: p.items !== undefined ? toActions(p.items) : report.actions.items,
    };
  }

  return next;
}

// ─── Prompt context ───────────────────────────────────────────────────────────

/** Compact, factual snapshot of the report for the model to reason over. */
export function reportContext(r: StatusReport): string {
  const m = r.recap.metrics;
  const t = budgetTotals(r.budget.rows);

  const lines = [
    `PROJECT: ${r.meta.projectLabel} (${r.meta.projectType}), PM ${r.meta.pm || "unassigned"}`,
    `REPORTING WEEK: ${r.meta.weekStarting} to ${r.meta.weekEnding}`,
    `GO-LIVE: ${r.meta.goLiveDate ? `${fmtShort(r.meta.goLiveDate)}${r.meta.daysToGoLive != null ? ` (${r.meta.daysToGoLive} days out)` : ""}` : "NOT SET"}`,
    `CURRENT PHASE: ${r.whatsNext.phase}`,
    `PHASES: ${r.recap.phaseTracker.map(p => `P${p.number} ${p.name} [${p.state}]`).join(" | ")}`,
    ``,
    `DERIVED STATUS: ${r.recap.overallStatus} — ${r.recap.statusReason}`,
    `PROGRESS: ${m.tasksDone}/${m.tasksTotal} tasks done (${Math.round(m.pctComplete * 100)}%), ${m.tasksClosedThisWeek} closed this week`,
    `HOURS: ${fmtHrs(m.hoursLogged)} logged of ${fmtHrs(m.hoursBudget)} budget, ${fmtHrs(m.hoursRemaining)} remaining, burn ${Math.round(m.burnRate * 100)}%, SPI ${m.spi.toFixed(2)}`,
  ];

  if (r.recap.delta) {
    const d = r.recap.delta;
    lines.push(
      `LAST WEEK (${d.prevWeekEnding}): status ${d.prevOverallStatus}, ${d.prevPctComplete != null ? Math.round(d.prevPctComplete * 100) + "%" : "?"} complete` +
      `; this week burned ${d.hoursBurnedThisWeek ?? "?"}h and gained ${d.pctPointsGained ?? "?"} percentage points`,
    );
  }

  lines.push(
    ``,
    `PHASE BUDGET (from NetSuite — do not restate different numbers):`,
    ...r.budget.rows.map(b =>
      `  ${b.name}: allocated ${fmtHrs(b.allocatedHours)}${b.originalAllocatedHours != null ? ` (was ${fmtHrs(b.originalAllocatedHours)})` : ""}, actual ${fmtHrs(b.actualHours)}, remaining ${fmtHrs(b.remainingHours)} — ${b.status}`),
    `  TOTAL: allocated ${fmtHrs(t.allocated)}, actual ${fmtHrs(t.actual)}, remaining ${fmtHrs(t.remaining)}`,
  );

  if (r.recap.accomplishments.length) {
    lines.push(``, `CLOSED THIS WEEK:`, ...r.recap.accomplishments.map(a => `  - ${a.lead} — ${a.detail}`));
  }

  if (r.deliverables.loop.length) {
    lines.push(``, `LOOP SERVICES DELIVERABLES THIS WEEK:`,
      ...r.deliverables.loop.map(d => `  - ${d.title} [${d.state}] owner ${d.owner}${d.dueDate ? ` due ${d.dueDate}` : ""}${d.note ? ` (${d.note})` : ""}`));
  }

  if (r.deliverables.customer.length) {
    lines.push(``, `CUSTOMER DELIVERABLES / AWAITING CLIENT:`,
      ...r.deliverables.customer.map(d => `  - ${d.title} [${d.state}] owner ${d.owner}${d.dueDate ? ` due ${d.dueDate}` : ""}${d.note ? ` (${d.note})` : ""}`));
  }

  if (r.whatsNext.deliverables.length) {
    lines.push(``, `DUE NEXT WEEK:`, ...r.whatsNext.deliverables.map(d => `  - ${d.lead} — ${d.detail}`));
  }

  if (r.whatsNext.meetings.length) {
    lines.push(``, `SCHEDULED MEETINGS:`, ...r.whatsNext.meetings.map(x => `  - ${x.title}${x.date ? ` on ${x.date}` : ""}${x.attendees ? ` with ${x.attendees}` : ""}`));
  }

  if (r.milestones.length) {
    lines.push(``, `MILESTONES:`,
      ...r.milestones.map(x => `  - ${x.name}: est ${x.estDueDate ?? "—"}, orig ${x.origDueDate ?? "—"}, ${x.status}${x.extended ? " (EXTENDED)" : ""}`));
  }

  if (r.risks.risks.length) {
    lines.push(``, `RISKS DETECTED FROM PROJECT DATA:`,
      ...r.risks.risks.map(x => `  - [${x.severity}] ${x.title}: ${x.impact}`));
  }

  if (r.budget.dataWarning) lines.push(``, `DATA WARNING: ${r.budget.dataWarning}`);

  return lines.join("\n");
}

export const SYSTEM_PROMPT =
  `You are a senior NetSuite implementation PM at Loop Services, writing the weekly project status ` +
  `report that goes to the client. Loop Services is the delivery partner; the client is the customer.

Voice and standards:
- Write for a client audience: direct, factual, no hedging and no internal jargon.
- Name people, dates and deliverables specifically. "Todd to retest the resolved tickets by Jul 24" beats "testing continues".
- Never invent facts. Every claim must trace to the project data you are given.
- Hour figures, task counts and phase budgets come from NetSuite and ClickUp. Describe them; never restate them with different numbers.
- If the data is thin for a section, say plainly what is known rather than padding it.
- Bullet leads are short noun phrases or verb phrases without a trailing colon; the detail carries the sentence.
- Dates in data fields must be YYYY-MM-DD. Dates in prose should read naturally, e.g. "July 24".

Always respond by calling the write_report_sections tool. Only include the fields you are changing.`;

/** Pull the tool input out of a message, or null if the model didn't call it. */
export function extractToolInput(message: Anthropic.Message): { reply: string; patch: unknown } | null {
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === WRITE_REPORT_TOOL.name) {
      const input = obj(block.input);
      return { reply: str(input.reply, "Updated the report."), patch: input.patch };
    }
  }
  return null;
}
