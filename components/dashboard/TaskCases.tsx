"use client";
import { useState } from "react";
import { C } from "@/lib/constants";
import type { Project } from "@/lib/types";

/**
 * NetSuite support cases, shown in the Tasks tab beside the ClickUp tasks so a
 * support consultant sees all their work in one place.
 *
 * The rows come from the page's existing /api/cases load (the Cases tab uses the
 * same array) — no extra request. Only open cases are shown here; the Cases tab
 * is the place for history.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskCase {
  id:            string;
  caseNumber:    string;
  title:         string;
  status:        string;
  priority:      string;
  company:       string;
  /** supportcase.company — a customer id OR a job id. */
  companyId?:    string | null;
  /** The customer `companyId` resolves to (itself when it already is one). */
  customerNsId?: string | null;
  assigned:      string;
}

// ─── Matching helpers ─────────────────────────────────────────────────────────

const CLOSED_STATUSES = ["closed", "resolved"];

/** Lower-case, punctuation collapsed — "Resolved-Pending Customer Review" → "resolved pending customer review". */
function normStatus(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Resolved but still waiting on the customer to confirm — the case isn't off
 * the consultant's plate yet, so it stays on the list despite reading "resolved".
 */
function isPendingCustomerReview(status: string): boolean {
  return normStatus(status) === "resolved pending customer review";
}

/**
 * The Cases tab's rule (anything that reads closed or resolved is done), except
 * Resolved-Pending Customer Review, which still needs following up.
 */
export function isOpenCase(c: TaskCase): boolean {
  if (isPendingCustomerReview(c.status)) return true;
  const s = c.status.toLowerCase();
  return !CLOSED_STATUSES.some(x => s.includes(x));
}

function nameTokens(name: string): string[] {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // "Hernández" ≈ "Hernandez"
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether a ClickUp username and a NetSuite employee name are the same person.
 *
 * They are typed separately in two systems, so an exact match misses people:
 * NetSuite may carry a middle name or an accent ClickUp doesn't. Equal first AND
 * last word is the rule — tight enough that two people sharing a first name
 * don't collide.
 */
export function samePerson(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  return x.length > 1 && y.length > 1 && x[0] === y[0] && x[x.length - 1] === y[y.length - 1];
}

/**
 * A case belongs to a project when it was logged against that job, or against
 * the project's customer directly (cases are filed either way — see CLAUDE.md,
 * "supportcase.company is often a JOB").
 */
export function caseMatchesProject(c: TaskCase, project: Project): boolean {
  if (c.companyId && c.companyId === String(project.id)) return true;
  return !!project.customerNsId && c.companyId === project.customerNsId;
}

/** NetSuite priorities are text ("High", "Medium", "Low"), or 1–3 on older cases. */
export function casePriorityRank(priority: string): number | null {
  const p = priority.toLowerCase();
  if (p === "1" || p === "high" || p === "urgent" || p === "critical") return 1;
  if (p === "2" || p === "medium" || p === "normal") return 2;
  if (p === "3" || p === "low") return 3;
  return null;
}

// ─── Badges ───────────────────────────────────────────────────────────────────

const NS_CASE_URL = (id: string) =>
  `https://3550424.app.netsuite.com/app/crm/support/supportcase.nl?id=${id}&whence=`;

/** Same palette as the Cases tab, so a status reads the same in both places. */
const CASE_STATUS_STYLES: Record<string, { bg: string; color: string; bd: string }> = {
  "open":             { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
  "in progress":      { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
  "assigned":         { bg: C.blueBg,   color: C.blue,    bd: C.blueBd   },
  "re-opened":        { bg: C.redBg,    color: C.red,     bd: C.redBd    },
  "escalated":        { bg: C.redBg,    color: C.red,     bd: C.redBd    },
  "pending customer": { bg: C.orangeBg, color: C.orange,  bd: C.orangeBd },
  "awaiting info":    { bg: C.orangeBg, color: C.orange,  bd: C.orangeBd },
  "on hold":          { bg: C.yellowBg, color: C.yellow,  bd: C.yellowBd },
};

function CaseStatusBadge({ status }: { status: string }) {
  // Pending customer review shares "pending customer"'s colour: the ball is in
  // the customer's court either way.
  const key = isPendingCustomerReview(status) ? "pending customer" : status.toLowerCase();
  const sty = CASE_STATUS_STYLES[key] ?? { bg: C.alt, color: C.textMid, bd: C.border };
  return (
    <span style={{ fontSize: 10, fontWeight: 600, borderRadius: 3, padding: "1px 5px", background: sty.bg, color: sty.color, border: `1px solid ${sty.bd}`, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function CasePriority({ priority }: { priority: string }) {
  const rank = casePriorityRank(priority);
  if (rank === null) return <span style={{ color: C.textSub, fontSize: 11 }}>{priority && priority !== "—" ? priority : "—"}</span>;
  const label = rank === 1 ? "High" : rank === 2 ? "Medium" : "Low";
  return (
    <span style={{ fontSize: 11, color: rank === 1 ? C.red : C.textMid, fontWeight: rank === 1 ? 700 : 400, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

type CaseSortKey = "status" | "priority" | "name" | "client" | "assignee";
type SortDir = "asc" | "desc";

const COLUMNS: Array<{ key: CaseSortKey; label: string }> = [
  { key: "status",   label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "name",     label: "Name" },
  { key: "client",   label: "Client" },
  { key: "assignee", label: "Assignee" },
];

function sortValue(c: TaskCase, key: CaseSortKey): string | number | null {
  switch (key) {
    case "status":   return c.status.toLowerCase() || null;
    case "priority": return casePriorityRank(c.priority);
    case "name":     return c.title.toLowerCase() || null;
    case "client":   return c.company && c.company !== "—" ? c.company.toLowerCase() : null;
    case "assignee": return c.assigned && c.assigned !== "Unassigned" ? c.assigned.toLowerCase() : null;
  }
}

/** Same behaviour as the task table: blanks last both ways, ties keep their order. */
function sortCases(cases: TaskCase[], key: CaseSortKey, dir: SortDir): TaskCase[] {
  const sign = dir === "asc" ? 1 : -1;
  return cases
    .map((c, i) => ({ c, i, v: sortValue(c, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const d = typeof a.v === "number" && typeof b.v === "number"
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v));
      return d !== 0 ? d * sign : a.i - b.i;
    })
    .map(d => d.c);
}

export function TaskCasesTable({ cases, error }: { cases: TaskCase[]; error?: string | null }) {
  const [sortKey, setSortKey] = useState<CaseSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // asc → desc → back to the default order (most recently modified first).
  const onSort = (key: CaseSortKey) => {
    if (sortKey !== key)      { setSortKey(key); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else                      { setSortKey(null); setSortDir("asc"); }
  };

  const rows = sortKey ? sortCases(cases, sortKey, sortDir) : cases;

  if (error) {
    return (
      <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 13, color: C.red }}>
        ⚠ Couldn&apos;t load NetSuite cases: {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 13, color: C.textSub }}>
        No open cases match the current filters.
      </div>
    );
  }

  const th: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: C.textMid,
    textAlign: "left",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    background: C.alt,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
  };
  const td: React.CSSProperties = {
    padding: "0 10px",
    height: 36,
    verticalAlign: "middle",
    borderBottom: `1px solid ${C.border}`,
    fontSize: 12,
    color: C.text,
  };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {COLUMNS.map(({ key, label }) => {
            const active = sortKey === key;
            return (
              <th
                key={key}
                onClick={() => onSort(key)}
                title={`Sort by ${label.toLowerCase()}`}
                aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                style={{ ...th, color: active ? C.blue : th.color }}
              >
                {label}
                <span style={{ marginLeft: 4, fontSize: 9, color: active ? C.blue : C.mid }}>
                  {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((c, i) => (
          <tr key={c.id} style={{ background: i % 2 ? C.alt : C.surface }}>
            <td style={td}><CaseStatusBadge status={c.status} /></td>
            <td style={td}><CasePriority priority={c.priority} /></td>
            <td style={{ ...td, maxWidth: 380 }}>
              <a
                href={NS_CASE_URL(c.id)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open case #${c.caseNumber} in NetSuite`}
                style={{ color: C.blue, textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                <span style={{ fontFamily: C.mono, color: C.textSub, marginRight: 6 }}>#{c.caseNumber}</span>
                {c.title}
              </a>
            </td>
            <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.company}>
              {c.company || "—"}
            </td>
            <td style={{ ...td, whiteSpace: "nowrap", color: c.assigned === "Unassigned" ? C.textSub : C.text }}>
              {c.assigned || "Unassigned"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
