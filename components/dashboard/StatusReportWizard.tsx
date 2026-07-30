"use client";
// ─── Weekly Status Report wizard ──────────────────────────────────────────────
//
// Opens from a project in the PM tab. Pulls NetSuite phase budgets and ClickUp
// task detail into a pre-populated draft, has Claude write the narrative, lets
// the PM edit every field, and renders a branded Loop Services PDF.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { C } from "@/lib/constants";
import type { Project } from "@/lib/types";
import {
  type ActionItem, type Bullet, type Deliverable, type DeliverableState,
  type Meeting, type MilestoneRow, type MilestoneState, type OverallStatus,
  type Risk, type Severity, type StatusReport,
  budgetTotals, fmtHrs, fmtLong, fridayOf, newId,
} from "@/lib/status-report";

const StatusReportPreview = dynamic(
  () => import("@/components/reports/StatusReportPreview").then(m => m.StatusReportPreview),
  {
    ssr: false,
    loading: () => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.textSub, fontSize: 13 }}>
        Loading PDF renderer…
      </div>
    ),
  },
);

// ─── Steps ────────────────────────────────────────────────────────────────────

type SectionKey = "recap" | "deliverables" | "milestones" | "whatsNext" | "risks" | "budget" | "actions" | "review";

const STEPS: Array<{ key: SectionKey; num: string; label: string; hint: string }> = [
  { key: "recap",        num: "1", label: "Quick Recap",      hint: "Status, key message, accomplishments" },
  { key: "deliverables", num: "2", label: "Deliverables",     hint: "Loop Services vs customer" },
  { key: "milestones",   num: "3", label: "Milestones",       hint: "Est. vs original due dates" },
  { key: "whatsNext",    num: "4", label: "What's Next",      hint: "Phase, deliverables, meetings" },
  { key: "risks",        num: "5", label: "Risks",            hint: "Severity, impact, mitigation" },
  { key: "budget",       num: "6", label: "Budget",           hint: "Phase hours from NetSuite" },
  { key: "actions",      num: "7", label: "Recap & Actions",  hint: "Closing summary and owners" },
  { key: "review",       num: "✓", label: "Review & Send",    hint: "Preview and download the PDF" },
];

// ─── UI primitives ────────────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`,
  fontSize: 13, fontFamily: C.font, color: C.text, background: "#fff",
  outline: "none", boxSizing: "border-box",
};

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {children}
      </span>
      {hint && <span style={{ fontSize: 11, color: C.textSub, fontWeight: 400, marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>{hint}</span>}
    </div>
  );
}

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} style={{ ...inputBase, ...p.style }} />;
}

function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} style={{ ...inputBase, resize: "vertical", lineHeight: 1.55, ...p.style }} />;
}

function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} style={{ ...inputBase, cursor: "pointer", ...p.style }} />;
}

function SectionCard({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14, boxShadow: C.sh }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: C.textSub, marginTop: 2 }}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Repeatable row editor: add, remove, reorder. */
function ListEditor<T extends { id: string }>({
  items, onChange, blank, addLabel, render, empty,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  blank: () => T;
  addLabel: string;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode;
  empty?: string;
}) {
  const update = (i: number, patch: Partial<T>) =>
    onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const miniBtn: React.CSSProperties = {
    width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface,
    color: C.textSub, fontSize: 11, cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0,
  };

  return (
    <div>
      {items.length === 0 && (
        <div style={{ fontSize: 12, color: C.textSub, padding: "10px 0 14px" }}>{empty ?? "Nothing here yet."}</div>
      )}

      {items.map((item, i) => (
        <div
          key={item.id}
          style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}
        >
          <div style={{ fontSize: 11, fontFamily: C.mono, color: C.textSub, width: 16, paddingTop: 9, flexShrink: 0 }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>{render(item, patch => update(i, patch), i)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 6 }}>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={{ ...miniBtn, opacity: i === 0 ? 0.35 : 1 }} title="Move up">↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} style={{ ...miniBtn, opacity: i === items.length - 1 ? 0.35 : 1 }} title="Move down">↓</button>
            <button type="button" onClick={() => remove(i)} style={{ ...miniBtn, color: C.red, borderColor: C.redBd, background: C.redBg }} title="Remove">×</button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...items, blank()])}
        style={{ marginTop: 10, padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", background: C.blueBg, color: C.blue, border: `1px solid ${C.blueBd}` }}
      >
        + {addLabel}
      </button>
    </div>
  );
}

function BulletFields({ item, update }: { item: Bullet; update: (p: Partial<Bullet>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Input value={item.lead} onChange={e => update({ lead: e.target.value })} placeholder="Bolded lead-in" style={{ fontWeight: 600 }} />
      <Textarea value={item.detail} onChange={e => update({ detail: e.target.value })} placeholder="Supporting detail" rows={2} style={{ fontSize: 12 }} />
    </div>
  );
}

// ─── Step: Quick recap ────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ v: OverallStatus; l: string }> = [
  { v: "on_track", l: "🟢 On Track" },
  { v: "at_risk",  l: "🟡 At Risk" },
  { v: "critical", l: "🔴 Critical" },
];

function StepRecap({ report, set }: { report: StatusReport; set: (r: StatusReport) => void }) {
  const r = report.recap;
  const patch = (p: Partial<typeof r>) => set({ ...report, recap: { ...r, ...p } });
  const m = r.metrics;

  return (
    <div>
      <SectionCard
        title="Overall status"
        sub="Suggested from the health score — override if you know better."
      >
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14 }}>
          <div>
            <Label>Status</Label>
            <Select value={r.overallStatus} onChange={e => patch({ overallStatus: e.target.value as OverallStatus })}>
              {STATUS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </Select>
          </div>
          <div>
            <Label>Reason</Label>
            <Input value={r.statusReason} onChange={e => patch({ statusReason: e.target.value })} placeholder="One sentence justifying the status" />
          </div>
        </div>

        {/* Read-only metric strip from NetSuite + ClickUp */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          {[
            { l: "Complete",       v: `${Math.round(m.pctComplete * 100)}%` },
            { l: "Tasks",          v: `${m.tasksDone}/${m.tasksTotal}` },
            { l: "Closed in week", v: String(m.tasksClosedThisWeek) },
            { l: "Hours logged",   v: fmtHrs(m.hoursLogged) },
            { l: "Remaining",      v: fmtHrs(m.hoursRemaining) },
            { l: "SPI",            v: m.spi.toFixed(2) },
          ].map(x => (
            <div key={x.l} style={{ background: C.alt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px" }}>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: C.mono, color: C.text }}>{x.v}</div>
              <div style={{ fontSize: 10, color: C.textSub }}>{x.l}</div>
            </div>
          ))}
          <div style={{ flex: 1, minWidth: 140, display: "flex", alignItems: "center", fontSize: 11, color: C.textSub, paddingLeft: 4 }}>
            Live from NetSuite &amp; ClickUp — not editable
          </div>
        </div>

        {r.delta && (
          <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 7, background: C.blueBg, border: `1px solid ${C.blueBd}`, fontSize: 12, color: C.blue }}>
            Since last week&apos;s report ({fmtLong(r.delta.prevWeekEnding)}):{" "}
            {r.delta.hoursBurnedThisWeek != null ? <strong>{r.delta.hoursBurnedThisWeek}h logged</strong> : "hours unchanged"}
            {r.delta.pctPointsGained != null && <>, <strong>{r.delta.pctPointsGained >= 0 ? "+" : ""}{r.delta.pctPointsGained}pp</strong> progress</>}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Key message" sub="The paragraph the client reads first.">
        <Textarea value={r.keyMessage} onChange={e => patch({ keyMessage: e.target.value })} rows={6} />
      </SectionCard>

      <SectionCard title="Accomplishments this week" sub={`${m.tasksClosedThisWeek} task(s) closed inside the reporting week.`}>
        <ListEditor
          items={r.accomplishments}
          onChange={accomplishments => patch({ accomplishments })}
          blank={() => ({ id: newId("acc"), lead: "", detail: "" })}
          addLabel="Add accomplishment"
          empty="Nothing closed inside this week. Add anything delivered that isn't tracked as a task."
          render={(item, update) => <BulletFields item={item} update={update} />}
        />
      </SectionCard>
    </div>
  );
}

// ─── Step: Deliverables ───────────────────────────────────────────────────────

const DSTATES: Array<{ v: DeliverableState; l: string }> = [
  { v: "done",        l: "Done" },
  { v: "in_progress", l: "In Progress" },
  { v: "blocked",     l: "Blocked" },
  { v: "pending",     l: "Pending" },
];

function DeliverableFields({ item, update }: { item: Deliverable; update: (p: Partial<Deliverable>) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Input value={item.title} onChange={e => update({ title: e.target.value })} placeholder="Deliverable" style={{ fontWeight: 600 }} />
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 6 }}>
        <Input value={item.owner} onChange={e => update({ owner: e.target.value })} placeholder="Owner" style={{ fontSize: 12 }} />
        <Select value={item.state} onChange={e => update({ state: e.target.value as DeliverableState })} style={{ fontSize: 12 }}>
          {DSTATES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </Select>
        <Input type="date" value={item.dueDate ?? ""} onChange={e => update({ dueDate: e.target.value || null })} style={{ fontSize: 12 }} />
      </div>
      <Input value={item.note} onChange={e => update({ note: e.target.value })} placeholder="Note (optional)" style={{ fontSize: 12 }} />
    </div>
  );
}

function StepDeliverables({ report, set }: { report: StatusReport; set: (r: StatusReport) => void }) {
  const d = report.deliverables;
  const patch = (p: Partial<typeof d>) => set({ ...report, deliverables: { ...d, ...p } });
  const blank = (): Deliverable => ({ id: newId("d"), title: "", owner: "", status: "", dueDate: null, state: "pending", note: "" });
  const doneCount = (xs: Deliverable[]) => xs.filter(x => x.state === "done").length;

  return (
    <div>
      <div style={{ padding: "10px 14px", background: C.blueBg, border: `1px solid ${C.blueBd}`, borderRadius: 8, fontSize: 12, color: C.blue, marginBottom: 14 }}>
        Split from ClickUp by assignee — Loop Services consultants on one side, client-tagged and
        awaiting-client work on the other. Move anything that landed on the wrong side.
      </div>

      <SectionCard
        title="Loop Services deliverables"
        sub="What we committed to this week."
        right={<span style={{ fontSize: 12, fontFamily: C.mono, color: C.textSub }}>{doneCount(d.loop)}/{d.loop.length} done</span>}
      >
        <ListEditor
          items={d.loop}
          onChange={loop => patch({ loop })}
          blank={blank}
          addLabel="Add Loop deliverable"
          empty="No Loop Services deliverables fell in this week."
          render={(item, update) => <DeliverableFields item={item} update={update} />}
        />
      </SectionCard>

      <SectionCard
        title={`${report.meta.client} deliverables`}
        sub="What the client committed to this week."
        right={<span style={{ fontSize: 12, fontFamily: C.mono, color: C.textSub }}>{doneCount(d.customer)}/{d.customer.length} done</span>}
      >
        <ListEditor
          items={d.customer}
          onChange={customer => patch({ customer })}
          blank={blank}
          addLabel="Add customer deliverable"
          empty="No client-side deliverables detected. Add data hand-offs, approvals or sign-offs you're waiting on."
          render={(item, update) => <DeliverableFields item={item} update={update} />}
        />
      </SectionCard>
    </div>
  );
}

// ─── Step: Milestones ─────────────────────────────────────────────────────────

const MSTATES: Array<{ v: MilestoneState; l: string }> = [
  { v: "complete",    l: "Complete" },
  { v: "in_progress", l: "In Progress" },
  { v: "on_track",    l: "On Track" },
  { v: "at_risk",     l: "At Risk" },
  { v: "upcoming",    l: "Upcoming" },
];

function StepMilestones({ report, set }: { report: StatusReport; set: (r: StatusReport) => void }) {
  const setRows = (milestones: MilestoneRow[]) =>
    set({
      ...report,
      milestones: milestones.map(m => ({
        ...m,
        extended: !!(m.estDueDate && m.origDueDate && m.estDueDate > m.origDueDate),
      })),
    });

  return (
    <div>
      <div style={{ padding: "10px 14px", background: C.purpleBg, border: `1px solid ${C.purpleBd}`, borderRadius: 8, fontSize: 12, color: C.purple, marginBottom: 14 }}>
        <strong>Original due dates are baselined automatically.</strong> The first time you generate a report
        for this project the current dates are stored, so later slips show as <em>(ext.)</em> in the deck.
      </div>

      <SectionCard title="Milestone tracker" sub="Sourced from ClickUp tasks tagged `milestone`.">
        <ListEditor
          items={report.milestones}
          onChange={setRows}
          blank={(): MilestoneRow => ({ id: newId("ms"), name: "", highlight: "", estDueDate: null, origDueDate: null, status: "upcoming", extended: false })}
          addLabel="Add milestone"
          empty="No ClickUp tasks are tagged `milestone`. Add the milestones manually, or tag them in ClickUp and regenerate."
          render={(item, update) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Input value={item.name} onChange={e => update({ name: e.target.value })} placeholder="Milestone" style={{ fontWeight: 600 }} />
              <Input value={item.highlight} onChange={e => update({ highlight: e.target.value })} placeholder="Highlight — what this milestone covers" style={{ fontSize: 12 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, alignItems: "end" }}>
                <div>
                  <Label>Est. due</Label>
                  <Input type="date" value={item.estDueDate ?? ""} onChange={e => update({ estDueDate: e.target.value || null })} style={{ fontSize: 12 }} />
                </div>
                <div>
                  <Label>Orig. due</Label>
                  <Input type="date" value={item.origDueDate ?? ""} onChange={e => update({ origDueDate: e.target.value || null })} style={{ fontSize: 12 }} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={item.status} onChange={e => update({ status: e.target.value as MilestoneState })} style={{ fontSize: 12 }}>
                    {MSTATES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </Select>
                </div>
              </div>
              {item.extended && (
                <div style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>⚠ Slipped from the original date — will render as “(ext.)”</div>
              )}
            </div>
          )}
        />
      </SectionCard>
    </div>
  );
}

// ─── Step: What's next ────────────────────────────────────────────────────────

function StepWhatsNext({ report, set }: { report: StatusReport; set: (r: StatusReport) => void }) {
  const w = report.whatsNext;
  const patch = (p: Partial<typeof w>) => set({ ...report, whatsNext: { ...w, ...p } });

  return (
    <div>
      <SectionCard title="Phase &amp; focus" sub="Where the project sits, and where it's heading next week.">
        <Label>Phase</Label>
        <Input value={w.phase} onChange={e => patch({ phase: e.target.value })} placeholder="Phase 3: Training & UAT → Phase 4: Readiness" style={{ marginBottom: 12 }} />
        <Label>Focus</Label>
        <Textarea value={w.focus} onChange={e => patch({ focus: e.target.value })} rows={3} />
      </SectionCard>

      <SectionCard title="Upcoming deliverables" sub="Tasks due in the week after this report.">
        <ListEditor
          items={w.deliverables}
          onChange={deliverables => patch({ deliverables })}
          blank={() => ({ id: newId("nx"), lead: "", detail: "" })}
          addLabel="Add deliverable"
          empty="Nothing is due next week in ClickUp. Add what the team will actually be working on."
          render={(item, update) => <BulletFields item={item} update={update} />}
        />
      </SectionCard>

      <SectionCard title="Meetings" sub="The standing Tuesday status call is added automatically.">
        <ListEditor
          items={w.meetings}
          onChange={meetings => patch({ meetings })}
          blank={(): Meeting => ({ id: newId("mtg"), title: "", date: null, attendees: "" })}
          addLabel="Add meeting"
          render={(item, update) => (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr", gap: 6 }}>
              <Input value={item.title} onChange={e => update({ title: e.target.value })} placeholder="Meeting" style={{ fontWeight: 600 }} />
              <Input type="date" value={item.date ?? ""} onChange={e => update({ date: e.target.value || null })} style={{ fontSize: 12 }} />
              <Input value={item.attendees} onChange={e => update({ attendees: e.target.value })} placeholder="Attendees" style={{ fontSize: 12 }} />
            </div>
          )}
        />
      </SectionCard>
    </div>
  );
}

// ─── Step: Risks ──────────────────────────────────────────────────────────────

const SEVS: Array<{ v: Severity; l: string }> = [
  { v: "high",   l: "🔴 High" },
  { v: "medium", l: "🟡 Medium" },
  { v: "low",    l: "🟢 Low" },
];

function StepRisks({ report, set }: { report: StatusReport; set: (r: StatusReport) => void }) {
  const rs = report.risks;
  const patch = (p: Partial<typeof rs>) => set({ ...report, risks: { ...rs, ...p } });
  const autoCount = rs.risks.filter(r => r.source === "auto").length;

  return (
    <div>
      <SectionCard
        title="Risk assessment"
        sub={`${autoCount} risk(s) detected from blockers, overdue work, budget variance and NetSuite data quality.`}
      >
        <Textarea value={rs.assessment} onChange={e => patch({ assessment: e.target.value })} rows={3} />
      </SectionCard>

      <SectionCard title="Risk register" sub="Keep it honest — this is what drives the conversation on the call.">
        <ListEditor
          items={rs.risks}
          onChange={risks => patch({ risks })}
          blank={(): Risk => ({ id: newId("risk"), title: "", severity: "medium", impact: "", mitigation: "", owner: report.meta.pm, source: "manual" })}
          addLabel="Add risk"
          empty="No risks detected. Add anything you're carrying that isn't visible in the task data."
          render={(item, update) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 160px", gap: 6 }}>
                <Input value={item.title} onChange={e => update({ title: e.target.value })} placeholder="Risk" style={{ fontWeight: 600 }} />
                <Select value={item.severity} onChange={e => update({ severity: e.target.value as Severity })} style={{ fontSize: 12 }}>
                  {SEVS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </Select>
                <Input value={item.owner} onChange={e => update({ owner: e.target.value })} placeholder="Owner" style={{ fontSize: 12 }} />
              </div>
              <Textarea value={item.impact} onChange={e => update({ impact: e.target.value })} placeholder="Impact if unmitigated" rows={2} style={{ fontSize: 12 }} />
              <Textarea value={item.mitigation} onChange={e => update({ mitigation: e.target.value })} placeholder="Mitigation — a specific action" rows={2} style={{ fontSize: 12 }} />
              {item.source === "auto" && (
                <div style={{ fontSize: 10, color: C.textSub }}>Detected automatically from project data</div>
              )}
            </div>
          )}
        />
      </SectionCard>
    </div>
  );
}

// ─── Step: Budget ─────────────────────────────────────────────────────────────

function StepBudget({ report, set }: { report: StatusReport; set: (r: StatusReport) => void }) {
  const b = report.budget;
  const t = budgetTotals(b.rows);

  const updateRow = (id: string, patch: Partial<typeof b.rows[number]>) =>
    set({
      ...report,
      budget: {
        ...b,
        rows: b.rows.map(r => {
          if (r.id !== id) return r;
          const merged = { ...r, ...patch };
          return { ...merged, remainingHours: Math.max(0, merged.allocatedHours - merged.actualHours) };
        }),
      },
    });

  const cell: React.CSSProperties = { padding: "8px 6px", fontSize: 12, borderBottom: `1px solid ${C.border}` };
  const num: React.CSSProperties  = { ...cell, textAlign: "right", fontFamily: C.mono };

  return (
    <div>
      <div style={{ padding: "10px 14px", background: C.alt, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.textMid, marginBottom: 14 }}>
        <strong>Actual hours come from NetSuite</strong> (<code>projecttask.actualwork</code>) and are read-only.
        Allocated hours are editable so you can re-baseline a phase — the original is kept and rendered as
        “(was N)” in the deck.
      </div>

      <SectionCard title="Phase budget" sub={`${b.rows.length} phase row(s) from the NetSuite project.`}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 660 }}>
            <thead>
              <tr style={{ background: C.alt }}>
                {["Phase", "Name", "Allocated", "Original", "Actual", "Remaining", "Status"].map((h, i) => (
                  <th key={h} style={{ ...cell, textAlign: i >= 2 && i <= 5 ? "right" : "left", fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map(r => (
                <tr key={r.id}>
                  <td style={{ ...cell, color: C.textSub, whiteSpace: "nowrap" }}>
                    {r.phaseNumber != null && r.phaseNumber > 0 ? `Phase ${r.phaseNumber}` : r.phaseNumber === 0 ? "PM" : "—"}
                  </td>
                  <td style={cell}>
                    <Input value={r.name} onChange={e => updateRow(r.id, { name: e.target.value })} style={{ fontSize: 12, padding: "5px 8px" }} />
                  </td>
                  <td style={num}>
                    <Input
                      type="number" min="0" step="0.5" value={r.allocatedHours}
                      onChange={e => updateRow(r.id, { allocatedHours: parseFloat(e.target.value) || 0 })}
                      style={{ fontSize: 12, padding: "5px 6px", textAlign: "right", fontFamily: C.mono, width: 76 }}
                    />
                  </td>
                  <td style={num}>
                    <Input
                      type="number" min="0" step="0.5" value={r.originalAllocatedHours ?? ""}
                      placeholder="—"
                      onChange={e => updateRow(r.id, { originalAllocatedHours: e.target.value === "" ? null : parseFloat(e.target.value) })}
                      style={{ fontSize: 12, padding: "5px 6px", textAlign: "right", fontFamily: C.mono, width: 76, color: C.textSub }}
                    />
                  </td>
                  <td style={{ ...num, color: r.allocatedHours > 0 && r.actualHours / r.allocatedHours > 1.1 ? C.red : C.text, fontWeight: 600 }}>
                    {r.actualHours}
                  </td>
                  <td style={{ ...num, color: C.textMid }}>{r.remainingHours}</td>
                  <td style={cell}>
                    <Input value={r.status} onChange={e => updateRow(r.id, { status: e.target.value })} style={{ fontSize: 12, padding: "5px 8px", width: 110 }} />
                  </td>
                </tr>
              ))}
              <tr style={{ background: C.alt, fontWeight: 700 }}>
                <td style={{ ...cell, borderBottom: "none" }}>TOTAL</td>
                <td style={{ ...cell, borderBottom: "none" }} />
                <td style={{ ...num, borderBottom: "none" }}>{t.allocated}</td>
                <td style={{ ...num, borderBottom: "none" }} />
                <td style={{ ...num, borderBottom: "none" }}>{t.actual}</td>
                <td style={{ ...num, borderBottom: "none" }}>{t.remaining}</td>
                <td style={{ ...cell, borderBottom: "none" }} />
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Budget note">
        <Label>Footnote shown under the budget table</Label>
        <Input value={b.note} onChange={e => set({ ...report, budget: { ...b, note: e.target.value } })} style={{ marginBottom: 12 }} />
        <Label>Data integrity warning</Label>
        <Textarea
          value={b.dataWarning ?? ""}
          placeholder="Leave empty to omit this callout from the deck"
          onChange={e => set({ ...report, budget: { ...b, dataWarning: e.target.value || null } })}
          rows={2}
        />
      </SectionCard>
    </div>
  );
}

// ─── Step: Recap & actions ────────────────────────────────────────────────────

function StepActions({ report, set }: { report: StatusReport; set: (r: StatusReport) => void }) {
  const a = report.actions;
  const patch = (p: Partial<typeof a>) => set({ ...report, actions: { ...a, ...p } });

  return (
    <div>
      <SectionCard title="Closing recap" sub="The week in a few lines, and the one thing that must happen next.">
        <Textarea value={a.recap} onChange={e => patch({ recap: e.target.value })} rows={4} />
      </SectionCard>

      <SectionCard title="Action items" sub="Owners on both sides, with dates.">
        <ListEditor
          items={a.items}
          onChange={items => patch({ items })}
          blank={(): ActionItem => ({ id: newId("act"), action: "", owner: "", ownerSide: "loop", dueDate: null, status: "Open" })}
          addLabel="Add action item"
          empty="No blockers or client-pending items detected. Add the actions agreed on the call."
          render={(item, update) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Input value={item.action} onChange={e => update({ action: e.target.value })} placeholder="Action — start with a verb" style={{ fontWeight: 600 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr", gap: 6 }}>
                <Input value={item.owner} onChange={e => update({ owner: e.target.value })} placeholder="Owner" style={{ fontSize: 12 }} />
                <Select value={item.ownerSide} onChange={e => update({ ownerSide: e.target.value as ActionItem["ownerSide"] })} style={{ fontSize: 12 }}>
                  <option value="loop">Loop Services</option>
                  <option value="customer">{report.meta.client}</option>
                </Select>
                <Input type="date" value={item.dueDate ?? ""} onChange={e => update({ dueDate: e.target.value || null })} style={{ fontSize: 12 }} />
                <Input value={item.status} onChange={e => update({ status: e.target.value })} placeholder="Status" style={{ fontSize: 12 }} />
              </div>
            </div>
          )}
        />
      </SectionCard>
    </div>
  );
}

// ─── Claude rail ──────────────────────────────────────────────────────────────

interface ChatTurn { role: "user" | "assistant"; content: string }

const QUICK_PROMPTS = [
  "Tighten the whole report — cut filler, keep the facts",
  "Rewrite the key message for an executive audience",
  "Sharpen the risks — make each mitigation a specific action",
  "Make the client's outstanding items more explicit",
  "Add more detail to next week's deliverables",
];

function ClaudeRail({
  report, section, onReport, chat, setChat,
}: {
  report: StatusReport;
  section: SectionKey;
  onReport: (r: StatusReport) => void;
  chat: ChatTurn[];
  setChat: (t: ChatTurn[]) => void;
}) {
  const [input, setInput]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat, busy]);

  const send = useCallback(async (instruction: string) => {
    if (!instruction.trim() || busy) return;
    setBusy(true); setError(null);
    const history = [...chat, { role: "user" as const, content: instruction }];
    setChat(history);
    setInput("");

    try {
      const res = await fetch("/api/pm/status-report/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report,
          instruction,
          section: section === "review" ? undefined : section,
          history: chat,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Refine failed");
      onReport(d.report);
      setChat([...history, { role: "assistant", content: d.reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
      setChat([...history, { role: "assistant", content: `I couldn't apply that: ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }, [busy, chat, onReport, report, section, setChat]);

  return (
    <div style={{ width: 330, flexShrink: 0, borderLeft: `1px solid ${C.border}`, background: C.surface, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, background: "linear-gradient(135deg,#0F172A,#1A3052)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>✨ Refine with Claude</div>
        <div style={{ fontSize: 11, color: "#93C5FD", marginTop: 2 }}>
          Editing <strong>{STEPS.find(s => s.key === section)?.label}</strong> — ask for anything
        </div>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 16px", minHeight: 0 }}>
        {chat.length === 0 && (
          <div>
            <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6, marginBottom: 14 }}>
              Claude sees the whole report plus the live NetSuite and ClickUp figures. It can rewrite any
              prose, restructure the lists, and re-rank the risks. It can&apos;t change hours or task
              counts — those stay as NetSuite reports them.
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Try
            </div>
            {QUICK_PROMPTS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => send(p)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 11px", marginBottom: 6, borderRadius: 7, border: `1px solid ${C.border}`, background: C.alt, color: C.textMid, fontSize: 12, cursor: "pointer", fontFamily: C.font, lineHeight: 1.4 }}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {chat.map((t, i) => (
          <div
            key={i}
            style={{
              marginBottom: 10, padding: "9px 12px", borderRadius: 9, fontSize: 12, lineHeight: 1.55,
              background: t.role === "user" ? C.blueBg : C.alt,
              border: `1px solid ${t.role === "user" ? C.blueBd : C.border}`,
              color: t.role === "user" ? C.blue : C.textMid,
              marginLeft: t.role === "user" ? 20 : 0,
              marginRight: t.role === "user" ? 0 : 20,
            }}
          >
            {t.content}
          </div>
        ))}

        {busy && (
          <div style={{ padding: "9px 12px", borderRadius: 9, background: C.alt, border: `1px solid ${C.border}`, fontSize: 12, color: C.textSub, marginRight: 20 }}>
            Thinking…
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.border}` }}>
        {error && (
          <div style={{ fontSize: 11, color: C.red, marginBottom: 7 }}>{error}</div>
        )}
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(input); }
          }}
          placeholder="e.g. “Say the freight data from Vivian is blocking config and we need it by Thursday”"
          rows={3}
          style={{ fontSize: 12 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
          <span style={{ fontSize: 10, color: C.textSub, flex: 1 }}>⌘/Ctrl + Enter to send</span>
          {chat.length > 0 && (
            <button
              type="button"
              onClick={() => setChat([])}
              style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: C.surface, color: C.textSub, border: `1px solid ${C.border}` }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim() || busy}
            style={{ padding: "6px 16px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: !input.trim() || busy ? "not-allowed" : "pointer", background: C.blue, color: "#fff", border: "none", opacity: !input.trim() || busy ? 0.55 : 1 }}
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export function StatusReportWizard({ project, onClose }: { project: Project; onClose: () => void }) {
  const [weekEnding, setWeekEnding] = useState(() => fridayOf(new Date()));
  const [report, setReport]   = useState<StatusReport | null>(null);
  const [step, setStep]       = useState<SectionKey>("recap");
  const [phase, setPhase]     = useState<"loading" | "drafting" | "ready" | "error">("loading");
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);
  const [chat, setChat]       = useState<ChatTurn[]>([]);
  const [dirty, setDirty]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  const stepIndex = STEPS.findIndex(s => s.key === step);

  // ── Load / generate ──
  const load = useCallback(async (week: string, opts: { forceFresh?: boolean } = {}) => {
    setPhase("loading"); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/pm/status-report/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, weekEnding: week }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not assemble the report");

      // Reopen the PM's saved edits when they exist rather than overwriting them.
      if (d.saved && !opts.forceFresh) {
        setReport(d.saved);
        setPhase("ready");
        setNotice(`Reopened your saved ${d.savedStatus === "final" ? "final report" : "draft"} for this week.`);
        setDirty(false);
        return;
      }

      setReport(d.report);
      setDirty(false);

      // Have Claude write the narrative straight away — this is the slow part of
      // the PM's manual process, so it shouldn't need an extra click.
      setPhase("drafting");
      try {
        const dres = await fetch("/api/pm/status-report/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report: d.report }),
        });
        const dd = await dres.json();
        if (dres.ok && dd.report) {
          setReport(dd.report);
        } else {
          setNotice(`Claude couldn't draft the narrative (${dd.error ?? "unknown error"}). The report is populated from project data — edit the text directly or use the Claude panel.`);
        }
      } catch {
        setNotice("Claude couldn't draft the narrative. The report is populated from project data — edit the text directly.");
      }
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setPhase("error");
    }
  }, [project]);

  useEffect(() => { load(weekEnding); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const update = useCallback((r: StatusReport) => { setReport(r); setDirty(true); }, []);

  async function save(status: "draft" | "final") {
    if (!report) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pm/status-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectNsId: report.meta.projectNsId, weekEnding: report.meta.weekEnding, content: report, status }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Save failed");
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }));
      setNotice(status === "final" ? "Marked as final and saved." : "Draft saved.");
    } catch (e) {
      setNotice(`Could not save: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  function changeWeek(week: string) {
    if (dirty && !confirm("You have unsaved edits. Changing the reporting week will rebuild the report and discard them. Continue?")) return;
    setWeekEnding(week);
    setChat([]);
    load(week);
  }

  function regenerate() {
    if (dirty && !confirm("Rebuild from live NetSuite and ClickUp data? Your unsaved edits will be lost.")) return;
    setChat([]);
    load(weekEnding, { forceFresh: true });
  }

  function close() {
    if (dirty && !confirm("You have unsaved edits. Close anyway?")) return;
    onClose();
  }

  const headerBtn: React.CSSProperties = {
    padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
    background: "rgba(255,255,255,0.08)", color: "#E2E8F0", border: "1px solid rgba(255,255,255,0.16)", fontFamily: C.font,
  };

  const stepContent = useMemo(() => {
    if (!report) return null;
    switch (step) {
      case "recap":        return <StepRecap        report={report} set={update} />;
      case "deliverables": return <StepDeliverables report={report} set={update} />;
      case "milestones":   return <StepMilestones   report={report} set={update} />;
      case "whatsNext":    return <StepWhatsNext    report={report} set={update} />;
      case "risks":        return <StepRisks        report={report} set={update} />;
      case "budget":       return <StepBudget       report={report} set={update} />;
      case "actions":      return <StepActions      report={report} set={update} />;
      case "review":       return <StatusReportPreview report={report} />;
    }
  }, [report, step, update]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: C.bg, display: "flex", flexDirection: "column", fontFamily: C.font }}>
      {/* ── Header ── */}
      <div style={{ background: "#0D1117", borderBottom: "1px solid #1E2A3A", padding: "12px 22px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9" }}>Weekly Status Report</div>
          <div style={{ fontSize: 11.5, color: "#8A95A3", marginTop: 1 }}>{project.label}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, marginLeft: 12 }}>
          <span style={{ fontSize: 11, color: "#8A95A3" }}>Week ending</span>
          <input
            type="date"
            value={weekEnding}
            onChange={e => e.target.value && changeWeek(e.target.value)}
            style={{ padding: "6px 9px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.08)", color: "#E2E8F0", fontSize: 12, fontFamily: C.font, outline: "none", colorScheme: "dark" }}
          />
        </div>

        <div style={{ flex: 1 }} />

        {dirty && <span style={{ fontSize: 11, color: "#FCD38A" }}>● Unsaved edits</span>}
        {!dirty && savedAt && <span style={{ fontSize: 11, color: "#A7E3C4" }}>✓ Saved {savedAt}</span>}

        <button type="button" onClick={regenerate} disabled={phase === "loading" || phase === "drafting"} style={headerBtn}>
          ↻ Rebuild from live data
        </button>
        <button type="button" onClick={() => setRailOpen(o => !o)} style={headerBtn}>
          {railOpen ? "Hide" : "✨ Show"} Claude
        </button>
        <button type="button" onClick={() => save("draft")} disabled={saving || !report} style={headerBtn}>
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={() => save("final")}
          disabled={saving || !report}
          style={{ ...headerBtn, background: C.blue, borderColor: C.blue, color: "#fff", fontWeight: 700 }}
        >
          Mark final
        </button>
        <button type="button" onClick={close} style={{ ...headerBtn, background: "transparent", border: "none", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>×</button>
      </div>

      {/* ── Body ── */}
      {phase === "loading" || phase === "drafting" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
            {phase === "loading" ? "Pulling NetSuite phases and ClickUp tasks…" : "Claude is drafting the narrative…"}
          </div>
          <div style={{ fontSize: 12.5, color: C.textSub, maxWidth: 460, textAlign: "center", lineHeight: 1.6 }}>
            {phase === "loading"
              ? "Phase budgets and actual hours from NetSuite, task detail and milestones from ClickUp."
              : "Writing the key message, accomplishments, risk assessment and action items from this week's data."}
          </div>
        </div>
      ) : phase === "error" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>Could not build the report</div>
          <div style={{ fontSize: 12.5, color: C.textMid, maxWidth: 480, textAlign: "center" }}>{error}</div>
          <button
            type="button"
            onClick={() => load(weekEnding, { forceFresh: true })}
            style={{ padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none" }}
          >
            Try again
          </button>
        </div>
      ) : report ? (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Step nav */}
          <div style={{ width: 246, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.surface, overflowY: "auto", padding: "14px 12px" }}>
            {STEPS.map((s, i) => {
              const active = s.key === step;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStep(s.key)}
                  style={{
                    display: "flex", width: "100%", textAlign: "left", gap: 10, alignItems: "flex-start",
                    padding: "9px 11px", marginBottom: 3, borderRadius: 8, cursor: "pointer", fontFamily: C.font,
                    background: active ? C.blueBg : "transparent",
                    border: `1px solid ${active ? C.blueBd : "transparent"}`,
                    borderLeft: `3px solid ${active ? C.blue : "transparent"}`,
                  }}
                >
                  <span style={{
                    width: 20, height: 20, borderRadius: 999, flexShrink: 0, fontSize: 10, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: active ? C.blue : i < stepIndex ? C.greenBg : C.alt,
                    color: active ? "#fff" : i < stepIndex ? C.green : C.textSub,
                    border: `1px solid ${active ? C.blue : i < stepIndex ? C.greenBd : C.border}`,
                  }}>
                    {s.num}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: active ? 700 : 600, color: active ? C.blue : C.text }}>{s.label}</span>
                    <span style={{ display: "block", fontSize: 10.5, color: C.textSub, marginTop: 1, lineHeight: 1.35 }}>{s.hint}</span>
                  </span>
                </button>
              );
            })}

            <div style={{ marginTop: 16, padding: "10px 11px", background: C.alt, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Sources</div>
              <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.6 }}>
                NetSuite #{project.entityid} · {report.budget.rows.length} phase row(s)<br />
                ClickUp · {report.recap.metrics.tasksTotal} task(s)
              </div>
            </div>
          </div>

          {/* Editor */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minWidth: 0 }}>
            {notice && (
              <div style={{ padding: "10px 14px", background: C.yellowBg, border: `1px solid ${C.yellowBd}`, borderRadius: 8, fontSize: 12, color: C.yellow, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ flex: 1, lineHeight: 1.5 }}>{notice}</span>
                <button type="button" onClick={() => setNotice(null)} style={{ background: "none", border: "none", color: C.yellow, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: C.text }}>
                  {STEPS[stepIndex].label}
                </h2>
                <p style={{ margin: "3px 0 0", fontSize: 12.5, color: C.textSub }}>{STEPS[stepIndex].hint}</p>
              </div>
              <span style={{ fontSize: 11.5, color: C.textSub, fontFamily: C.mono }}>
                Step {stepIndex + 1} of {STEPS.length}
              </span>
            </div>

            <div style={{ maxWidth: step === "review" ? "none" : 860, height: step === "review" ? "calc(100% - 90px)" : "auto" }}>
              {stepContent}
            </div>

            {step !== "review" && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                <button
                  type="button"
                  onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].key)}
                  disabled={stepIndex === 0}
                  style={{ padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: stepIndex === 0 ? "not-allowed" : "pointer", background: C.surface, color: C.textMid, border: `1px solid ${C.border}`, opacity: stepIndex === 0 ? 0.5 : 1, fontFamily: C.font }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].key)}
                  style={{ padding: "9px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", background: C.blue, color: "#fff", border: "none", fontFamily: C.font, boxShadow: "0 2px 8px rgba(26,86,219,0.3)" }}
                >
                  {stepIndex === STEPS.length - 2 ? "Review & Send →" : "Next →"}
                </button>
              </div>
            )}
          </div>

          {/* Claude rail */}
          {railOpen && (
            <ClaudeRail report={report} section={step} onReport={update} chat={chat} setChat={setChat} />
          )}
        </div>
      ) : null}
    </div>
  );
}
