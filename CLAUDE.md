# Project: Loop Services – Project Health Dashboard

## Project Overview

This is an internal project management dashboard for **Loop Services** (a NetSuite Solution Partner). It is used by project managers to monitor the overall health of active client implementation projects in real time.

Data is pulled from two sources:
- **NetSuite** – project financials, budgets, actuals, resource allocation, billing milestones
- **ClickUp** – task progress, milestone status, open issues, team workload

The goal is to give PMs a single-pane-of-glass view of project health without needing to toggle between systems.

---

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + inline styles (design system via `C` constants)
- **Data Fetching**: SuiteQL (NetSuite REST API) + ClickUp REST API
- **State Management**: React hooks (`"use client"` pages, manual refresh pattern)
- **Charts**: Recharts (preferred) or Tremor
- **AI Insights**: Anthropic SDK (`claude-sonnet-4-6`)
- **Deployment**: Vercel
- **Fonts**: DM Sans (UI) + DM Mono (metrics/numbers) via Google Fonts

---

## Deployment

- **GitHub repo**: `https://github.com/zrs1980/DeliveryDashboard`
- **App directory**: `C:\Claude Projects\delivery-dashboard`
- **Deployed on**: Vercel (auto-deploys from `main` branch)
- **Data refresh**: Manual — "Refresh Data" button in the header triggers `/api/projects` and `/api/reports/phase-rag` in parallel

### Environment Variables (set in Vercel dashboard + local `.env.local`)

| Variable | Description |
|---|---|
| `NETSUITE_ACCOUNT_ID` | `3550424` |
| `NETSUITE_CONSUMER_KEY` | From NS integration record |
| `NETSUITE_CONSUMER_SECRET` | From NS integration record |
| `NETSUITE_TOKEN_ID` | From NS access token |
| `NETSUITE_TOKEN_SECRET` | From NS access token |
| `CLICKUP_API_TOKEN` | From ClickUp Settings → Apps |
| `CLICKUP_TEAM_ID` | ClickUp workspace team ID |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |

> ⚠️ After adding/changing env vars in Vercel you **must redeploy** — Vercel does not pick up new variables on existing deployments automatically.

---

## Key Data Sources

### NetSuite
- **Auth**: OAuth 1.0a (Token-Based Authentication)
- **Endpoint**: SuiteQL via `/services/rest/query/v1/suiteql`
- **Account ID**: `3550424`
- **Base URL**: `https://3550424.suitetalk.api.netsuite.com`
- Key entities: `job` (projects), `jobtype`, `transaction` (actuals), `projectbudget`, `projecttask`, `timebill`, `employee`, `vendorbill`

### ClickUp
- **Auth**: Bearer token via `Authorization` header
- **Base URL**: `https://api.clickup.com/api/v2`
- Key endpoints: `/team/{team_id}/task`, `/list/{list_id}/task`, `/task/{task_id}`, `/space/{space_id}`

---

## Dashboard Sections & Metrics

### 1. Portfolio Overview (Landing Page)
- List of all active projects with health status indicators (Green / Amber / Red)
- Health score derived from: budget variance, schedule variance, open blockers
- Quick filters: by PM, by client, by status, by project type

### 2. Project Detail Page
Each project card/page should show:

**Financial Health**
- Budget vs Actual spend (from NetSuite `projectbudget` + `timebill`/`vendorbill`)
- Burn rate trend (weekly/monthly)
- Remaining budget %
- Forecasted completion cost

**Schedule Health**
- % tasks complete (from ClickUp)
- Milestones: upcoming, overdue, completed
- Days ahead / behind schedule
- Open blockers / overdue tasks count

**Resource Health**
- Assigned consultants and their billable hours this period (from NetSuite `timebill`)
- Utilization rate per resource

**Client Sentiment** *(manual field, optional)*
- Last updated rating (Good / Neutral / At Risk)
- Notes field

---

## Project Types (Loop Services Context)

NetSuite `jobtype` field:
- `1` → **Implementation** — full or phased NetSuite ERP rollout
- `2` → **Service** — scoped service engagements, optimization, or MRP work

Implementation projects typically run through the standard 5-phase structure (Planning & Design → Config & Testing → Training & UAT → Readiness → Go Live). Service projects may have a different or abbreviated phase structure.

Some implementations are delivered as:
- **Bolt-On** — Loop ERP customization layered onto existing NetSuite (e.g. Sortera)
- **Partner** — delivered through a global partner (e.g. Australia/Team Blue Sky)
- **Full Implementation** — end-to-end NetSuite ERP

Tag projects accordingly in the UI if this distinction is available (e.g. via a custom field or naming convention). The `jobtype` enum alone does not distinguish between these sub-types.

---

## NetSuite SuiteQL Patterns

Always use parameterized queries. Common query patterns:

```sql
-- Active projects (In Progress only)
-- NOTE: Use custentity_project_golive_date (not enddate) as the project deadline.
--       Use custentity_ceba_project_budget_hours (not projectbudget) for budget hours.
SELECT
  id,
  entityid,
  companyname,
  startdate,
  custentity_project_golive_date       AS golive_date,   -- project end / deadline date
  entitystatus,
  jobtype,
  custentity20                         AS clickup_url,
  custentity_ceba_project_budget_hours AS budget_hours,
  custentity_project_remaining_hours   AS remaining_hours
FROM job
WHERE entitystatus = 2   -- 2 = "In Progress"
ORDER BY custentity_project_golive_date ASC

-- Filter by job type when needed:
--   jobtype = 1 → "Implementation"
--   jobtype = 2 → "Service"

-- Active Implementation projects only
SELECT id, entityid, companyname,
       custentity_project_golive_date       AS golive_date,
       custentity20                         AS clickup_url,
       custentity_ceba_project_budget_hours AS budget_hours,
       custentity_project_remaining_hours   AS remaining_hours
FROM job
WHERE entitystatus = 2 AND jobtype = 1

-- Hours summary per project (primary budget data source)
SELECT
  id,
  entityid,
  custentity_ceba_project_budget_hours                                           AS budget_hours,
  custentity_project_remaining_hours                                             AS remaining_hours,
  custentity_ceba_project_budget_hours - custentity_project_remaining_hours      AS hours_consumed
FROM job
WHERE id = ?

-- ✅ VERIFIED WORKING (March 2026): Timebill hours by employee per project
-- IMPORTANT: Use tb.customer (NOT tb.job) to reference the project.
--            Do NOT JOIN to the employee table — it is not accessible via SuiteQL.
--            Instead, return tb.employee as a raw ID and map to names using the EMPLOYEES constant.
SELECT tb.employee, tb.customer AS project_id, SUM(tb.hours) AS total_hours
FROM timebill tb
WHERE tb.customer IN (?, ?, ?)   -- pass project internal IDs
GROUP BY tb.customer, tb.employee
ORDER BY tb.customer, total_hours DESC

-- ✅ VERIFIED WORKING (July 2026): Phase-level budget and actuals from projecttask
-- WARNING: tasktype, startdate, enddate, and percentcomplete are NOT exposed in SuiteQL.
--          Only use the fields below — anything else will return a "NOT_EXPOSED" error.
-- IMPORTANT: Use pt.custeventceba_budget_hours for budgeted hours — NOT pt.estimatedwork.
--            estimatedwork is NetSuite's own scheduling-engine duration estimate and gets
--            silently recalculated whenever a task's start/end dates change (or NetSuite's
--            date-driven scheduling logic runs), drifting away from the PM-maintained budget.
--            custeventceba_budget_hours is the field that matches the "Budgeted Hours" column
--            shown in the NetSuite Project Tasks/Milestones UI and is not date-driven.
SELECT
  pt.id                          AS phase_id,
  pt.project                     AS project_id,
  pt.title                       AS phase_name,
  pt.custeventceba_budget_hours  AS budgeted_hours,
  pt.actualwork                  AS actual_hours,
  pt.status                      AS phase_status
FROM projecttask pt
WHERE pt.project = ?
ORDER BY pt.id ASC
-- Note: Without tasktype filtering, results include both phase rows and individual task rows.
-- Distinguish phases by title pattern (e.g. titles containing "Phase", "PHASE", or known phase names).
```

### AI Insights Panel — Prompt Templates

The dashboard uses `claude-sonnet-4-6` via the Anthropic API. Use these prompt structures:

**Single project mode:**
```
You are a senior NetSuite implementation PM advisor. Review this project status and provide:
(1) a 2-sentence risk summary calling out the most critical issues by name, then
(2) 'Recommended Next Steps:' as 4 bullet points, each starting with an action verb. Be specific.

Project: {label}
Health: {health.toUpperCase()} (score {score}/100), SPI: {spi}
Progress: {pct}% | Burn: {burnRate}% | Budget gap: {budgetGap}%
Hours: {actual}h logged / {totalH}h budget | {rem}h remaining
End date: {end} ({daysLeft})
Blocked tasks: {blocked task names or "None"}
Awaiting client: {clientPending task names or "None"}
Open milestones: {open milestone names or "None"}
```

**Portfolio mode (all projects):**
```
You are a senior NetSuite PM advisor. Review this portfolio of active projects and provide:
(1) a 2-3 sentence cross-portfolio risk assessment naming the top 2 risks, then
(2) 'Priority Next Steps:' as 4-5 bullet points prioritized by urgency, naming specific projects and people. Be direct.

{for each project: "{label}: {health} health, SPI {spi}, {pct}% done, {daysLeft}, {N} blocked, {N} client-pending"}
```

Render the response by splitting on newlines: bullet lines (starting with `-`, `•`, `*`, or digits) get a `→` prefix in blue (`#60A5FA`). Lines ending with `:` or wrapped in `**` are rendered as section headers.

---

## NetSuite Custom Field Reference

| Field ID | Label | Type | Notes |
|---|---|---|---|
| `custentity20` | ClickUp URL | Text | Full URL of the linked ClickUp space/list. Parse to extract the List or Space ID for API calls. |
| `custentity_ceba_project_budget_hours` | Budget Hours | Number | **Primary source for total budgeted hours.** Always use this field — do NOT derive budget hours from `projectbudget` or the standard `enddate` field. |
| `custentity_project_remaining_hours` | Remaining Hours | Number | Hours remaining on the project (manually maintained by PM). **Can be severely out of date** — always cross-check against timebill actuals and flag discrepancies in the UI. |
| `custentity_project_golive_date` | Go-Live Date | Date | **Primary source for the project end/deadline date.** Use this instead of the standard `enddate` field everywhere in the dashboard — for overdue calculations, days-remaining display, and phase RAG timeline logic. |
| `custentity_ceba_is_billable` | Billable (project-level) | Checkbox | **Primary source for whether a project's allocated time counts as billable.** ✅ Available in SuiteQL on `job` (verified July 2026). Never infer billability from `jobtype` — several Implementation/Service projects are flagged non-billable, and non-standard types (e.g. Managed Services Agreement) are billable. |
| `isutilizedtime` / `isproductivetime` | Classify time as Utilized / Productive | Checkbox | **Primary source for the Utilized and Productive classifications** (standard `job` fields, Preferences tab). ✅ Available in SuiteQL on `job` (verified July 2026) — no REST Record call needed. Never derive these from `jobtype`: internal projects like `159 Training/Certification` are Productive but not Utilized, and `268 Managed Services Agreement` is both despite its non-standard type. |
| `custeventceba_budget_hours` | Budget Hours (task/phase-level) | Number | **Primary source for phase/task budgeted hours** on the `projecttask` record — matches the "Budgeted Hours" column in the NetSuite Project Tasks/Milestones UI. Do NOT use `projecttask.estimatedwork` for this — that field is NetSuite's own scheduling-engine duration estimate and gets silently recalculated whenever a task's start/end dates change, drifting away from the real budget. |

### Enum Lookups

**`entitystatus`** — project status:
| Value | Label |
|---|---|
| `2` | In Progress ← **filter active projects with this value** |

> Always filter by `entitystatus = 2` for active projects. Do not filter by a text `status` field.
> The `job` record does NOT have a `status` field in SuiteQL — only `entitystatus`. Querying `status` will return a "Field not found" error.

**`jobtype`** — project type:
| Value | Label |
|---|---|
| `1` | Implementation |
| `2` | Service |

### Deriving ClickUp IDs from `custentity20`

The `custentity20` field contains a full ClickUp URL, e.g.:
`https://app.clickup.com/9012345678/v/l/abc123def`

Parse the URL to extract the List ID (last path segment). Example helper:

```typescript
function extractClickUpListId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/l\/([a-z0-9]+)/i);
  return match ? match[1] : null;
}
```

Always handle `custentity20` being null or empty — not all projects will have a ClickUp link.

---

## ClickUp API Patterns

```javascript
// Fetch tasks for a list
GET /api/v2/list/{list_id}/task?include_closed=true&subtasks=true

// Key fields to extract
task.status.status        // e.g., "in progress", "blocked", "complete"
task.due_date             // Unix ms timestamp
task.assignees            // array of user objects
task.tags                 // use for milestone tagging
task.time_estimate        // estimated effort in ms
task.time_spent           // logged time in ms
```

Map ClickUp statuses to health signals:
- `blocked` → Red flag
- `overdue` (due_date < now && status != complete) → Amber/Red
- `in review` / `in progress` → Normal
- `complete` → Green

---

## Health Score Logic

Calculate a composite score (0–100) per project. This is the **exact algorithm** used in the dashboard:

```typescript
function calcHealthScore(p: Project): { score: number; health: "green" | "yellow" | "red" } {
  const totalH    = p.actual + p.rem;               // budget hours
  const burnRate  = totalH > 0 ? p.actual / totalH : 0; // hours consumed ratio
  const spi       = burnRate > 0.01 ? Math.min(p.pct / burnRate, 2) : 1; // schedule perf index
  const budgetGap = burnRate - p.pct;               // positive = burning faster than progressing

  let score = 100;
  if (p.isOverdue)           score -= 35;           // past custentity_project_golive_date and not complete
  if (budgetGap > 0.2)       score -= 25;
  else if (budgetGap > 0.1)  score -= 12;
  if (spi < 0.7)             score -= 20;
  else if (spi < 0.85)       score -= 10;
  if (p.rem < 15 && p.pct < 0.85) score -= 20;     // nearly out of hours but not near done

  const health = score >= 70 ? "green" : score >= 45 ? "yellow" : "red";
  return { score, health };
}
```

**Key derived metrics:**
- `burnRate` = `actual / (actual + rem)` — what fraction of total hours have been consumed
- `spi` = `pct / burnRate` — SPI < 1.0 means burning hours faster than making progress
- `budgetGap` = `burnRate - pct` — positive = over-burning; > 20% is critical

**RAG thresholds:**
- Score ≥ 70 → 🟢 Green (On Track)
- Score 45–69 → 🟡 Amber (At Risk)
- Score < 45 → 🔴 Red (Critical)

---

## Design System & Color Tokens

Use the following exact color palette consistently. Define these as CSS variables or a constants object (`C`) at the top of the app:

```typescript
const C = {
  // Layout
  bg:        "#EEF1F5",   // page background
  surface:   "#FFFFFF",   // cards / panels
  alt:       "#F7F9FC",   // alternate row / subtle bg

  // Borders
  border:    "#E2E5EA",
  mid:       "#C9CDD4",

  // Text
  text:      "#0D1117",   // primary
  textMid:   "#4A5568",   // secondary
  textSub:   "#8A95A3",   // tertiary / labels

  // RAG — Green
  green:     "#0C6E44",
  greenBg:   "#E6F7F0",
  greenBd:   "#A7E3C4",

  // RAG — Amber
  yellow:    "#92600A",
  yellowBg:  "#FFF8E6",
  yellowBd:  "#F5D990",

  // RAG — Red
  red:       "#C0392B",
  redBg:     "#FEF0EF",
  redBd:     "#F5B8B5",

  // Accent — Blue (links, active nav, ClickUp buttons)
  blue:      "#1A56DB",
  blueBg:    "#EBF5FF",
  blueBd:    "#93C5FD",

  // Accent — Purple (milestones, NetSuite buttons)
  purple:    "#6B21A8",
  purpleBg:  "#F5F0FF",
  purpleBd:  "#C4B5FD",

  // Accent — Orange (client-pending tasks)
  orange:    "#B45309",
  orangeBg:  "#FFF7ED",
  orangeBd:  "#FCD38A",

  // Accent — Teal (supplied tasks)
  teal:      "#0D6E6E",
  tealBg:    "#E6F7F7",
  tealBd:    "#81D4D4",

  // Shadows
  sh:    "0 1px 3px rgba(0,0,0,0.05)",
  shMd:  "0 4px 14px rgba(0,0,0,0.07)",

  // Typography
  font:  "'DM Sans','Segoe UI',sans-serif",
  mono:  "'DM Mono','Fira Mono',monospace",   // use for numbers/metrics
};
```

**RAG helper functions** — use these consistently:
```typescript
const hColor = (h: string) => h === "green" ? C.green : h === "yellow" ? C.yellow : C.red;
const hBg    = (h: string) => h === "green" ? C.greenBg : h === "yellow" ? C.yellowBg : C.redBg;
const hBd    = (h: string) => h === "green" ? C.greenBd : h === "yellow" ? C.yellowBd : C.redBd;
```

---

## ClickUp Task Status Styles

Map ClickUp task statuses to these exact badge styles:

```typescript
const STATUS_STYLES = {
  "done":                  { bg:"#E6F7F0", color:"#0C6E44", bd:"#A7E3C4", label:"Done" },
  "in progress":           { bg:"#EBF5FF", color:"#1A56DB", bd:"#93C5FD", label:"In Progress" },
  "on hold":               { bg:"#FEF0EF", color:"#C0392B", bd:"#F5B8B5", label:"On Hold" },
  "new":                   { bg:"#F7F9FC", color:"#4A5568", bd:"#C9CDD4", label:"New" },
  "awaiting confirmation": { bg:"#FFF7ED", color:"#B45309", bd:"#FCD38A", label:"Awaiting" },
  "scheduled":             { bg:"#F5F0FF", color:"#6B21A8", bd:"#C4B5FD", label:"Scheduled" },
  "supplied":              { bg:"#E6F7F7", color:"#0D6E6E", bd:"#81D4D4", label:"Supplied" },
};
```

Tasks tagged as `blocked: true` or with status `"on hold"` → show a red **⚠ Blocked** badge.
Tasks tagged as `client: true` and not done/supplied → show an orange **👤 Client** badge.
Tasks tagged as `milestone: true` → show a purple **★ Milestone** badge.

---

## Navigation & Layout

**App header** (sticky, dark):
- Background: `#0D1117`, border-bottom: `#1E2A3A`
- Loop Services logo badge: blue (`#1A56DB`) pill, white bold text
- Title: "Project Management Dashboard", light (`#F1F5F9`)
- Version badge: dark muted pill

**Three top-level pages** (tab nav in header):
1. `📊 Portfolio Overview` — project health summary table + phase heatmap
2. `🗂️ Task Command Center` — task list with timeline/milestone/resource/blocked/client tabs
3. `👥 Resource Allocation` — weekly hours by consultant across projects

Active tab: blue background (`#1A56DB`), white text. Inactive: transparent, muted (`#64748B`).

**Page max-width**: 1400px, centered, 24px padding.

---

## Portfolio Overview Page

### Summary KPI Cards (top row)
Show these 5 cards before the project table:
| Card | Value | Color Logic |
|---|---|---|
| Active Projects | count of projects | blue accent |
| 🔴 Critical | count health = red | red if > 0 |
| 🟡 At Risk | count health = yellow | yellow if > 0 |
| ⚠ Blocked Tasks | total blocked across all projects | red if > 0 |
| 👤 Client Pending | total client-pending tasks | orange if > 0 |

### Project Summary Table
Columns: **Client — Project**, **PM**, **Type**, **Progress**, **Hours**, **SPI**, **Budget Gap**, **Go-Live Date**, **Links**

- **Progress**: progress bar (completion %) with a burn-rate marker line in red showing hours consumed %. Bar color = RAG color.
- **Hours**: `{actual}h / {total}h` in monospace, sub-text `{remaining}h left`
- **SPI** (Schedule Performance Index = `pct / burnRate`): monospace, green if ≥ 1.0, yellow if ≥ 0.85, red if < 0.85
- **Budget Gap** (`burnRate - pct`): monospace, red if > 15%, yellow if > 5%, green otherwise. Prefix `+` for over.
- **Go-Live Date**: sourced from `custentity_project_golive_date`. Bold date + sub-text days remaining (e.g. "2d left" or "3d overdue" in red). Never use the standard `enddate` field for this display.
- **Links**: stacked mini link buttons — purple "↗ NetSuite" and blue "↗ ClickUp"

NetSuite project link: `https://system.na1.netsuite.com/app/accounting/project/project.nl?id={projectId}`
ClickUp link: read from `custentity20` on the job record.

### Phase Completion Heatmap
A matrix of client/project rows × phase columns. Phases: `Phase 1`, `Phase 2`, `Phase 3`, `Phase 4`, `Phase 5`, `PM`.

Cell background based on average completion %:
- ≥ 90% → `#DCFCE7` (green)
- 50–89% → `#FEF9C3` (yellow)
- 1–49% active → `#FEE2E2` (red)
- 0% / not started → `#F3F4F6` (grey)
- No tasks for this phase → `—`

Legend: 🟢 ≥90% · 🟡 50–89% · 🔴 <50% active · ⬜ Not started

---

## Task Command Center Page

### AI Insights Panel
Dark gradient panel (`linear-gradient(135deg, #0F172A, #1A3052)`) at the top of the Task and Allocation views.
- Calls the Anthropic API (`claude-sonnet-4-6`) with structured project data
- Single-project mode (when a project is selected): 2-sentence risk summary + 4 bullet recommended next steps
- Portfolio mode (all projects): 2–3 sentence cross-portfolio risk assessment + 4–5 priority next steps
- Has a "↻ Refresh" button to regenerate
- Renders bullet points with `→` prefix in `#60A5FA`

### Filter Bar
Two dropdowns: **PROJECT** (all projects or a specific one) and **RESOURCE** (all or a specific consultant name). Show task count + done count on the right.

### Tab Bar (underline style)
- 📅 Timeline — tasks grouped into: Overdue / This Week / Next Week / Upcoming buckets
- ★ Milestones — milestone tasks only
- 👤 By Resource — tasks grouped by assigned Loop Services consultant
- ⚠ Blocked (N) — all blocked/on-hold tasks
- 🤝 Client (N) — tasks awaiting client action

Active tab: blue underline + blue text. Inactive: no underline, muted text.

### Task Card
- Status badge + optional Milestone / Blocked / Client badges
- Task name (bold, 13px)
- Project label sub-text
- Assignee chips (pill style, grey)
- Right side: "↗ ClickUp" (blue) and "↗ NetSuite" (purple) link buttons

---

## Resource Allocation View

Weekly allocation table showing hours per consultant per week, grouped by project.

- Columns: consultant name + one column per Mon-starting week
- Current week highlighted
- Hours shown in monospace; 0h cells are empty/grey
- Weeks pro-rate allocation hours across business days in the date range

### Week cell metrics

Every cell in the by-resource grid shows four rows, each as a % of a 40h week:

| Row | Meaning | Source |
|---|---|---|
| **Bill** | Billable | `custentity_ceba_is_billable` |
| **Util** | Utilized | `isutilizedtime` |
| **Prod** | Productive | `isproductivetime` |
| **Tot** | Total allocated | every allocation, regardless of flag |

All three classifications are read off the **NetSuite project (`job`) record** via `/api/resources`, which tests `=== "T"` (see the checkbox gotcha — SuiteQL omits never-set checkbox columns entirely). Bill is RAG-coloured against the allocation bands; Util/Prod are plain; Tot sits below a divider. All four render even at 0% so cells stay the same height and the grid scans cleanly column-to-column.

> The old cell showed **Bill / Int / Tot**, where "Int" was `projectType === "Internal"` — a jobtype-derived heuristic. Replaced July 2026.

### Project grouping — Customer Projects vs Internal, sub-grouped by type

Two top-level bands, each sub-grouped by the **raw NetSuite jobtype name**:

```
CUSTOMER PROJECTS          Implementation (4) · Service (2) · Managed Services Agreement (1)
  ● Implementation                 4 projects · 312.0h allocated
      Nautical — NetSuite Implementation      [B][U][P]   176h  74h  102h  +28h
  ● Service                        2 projects ·  88.0h allocated
  ● Managed Services Agreement     1 project  ·  40.0h allocated
INTERNAL
```

`NSAllocation.projectType` is the raw `BUILTIN.DF(job.jobtype)` string — **not** a collapsed enum. It used to be `"Implementation" | "Service" | "Internal"`, which silently bucketed Managed Services Agreement, Technical Services and Training into the internal band. Same convention as `/api/manager-review` and `TimeAnalysis`.

Helpers in `ResourceAllocation.tsx` own all of this:

| Helper | Purpose |
|---|---|
| `isCustomerProjectType(t)` | `t !== "" && t !== "internal"` — same rule as ManagerReview/TimeAnalysis |
| `projectGroupOf(t)` | → `"Customer Projects" \| "Internal"` |
| `projectTypeLabel(t)` | sub-group label; `""` → `"Unclassified"` |
| `compareProjectTypes(a,b)` | `TYPE_RANK` order first, then alphabetical, so a new NetSuite jobtype surfaces on its own rather than being hidden |
| `projectTypeTint(t)` / `projectTypeShort(t)` | chip colour and abbreviation (`Managed Services Agreement` → `MSA`) |
| `groupByProjectGroup` / `subGroupsByType` | the two grouping passes |
| `ClassChips` | shared B/U/P chips |

Sub-group headers only render when a band has more than one type; single-type bands show the type chip on the project row instead. Known NetSuite jobtype names live in `TYPE_TINT` / `TYPE_RANK` — a name not listed still renders, just with neutral styling and sorted last.

`CUSTOMER_WEEK_FLOOR` (30h) drives the "Need Xh" hint on the Customer Projects total row. It predates the merge, where it applied to Implementation alone; it now also counts Service and Managed Services Agreement hours, so it is easier to hit than it was.

### Class column (by-project table)

Column order is **Project / Resource · Class · Orig. Budget · Rem. Budget · Allocated · Gap · weeks** — 6 non-week columns. `Class` holds the `ClassChips` B/U/P indicators (filled = flag set on the NetSuite project).

> Adding or removing a column here means updating **six** places: the `<thead>`, the group-header `colSpan` (`weeks.length + 6`), the sub-group-header `colSpan`, the project row, the five empty cells on nested resource rows, and the group-total row. They will not fail to compile if they disagree — the table just renders misaligned.

### Gotchas

- **Never derive Billable / Utilized / Productive from `projectType` or `jobtype` anywhere in this view.** The grouping uses `projectType`, but that is a *display* grouping only — never a classification. The old jobtype heuristic disagreed with NetSuite on 14 of 21 allocated projects.
- **Add new groupings via `projectGroupOf`, never by comparing `projectType` inline.** The old code had three independent `TYPE_ORDER`/`TYPE_STYLE` copies plus two `t === "Implementation"` special cases, which is how the billable target and the 30h floor drifted apart.
- **The per-group billable target is gated on `classifyAsBillable`, not on the group being "Implementation".** It sums `targetUtil × 0.87 × 40` over each unique employee allocated to a *billable-flagged* project that week, so it appears for any group containing billable work.
- **Compare billable hours to the billable target, not total allocated hours.** The group summary row shows total hours as its headline figure but RAGs on `grpWeekBillable / grpWeekTargets`; using the total would count non-billable work toward a billable target in any mixed group.
- **`CellEdit` must carry the three flags.** Inline cell creation builds an optimistic `NSAllocation` by hand, and omitting them leaves the new row `undefined` — excluded from every `=== true` filter, so a freshly added allocation reads as 0% Bill/Util/Prod until refresh. The edit/split paths spread `...orig` and are fine.
- Project rows in the by-project view carry **B / U / P** chips (filled = flag set) so the classification is visible next to the hours; hover for the full NetSuite-sourced breakdown.

---

## Shared UI Components

### ProgressBar
```tsx
// val = completion (0–1), burn = hours burn rate (0–1), color = bar fill
<ProgressBar val={0.67} burn={0.55} color={C.green} h={6} />
```
- Grey track, colored fill, red vertical marker at `burn` position

### LinkBtn
```tsx
<LinkBtn href="https://..." color={C.purple} label="NetSuite" />
<LinkBtn href="https://..." color={C.blue}   label="ClickUp"  />
```
- Small pill button with `↗` prefix, colored border + background tint

### Number formatting helpers
```typescript
const fmtN   = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(1);
const fmtH   = (n: number) => fmtN(n) + "h";
const fmtPct = (n: number) => Math.round(n * 100) + "%";
const fmtD   = (n: number) => n < 0 ? Math.abs(n) + "d overdue" : n === 0 ? "Today" : n + "d left";
```

---

## Design & UX Guidelines

- **Audience**: Internal PMs at Loop Services — not clients. Data-dense is fine.
- **Typography**: DM Sans for UI, DM Mono for all numeric metrics (hours, %, SPI, budget gap).
- **Colors**: Green/amber/red are ONLY used for RAG status. Never decorative.
- **Tables**: Sortable, zebra-stripe using `C.alt`. Each row clickable to project detail.
- **Loading states**: Skeleton loaders per panel — don't block the whole page.
- **Error states**: Per-panel error messages if NetSuite or ClickUp API fails independently.
- **Refresh**: Manual refresh button per panel; AI Insights panel has its own refresh.

---

## Phase RAG Status Report

This is a dedicated report view showing per-phase health across all active projects. It is distinct from the overall project health score — it gives PMs a drill-down into which specific phases are on track, at risk, or critical.

### Two RAG Dimensions Per Phase

Each phase is evaluated on **two independent axes**:

#### 1. Timeline RAG
Based on phase start/end dates sourced from `projecttask.startdate` and `projecttask.enddate` in NetSuite.

> ⚠️ **SuiteQL Limitation (confirmed March 2026):** `startdate`, `enddate`, `tasktype`, and `percentcomplete` are **NOT exposed** in SuiteQL for the `projecttask` record. Timeline RAG cannot be computed from SuiteQL alone. To get phase dates, use the NetSuite REST Record API (`/services/rest/record/v1/projecttask/{id}`) or the SOAP-based search. The Budget RAG dimension (from `custeventceba_budget_hours` vs `actualwork`) works fine in SuiteQL.

| Status | Condition |
|---|---|
| 🟢 Green | Phase end date is in the future and % complete is on track |
| 🟡 Amber | Phase end date is within 7 days OR phase is <50% complete with <25% of time remaining |
| 🔴 Red | Phase end date has passed and phase is not 100% complete |
| ⬜ Grey | Phase not yet started (start date in the future) |

```typescript
function phaseTimelineRAG(phase: Phase, today: Date): "green" | "yellow" | "red" | "grey" {
  const start = new Date(phase.startdate);
  const end   = new Date(phase.enddate);
  if (start > today) return "grey";                        // not started yet
  if (phase.pctComplete >= 1.0) return "green";           // fully complete
  if (end < today) return "red";                          // overdue
  const daysLeft  = (end.getTime() - today.getTime()) / 86400000;
  const totalDays = (end.getTime() - start.getTime()) / 86400000;
  const timeElapsedPct = 1 - daysLeft / totalDays;
  if (daysLeft <= 7) return "yellow";
  if (timeElapsedPct > 0.75 && phase.pctComplete < 0.5) return "yellow";
  return "green";
}
```

#### 2. Budget RAG
Based on budgeted vs. actual hours per phase from `projecttask.custeventceba_budget_hours` (budgeted) and `projecttask.actualwork` (actual). Do not use `projecttask.estimatedwork` for budgeted hours — see gotchas.

| Status | Condition |
|---|---|
| 🟢 Green | Actual hours ≤ 90% of budgeted hours |
| 🟡 Amber | Actual hours 90–110% of budgeted hours |
| 🔴 Red | Actual hours > 110% of budgeted hours (over budget) |
| ⬜ Grey | No budgeted hours set for this phase |

```typescript
function phaseBudgetRAG(phase: Phase): "green" | "yellow" | "red" | "grey" {
  if (!phase.budgetedHours || phase.budgetedHours === 0) return "grey";
  const ratio = phase.actualHours / phase.budgetedHours;
  if (ratio <= 0.9)  return "green";
  if (ratio <= 1.10) return "yellow";
  return "red";
}
```

### Phase RAG SuiteQL Query (Budget RAG only — verified working)

```sql
-- ✅ VERIFIED WORKING (July 2026)
-- Returns phase rows with budget/actual hours. Does NOT include dates or % complete (not exposed).
-- Filter phase rows by title pattern since tasktype is not available in SuiteQL.
-- Budgeted hours MUST come from custeventceba_budget_hours, not estimatedwork (see gotchas).
SELECT
  pt.id                          AS phase_id,
  pt.project                     AS project_id,
  j.entityid                     AS project_number,
  j.companyname                  AS client,
  pt.title                       AS phase_name,
  pt.custeventceba_budget_hours  AS budgeted_hours,
  pt.actualwork                  AS actual_hours,
  pt.status                      AS phase_status
FROM projecttask pt
JOIN job j ON j.id = pt.project
WHERE j.entitystatus = 2
ORDER BY j.id, pt.id ASC
```

### Phase RAG Display

Show the Phase RAG report as a matrix table (same layout as the existing Phase Completion Heatmap) but with **two stacked badges per cell** — one for Timeline and one for Budget:

```
┌──────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ Client — Project     │ Phase 1  │ Phase 2  │ Phase 3  │ Phase 4  │ Phase 5  │
├──────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ Nautical / NS Impl.  │ 🟢 / 🟡  │ 🟡 / 🔴  │ ⬜ / ⬜  │ ⬜ / ⬜  │ ⬜ / ⬜  │
│                      │ Time/Bud │ Time/Bud │          │          │          │
└──────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

Cell tooltip (on hover) should show:
- Phase name
- Start → End date range
- Budgeted hours / Actual hours / Remaining hours
- % complete

### Phase Data TypeScript Interface

```typescript
interface ProjectPhase {
  phaseId:       number;
  projectId:     number;
  projectNumber: string;
  client:        string;
  phaseName:     string;       // e.g. "PHASE 1 - Planning and Design"
  phaseStart:    string;       // ISO date string — fetch via REST API, not SuiteQL
  phaseEnd:      string;       // ISO date string — fetch via REST API, not SuiteQL
  budgetedHours: number;       // from projecttask.custeventceba_budget_hours ✅ available in SuiteQL — NOT estimatedwork (date-driven, drifts from real budget)
  actualHours:   number;       // from projecttask.actualwork ✅ available in SuiteQL
  remainingHours: number;      // budgetedHours - actualHours
  pctComplete:   number;       // 0–1 decimal — fetch via REST API, not SuiteQL
  phaseStatus:   string;       // NetSuite phase status value ✅ available in SuiteQL
  timelineRAG:   "green" | "yellow" | "red" | "grey";
  budgetRAG:     "green" | "yellow" | "red" | "grey";
}
```

---

## File & Folder Conventions

```
/app
  page.tsx                     → Main dashboard page (3-tab layout, Refresh Data button)
  layout.tsx                   → Root layout with DM Sans/DM Mono fonts
  globals.css                  → Base styles
  /api/projects/route.ts       → Fetches NS projects + ClickUp tasks, merges into Project[]
  /api/reports/phase-rag/      → Phase budget RAG from projecttask
  /api/insights/route.ts       → Anthropic AI insights endpoint (POST)
/components
  /ui/ProgressBar.tsx          → Progress bar with burn-rate marker
  /ui/LinkBtn.tsx              → Pill link button (NetSuite / ClickUp)
  /health/HealthBadge.tsx      → RAG status badge
  /dashboard/KpiCards.tsx      → 5 summary KPI cards (top of Portfolio view)
  /dashboard/ProjectTable.tsx  → Main project summary table
  /dashboard/PhaseHeatmap.tsx  → Phase completion heatmap matrix
  /dashboard/TaskCommandCenter.tsx → Task tabs (Timeline/Milestones/Resource/Blocked/Client)
  /dashboard/ResourceAllocation.tsx → Hours by consultant table
  /dashboard/AiInsights.tsx    → AI insights panel with Refresh button
/lib
  netsuite.ts                  → OAuth 1.0a signing + SuiteQL + REST Record API helpers
  clickup.ts                   → ClickUp task fetching and classification helpers
  health.ts                    → Health score, phase RAG, formatting helpers
  types.ts                     → Shared TypeScript interfaces
  constants.ts                 → EMPLOYEES, PMS, color tokens (C), STATUS_STYLES
.env.local                     → Secrets (gitignored — never commit)
.env.example                   → Template with blank values (tracked in git)
vercel.json                    → Vercel deployment config (framework detection only)
```

---

## Important Business Context

- **Loop Services** (formerly CEBA Solutions, founded 2012) is the implementation/services arm. All active client projects live here.
- **Loop ERP** (founded 2024) is a separate NetSuite SDN product company targeting the circular economy. Some projects may be Loop-related; tag them accordingly.
- PMs should be able to filter to their own projects by default when auth is added.

### Known Employee IDs (NetSuite internal IDs)
```typescript
const EMPLOYEES = {
  11944: "Shai Aradais",       // also a PM
  15622: "Alecia Gilmore",     // also a PM
  15735: "Sam Balido",
  15849: "Jason Tutanes",
  17191: "Piero Loza Palma",
  18376: "Carlos Roman",
};

const PMS = {
  11944: "Shai Aradais",
  15622: "Alecia Gilmore",
  4812:  "Kathy Bacero",
};
```

### Active Projects (March 2026 — verified against live NS data)
| NS ID | NS # | Client | Project Name | Type | Go-Live Date | Budget Hrs | Remaining Hrs |
|---|---|---|---|---|---|---|---|
| 18386 | 408 | Pacific OneSource | NetSuite Optimization Strategy | Service | 2026-03-23 | 110h | 35h |
| 18380 | 406 | Nautical Fulfillment & Logistics | Netsuite Implementation | Implementation | 2026-05-01 | 176h | 74.25h |
| 18171 | 402 | FarmOp Capital (JGL Livestock) | JGL NS Implementation | Implementation | **null — needs to be set** | 200h | 65h |
| 18403 | 413 | Salt and Stone | NS Implementation | Service | null | 250h | **⚠ 244.75h (suspect — see gotchas)** |
| 17310 | 356 | Yield Engineering Systems | Service Request - MRP Dry BU | Service | null | 160h | **-16h (over budget)** |

These are populated dynamically from NetSuite — hardcoding is only for reference/fallback.

### Timebill Hours by Consultant (March 2026 — from NS timebill)
| Consultant | NS ID | JGL (18171) | Nautical (18380) | Pacific OS (18386) | Salt&Stone (18403) | Yield Eng (17310) | Total |
|---|---|---|---|---|---|---|---|
| Sam Balido | 15735 | 201.7h | — | 102.6h | 106.4h | 2.0h | 412.7h |
| Jason Tutanes | 15849 | — | 112.7h | — | 105.6h | 168.5h | 386.8h |
| Shai Aradais | 11944 | 92.2h | 39.6h | 38.75h | 37.5h | 49.5h | 257.6h |
| Carlos Roman | 18376 | 19.5h | 20.0h | 8.0h | — | — | 47.5h |
| Piero Loza Palma | 17191 | — | — | 12.8h | — | — | 12.8h |

---

## Out of Scope (for now)

- Client-facing portal
- Invoice generation
- Change order management
- Real-time push notifications (polling is fine)
- Multi-currency support

---

## NetSuite OAuth 1.0a Implementation Notes (confirmed working — March 2026)

The OAuth signing is implemented manually in `lib/netsuite.ts` using Node's built-in `crypto` module. **Do not use the `oauth-1.0a` npm package** — it causes `TypeError: fetch failed` in Vercel's serverless environment.

Key rules for the signature:
- **Query params must be included** in the normalized parameters block (e.g. `limit=1000` from the SuiteQL URL)
- **`realm` is NOT included** in the signature base string — only in the Authorization header
- **Sort params** by percent-encoded key, then percent-encoded value
- **Signing key**: `pct(CONSUMER_SECRET) + "&" + pct(TOKEN_SECRET)`
- **Base string**: `METHOD & pct(baseUrl_no_query) & pct(normalized_params)`
- **Signature** must be percent-encoded in the Authorization header (`=` → `%3D`, `+` → `%2B`)
- `encodeURIComponent` misses `!`, `'`, `(`, `)`, `*` — encode these manually
- Use `HMAC-SHA256` — SHA1 is dead as of NetSuite 2023.1

Authorization header format:
```
OAuth realm="3550424", oauth_consumer_key="...", oauth_nonce="...", oauth_signature="...", oauth_signature_method="HMAC-SHA256", oauth_timestamp="...", oauth_token="...", oauth_version="1.0"
```

> If you get `hostname: "undefined.suitetalk.api.netsuite.com"`, the `NETSUITE_ACCOUNT_ID` env var is missing from Vercel.
> If the Login Audit Trail shows nothing, check that all env vars are set and redeploy after adding them.

---

## Common Gotchas

- NetSuite SuiteQL returns all numbers as strings — always `parseFloat()` / `parseInt()` before calculations. This applies to `custentity_ceba_project_budget_hours` and `custentity_project_remaining_hours`.
- ClickUp `due_date` is in Unix milliseconds, not seconds.
- NetSuite project internal IDs (e.g., `18380`) differ from project numbers (e.g., `406`) — store both and use the internal ID for API calls.
- `custentity20` may be null, an empty string, or a full ClickUp URL — always validate before parsing.
- Some ClickUp URLs may point to a Space, Folder, or List — the ID extraction regex may need to handle multiple URL patterns.
- `custentity_project_remaining_hours` is manually maintained by PMs and may lag behind actual logged time — surface a "last updated" note if possible, or cross-check against `timebill` actuals. **Salt & Stone (18403) is a known example of severe drift** — NS shows 244.75h remaining (5.25h consumed) but timebill records ~249h already logged. Always show a data integrity warning when `timebill total > budget_hours - remaining_hours` by more than 20h.
- **Never use the standard `enddate` field as the project deadline.** Always use `custentity_project_golive_date`. The `enddate` field may reflect contract dates or NetSuite defaults that don't match the actual go-live target.
- **Never use `projectbudget.budgetedcost` for hours budget.** Always use `custentity_ceba_project_budget_hours`. The `projectbudget` record tracks cost, not hours, and may be empty or misaligned.
- `custentity_project_golive_date` may be null on older or service-type projects — handle gracefully by falling back to `enddate` only as a last resort, and flag the project in the UI if the go-live date is missing. **JGL (18171) is a known example** — go-live date is currently null and needs to be set by the PM.
- **The `job` record does NOT have a `status` field in SuiteQL.** Using `status` returns "Field not found". Always use `entitystatus = 2` (integer) to filter active projects.
- **SuiteQL omits checkbox columns entirely when the field was never set.** A never-ticked checkbox comes back as an absent key (not `"F"`), while an explicitly-unticked one returns `"F"` — so always test `=== "T"` rather than `!== "F"`, or unset fields silently read as true. The REST Record API instead coerces both cases to `false`, so null and false are indistinguishable there. Confirmed July 2026 on `custentity_ceba_is_billable`.
- **Never derive Billable / Utilized / Productive from `jobtype`.** Read `custentity_ceba_is_billable`, `isutilizedtime`, and `isproductivetime` off the `job` record (all available in SuiteQL). The old jobtype heuristic disagreed with NetSuite on 14 of 21 allocated projects. For *logged* time, the per-entry `timebill.isbillable` / `isutilized` / `isproductive` flags are the source instead.
- **`timebill` uses `customer` (not `job`) to reference the project.** The correct field to filter/group by project is `tb.customer`. Using `tb.job` returns "Field not found".
- **Cannot JOIN `employee` table in SuiteQL timebill queries.** The `employee` record is not joinable via SuiteQL. Return `tb.employee` as a raw integer ID and map to names using the `EMPLOYEES` constant in code.
- **`projecttask` has restricted fields in SuiteQL.** The following fields return "NOT_EXPOSED - Not available for channel SEARCH" errors: `tasktype`, `startdate`, `enddate`, `percentcomplete`. Only use: `id`, `project`, `title`, `custeventceba_budget_hours`, `actualwork`, `status`, `parent`. To get phase dates or % complete, use the NetSuite REST Record API instead.
- **Never use `projecttask.estimatedwork` as the budgeted-hours source.** It's NetSuite's own scheduling-engine duration field (used to auto-derive `endDate` from `startDate` + working days), not the PM-maintained budget. It gets silently recalculated whenever a task's start/end dates change via the REST API or NetSuite's own scheduling logic, drifting away from the true budget (confirmed July 2026 — a task showed `estimatedwork: 228.5` in NetSuite while its real budget field read `custeventceba_budget_hours: 174`, matching the NetSuite UI's "Budgeted Hours" column exactly). Always use `custeventceba_budget_hours` for task/phase-level budgeted hours, and never PATCH `estimatedWork` from the dashboard to "fix" an end date — just PATCH `endDate` directly and let NetSuite own any recalculation.
- For the Phase RAG report, since `tasktype` is not available in SuiteQL, distinguish phase rows from task rows by matching `title` against known phase name patterns (e.g. title contains "Phase", "PHASE", "Planning", "Config", "Training", "UAT", "Go Live", "Project Management").
- Filter active projects using `entitystatus = 2` (integer), not a string status value.
- Use `jobtype = 1` for Implementation and `jobtype = 2` for Service when filtering by project type.
- Time entries in NetSuite use `timebill` for employee time and `vendorbill` for contractor/vendor costs — both must be summed for total cost actuals.

---

## Module: Weekly Client Status Report

Generates the client-facing weekly status deck a PM would otherwise assemble by hand from NetSuite and ClickUp. Entry point is a **📄 Weekly Status Report** button in the PM tab's project drill-down (`PMView`, breadcrumb row) — shown only for projects backed by a NetSuite job, since the report needs phase budgets and task detail.

Supports the PMO cadence: a Tuesday status call with the customer, then the report at end of week. The default reporting week ends on the **Friday** of the current week (`fridayOf`), and the standing Tuesday call is auto-inserted into the meetings list.

### Flow

1. **Generate** — `POST /api/pm/status-report/generate` takes the `Project` the dashboard already holds (avoids a second full portfolio refresh) and adds one SuiteQL call for phase budgets. `deriveStatusReport()` assembles a fully populated draft.
2. **Draft** — `POST /api/pm/status-report/draft` has Claude write the narrative (key message, accomplishments, risk assessment, action items). Runs automatically so the PM doesn't need an extra click.
3. **Edit** — 8-step wizard (`StatusReportWizard`); every field editable.
4. **Refine** — `POST /api/pm/status-report/refine` is the Claude chat rail. Free-form instructions return a validated patch.
5. **Export** — `StatusReportPdf` renders an 8-slide 16:9 PDF client-side via `@react-pdf/renderer`; preview and download are the same document.
6. **Save** — `POST /api/pm/status-report` upserts the snapshot on `(project_ns_id, week_ending)`.

### Report sections

Cover · Quick Recap (status + phase tracker + accomplishments) · Deliverables (Loop vs customer) · Milestones · What's Next · Risks · Budget · Recap & Action Items.

### Files

```
/lib
  status-report.ts           → types, Loop deck palette (D), display helpers. CLIENT-SAFE (no NS/ClickUp imports)
  status-report-derive.ts    → server-side assembly from Project + NS phases + baselines
  status-report-ai.ts        → Claude tool schema, applyPatch() validation, prompt context
/components/reports
  StatusReportPdf.tsx        → the 8-slide PDF deck
  StatusReportPreview.tsx    → usePDF preview + download (loaded via next/dynamic ssr:false)
/components/dashboard
  StatusReportWizard.tsx     → wizard + Claude rail
/app/api/pm/status-report/   → route.ts (save/list), generate/, draft/, refine/
/supabase/status-report-schema.sql
/scripts/verify-status-report-pdf.tsx → render check with synthetic data
/public/fonts/DMSans-{Regular,Medium,Bold}.ttf
```

### Deck palette

Sampled from the July 2026 Oxide deck so output matches what the PM already sends. Exported as `D` in `lib/status-report.ts` — **do not use the dashboard's `C` tokens in the PDF**, they're a light-theme UI palette.

| Token | Hex | Use |
|---|---|---|
| `navy` / `navyDeep` | `#0A1628` / `#060E1F` | slide / cover background |
| `card` / `cardAlt` / `cardLine` | `#0D2247` / `#1A3A6B` / `#1E3A5F` | panels, table headers, borders |
| `accent` / `accentSoft` | `#3D6EC4` / `#5B8DEF` | headings, bullets, rules |
| `green` / `amber` / `red` | `#22C55E` / `#F5B942` / `#EF6461` | ON TRACK / AT RISK / CRITICAL |
| `textMut` / `textDim` / `textFaint` | `#AEC0D6` / `#8B9BB4` / `#D0DCEF` | body text tiers |

### Baselines — why the extra table

Neither NetSuite nor ClickUp keeps a prior value, so the deck's **"Orig. Due Date"** column and the **"114 (adjusted from 130)"** budget annotations are impossible without storing them. `pm_status_report_baselines` captures milestone due dates and phase allocated hours the **first** time a report is generated for a project, using `ignoreDuplicates: true` so the original is never overwritten. Read baselines *before* capturing new ones, or the first report shows a spurious "adjusted from".

### Gotchas

- **Claude cannot change numbers.** `applyPatch()` hard-preserves `budget.rows`, `recap.metrics`, `recap.phaseTracker` and `recap.delta`. The model may describe hours but never restate them, or the deck would stop reconciling with NetSuite. Keep this guarantee if you extend the patch schema.
- **Every AI value is re-validated** in `applyPatch()` — enums coerced, ids minted, unknown fields dropped. A malformed response degrades to a no-op instead of corrupting the report.
- **`@react-pdf/renderer` must never SSR.** Always reach the PDF through `next/dynamic(..., { ssr: false })`; `usePDF` breaks during server rendering.
- **Fonts are local, not CDN.** `/public/fonts/DMSans-*.ttf` are static (non-variable) TrueType, fetched same-origin. A remote font fetch would add a failure mode to a client deliverable. If a font fetch does fail, react-pdf falls back to Helvetica and the PDF still generates — verified.
- **`CUTask.date_done` / `date_closed` / `date_updated`** were added to the type to work out what closed *inside* the reporting week. ClickUp already returns them on every task fetch; don't strip them.
- **Accomplishments come from close dates, not status.** A task that is `done` but closed weeks ago is not this week's accomplishment.
- **Loop vs customer split** matches ClickUp assignee usernames against `EMPLOYEES` + `PMS` (`isLoopPerson`, normalised + first/last-initial patterns). ClickUp usernames are inconsistent, so the wizard lets the PM move rows that land on the wrong side.
- **Never use `fontStyle` (or an unregistered `fontWeight`) in `StatusReportPdf`.** Only DM Sans 400/500/700 are registered, and react-pdf throws `Could not resolve font for DM Sans, fontWeight 400, fontStyle italic` — killing the whole preview, not just that one line. This reached production once via an italic `overflowNote`. The Node render check *cannot* catch it, because fonts don't load under Node and the Helvetica fallback does have an oblique, so the verify script asserts against the stylesheet source instead.
- **`projecttask` rows are a tree — filter on `parent IS NULL` to get phases.** `isPhaseRow()` matches loosely (any title containing "planning", "design", "pm"), so title matching alone returns task rows too: Salt and Stone (18403) reported **20 "phase rows"**. `selectPhaseRows()` takes top-level rows, then one row per canonical phase number (largest budget wins), falling back to top-level-rows-with-hours and then to project-level totals. Summing all matching rows would also double-count, since a phase's `actualwork` rolls up its children.
- **`renderToBuffer` in Node** needs `PDF_FONT_DIR` and an absolute `logoSrc`; browser-relative paths resolve to nothing. See the verify script.
- Slide row counts are capped (milestones 9, risks 6, actions 8, budget 8, deliverables 9/column) and render an explicit **"+N more"** line — never truncate silently. Budget **totals are computed across all rows**, not just the rendered ones, so the TOTAL line always reconciles with NetSuite.
- **Run the verify script against a high-volume scenario, not just a tidy one.** Both production bugs above only appear once a table exceeds its cap or a project has a deep task tree — the original happy-path fixture rendered clean.
- **`.ttf` is excluded from the auth middleware** in `proxy.ts`, alongside `.png`/`.webp`. Without that, react-pdf's font fetch can be redirected to the login page and fontkit gets an HTML body.

---

## Module: Loop Services Intranet Wiki

This module adds an internal knowledge base and company directory to the existing Loop Services dashboard. It is built as a new top-level section within the same Next.js app — no separate service required.

---

### Overview & Goals

The wiki gives Loop Services staff a single place to find:
- **SOPs** — Standard Operating Procedures for delivery, onboarding, billing, etc.
- **Company Directory** — Employee profiles, departments, org chart
- **Announcements** — Internal news and updates
- **Search** — Full-text search across all content

It shares the existing design system (`C` constants, DM Sans/DM Mono, RAG-free color use), auth pattern, and header navigation.

---

### Navigation Integration

Add a 4th top-level tab to the existing header tab bar:

```
📊 Portfolio Overview | 🗂️ Task Command Center | 👥 Resource Allocation | 📚 Wiki
```

Active/inactive tab styles match existing pattern: blue bg + white text when active, transparent + `#64748B` when inactive.

The Wiki tab routes to `/wiki` (Next.js App Router page).

---

### Tech Stack (additions only)

| Addition | Purpose |
|---|---|
| `@supabase/supabase-js` | Supabase client for wiki content (PostgreSQL via Supabase) |
| `next-mdx-remote` or `marked` | Markdown rendering for SOP page bodies |
| `flexsearch` or Supabase full-text search | Full-text search across pages + directory |
| `@heroicons/react` | Icons for wiki UI (already consistent with design system) |

> All wiki data is stored in **Supabase** (PostgreSQL). Use the Supabase client (`@supabase/supabase-js`) for all DB access. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or `SUPABASE_SERVICE_ROLE_KEY` for server-side routes) to `.env.local` and Vercel environment variables.

---

### Database Schema

Create the schema in Supabase via the SQL editor or migration files. Use the Supabase dashboard or `supabase` CLI for migrations:

```sql
-- Wiki pages (SOPs, guides, announcements)
CREATE TABLE IF NOT EXISTS wiki_pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  body        TEXT NOT NULL,             -- Markdown content
  category_id INTEGER REFERENCES categories(id),
  author      TEXT NOT NULL,             -- Employee name (string, no auth table yet)
  is_pinned   INTEGER DEFAULT 0,        -- 1 = pinned to wiki homepage
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Page revision history
CREATE TABLE IF NOT EXISTS wiki_page_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     INTEGER NOT NULL REFERENCES wiki_pages(id),
  body        TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TEXT DEFAULT (datetime('now'))
);

-- Hierarchical categories (e.g. Delivery > Onboarding > New Hire SOP)
CREATE TABLE IF NOT EXISTS wiki_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  parent_id   INTEGER REFERENCES wiki_categories(id),
  icon        TEXT                        -- emoji or icon name
);

-- Tags and page-tag junction
CREATE TABLE IF NOT EXISTS wiki_tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS wiki_page_tags (
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id),
  tag_id  INTEGER NOT NULL REFERENCES wiki_tags(id),
  PRIMARY KEY (page_id, tag_id)
);

-- Company directory
CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  title         TEXT,
  department_id INTEGER REFERENCES departments(id),
  email         TEXT,
  phone         TEXT,
  manager_id    INTEGER REFERENCES employees(id),
  photo_url     TEXT,
  bio           TEXT,
  ns_id         INTEGER UNIQUE            -- maps to NetSuite employee internal ID
);

CREATE TABLE IF NOT EXISTS departments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  parent_dept_id     INTEGER REFERENCES departments(id)
);

-- Full-text search using PostgreSQL tsvector (Supabase)
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(author, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS wiki_pages_fts_idx ON wiki_pages USING GIN (fts);
```

---

### Seed Data (`/db/wiki-seed.ts` → run via `npx ts-node db/wiki-seed.ts` or Supabase SQL editor)

Pre-populate the wiki on first run:

**Departments:**
- Delivery
- Sales & Partnerships
- Operations
- Finance
- Leadership

**Categories:**
- Delivery > Onboarding
- Delivery > Project Execution
- Delivery > Go-Live
- Operations > HR
- Operations > Finance & Billing

**Sample SOPs (3 minimum):**
1. `new-hire-onboarding` — New Hire Onboarding SOP (Category: Onboarding)
2. `project-kickoff-checklist` — Project Kickoff Checklist (Category: Project Execution)
3. `go-live-readiness` — Go-Live Readiness Checklist (Category: Go-Live)

**Directory — pre-load from EMPLOYEES constant:**
```typescript
// Sync these from the existing EMPLOYEES / PMS constants in lib/constants.ts
// ns_id maps directly to NetSuite employee internal IDs
{ ns_id: 11944, name: "Shai Aradais",     title: "Project Manager" },
{ ns_id: 15622, name: "Alecia Gilmore",   title: "Project Manager" },
{ ns_id: 4812,  name: "Kathy Bacero",     title: "Project Manager" },
{ ns_id: 15735, name: "Sam Balido",       title: "Consultant" },
{ ns_id: 15849, name: "Jason Tutanes",    title: "Consultant" },
{ ns_id: 17191, name: "Piero Loza Palma", title: "Consultant" },
{ ns_id: 18376, name: "Carlos Roman",     title: "Consultant" },
```

---

### API Routes

Add these under `/app/api/wiki/`:

```
GET  /api/wiki/pages                → list all pages (with optional ?category=&tag=&q=)
POST /api/wiki/pages                → create a new page
GET  /api/wiki/pages/[slug]         → get single page with body + metadata
PUT  /api/wiki/pages/[slug]         → update page (saves version to wiki_page_versions)
DEL  /api/wiki/pages/[slug]         → delete page

GET  /api/wiki/categories           → category tree (nested)
POST /api/wiki/categories           → create category

GET  /api/wiki/directory            → list all employees (with optional ?dept=&q=)
GET  /api/wiki/directory/[id]       → get single employee profile
POST /api/wiki/directory            → create/update employee
PUT  /api/wiki/directory/[id]       → update employee

GET  /api/wiki/search?q=...         → full-text search across pages + directory
```

**Search response shape:**
```typescript
interface SearchResult {
  type: "page" | "employee";
  id: number;
  title: string;        // page title OR employee name
  snippet: string;      // 120-char excerpt with match highlighted
  category?: string;    // for pages
  slug?: string;        // for pages
  url: string;          // route to navigate to
}
```

---

### File & Folder Additions

```
/app
  /wiki
    page.tsx                   → Wiki homepage: pinned pages, recent updates, search bar
    /[slug]
      page.tsx                 → Individual wiki page (markdown rendered)
    /edit
      page.tsx                 → Create / edit wiki page form
    /directory
      page.tsx                 → Company directory (list + search)
    /directory/[id]
      page.tsx                 → Employee profile page
  /api/wiki
    /pages/route.ts
    /pages/[slug]/route.ts
    /categories/route.ts
    /directory/route.ts
    /directory/[id]/route.ts
    /search/route.ts

/components/wiki
  WikiSidebar.tsx              → Category tree nav + quick links
  WikiPageCard.tsx             → Page card (title, category, excerpt, updated date)
  WikiSearchBar.tsx            → Search input with Cmd+K shortcut
  WikiSearchResults.tsx        → Dropdown or results page
  MarkdownRenderer.tsx         → Renders page body markdown safely
  EmployeeCard.tsx             → Directory card (name, title, dept, contact chips)
  OrgChart.tsx                 → Collapsible org tree (department → employees)
  CategoryBreadcrumb.tsx       → Breadcrumb trail from root to current page

/lib
  wiki-db.ts                   → Supabase client instance + query helpers (@supabase/supabase-js)
  wiki-search.ts               → FTS query wrapper using Postgres tsvector + result formatting
```

---

### Wiki Homepage (`/wiki/page.tsx`)

Layout:

```
┌─────────────────────────────────────────────┐
│  🔍  Search the wiki...         [Cmd+K]      │
├───────────────┬─────────────────────────────┤
│  SIDEBAR      │  MAIN CONTENT               │
│               │                             │
│  Categories   │  📌 Pinned Pages (row)      │
│  ├ Delivery   │  ─────────────────────────  │
│  │ ├ Onboard  │  🕐 Recently Updated        │
│  │ └ Exec     │     [page cards]            │
│  ├ Operations │                             │
│  └ ...        │  📂 Browse by Category      │
│               │     [category cards]        │
│  Quick Links  │                             │
│  📋 Directory │                             │
│  📣 Announcements                           │
└───────────────┴─────────────────────────────┘
```

- Pinned pages: horizontal card row, max 4 visible
- Recently Updated: vertical list of `WikiPageCard`, sorted by `updated_at DESC`, limit 10
- Browse by Category: grid of category cards with icon + page count

---

### Individual Wiki Page (`/wiki/[slug]/page.tsx`)

```
┌─────────────────────────────────────────────┐
│  ← Back     Category > Sub-category         │
│                                             │
│  # Page Title                               │
│  By Author · Updated 3 days ago             │
│  Tags: [onboarding] [sop]                   │
│  ─────────────────────────────              │
│  [Rendered markdown body]                   │
│  ─────────────────────────────              │
│  📝 Edit this page    🕐 View history       │
└─────────────────────────────────────────────┘
```

- Render markdown with `marked` or `next-mdx-remote`; sanitize with `DOMPurify` or server-side only
- "Edit this page" links to `/wiki/edit?slug={slug}`
- "View history" expands a panel listing versions from `wiki_page_versions`

---

### Directory Page (`/wiki/directory/page.tsx`)

```
┌─────────────────────────────────────────────┐
│  🔍 Search people...   Filter: [All Depts ▾]│
├─────────────────────────────────────────────┤
│  DELIVERY                                   │
│  [EmployeeCard] [EmployeeCard] [EmployeeCard]│
│                                             │
│  OPERATIONS                                 │
│  [EmployeeCard] ...                         │
└─────────────────────────────────────────────┘
```

**EmployeeCard:**
- Avatar circle (initials fallback if no photo_url)
- Name (bold), Title (muted), Department pill
- Email chip (mailto:), phone chip (tel:)
- "↗ NetSuite" link if `ns_id` is present: `https://system.na1.netsuite.com/app/common/entity/employee.nl?id={ns_id}`

**Employee Profile Page (`/wiki/directory/[id]`):**
- Full bio section
- Manager link (if `manager_id` set)
- Direct reports list
- Active projects they're assigned to (pull from `/api/projects` data using `ns_id` cross-reference)

---

### Search

**Keyboard shortcut:** `Cmd+K` (Mac) / `Ctrl+K` (Win/Linux) opens a centered modal search overlay.

**Search modal UI:**
```
┌──────────────────────────────────────┐
│  🔍 Search wiki...                   │
├──────────────────────────────────────┤
│  Pages                               │
│  > Go-Live Readiness Checklist       │
│    Delivery > Go-Live · Updated 2d   │
│                                      │
│  People                              │
│  > Sam Balido · Consultant           │
└──────────────────────────────────────┘
```

- Results appear as you type (debounce 200ms)
- Highlight matched term in snippet
- Press Enter or click to navigate
- Esc to close

**FTS Query (Supabase / PostgreSQL tsvector):**
```typescript
// In /lib/wiki-search.ts
import { supabase } from "./wiki-db";

export async function searchWiki(query: string): Promise<SearchResult[]> {
  const { data: pages } = await supabase
    .from("wiki_pages")
    .select("id, title, slug, body, wiki_categories(name)")
    .textSearch("fts", query, { type: "websearch", config: "english" })
    .limit(10);

  const { data: people } = await supabase
    .from("employees")
    .select("id, name, title, departments(name)")
    .or(`name.ilike.%${query}%,title.ilike.%${query}%,bio.ilike.%${query}%`)
    .limit(5);

  return [
    ...(pages ?? []).map(p => ({
      type: "page" as const,
      id: p.id,
      title: p.title,
      slug: p.slug,
      snippet: p.body?.slice(0, 120) + "…",
      category: (p.wiki_categories as any)?.name,
      url: `/wiki/${p.slug}`,
    })),
    ...(people ?? []).map(e => ({
      type: "employee" as const,
      id: e.id,
      title: e.name,
      snippet: `${e.title} · ${(e.departments as any)?.name}`,
      url: `/wiki/directory/${e.id}`,
    })),
  ];
}
```

---

### Design Guidelines (Wiki-specific)

Follow all existing Loop Services design system rules (`C` constants, DM Sans/DM Mono, shadow tokens). Additional wiki-specific rules:

- **Sidebar width**: 240px, `C.surface` bg, `C.border` right border
- **Category active state**: `C.blueBg` bg, `C.blue` text, `C.blueBd` left border (3px)
- **Page cards**: `C.surface` bg, `C.border` border, `C.sh` shadow; hover → `C.shMd`
- **Markdown body**: max-width 720px, `C.text` color, 1.7 line-height; `h1`/`h2`/`h3` use DM Sans bold
- **Code blocks in markdown**: `C.alt` bg, `C.mono` font, `C.border` border, 4px radius
- **Tags**: small pills, `C.alt` bg, `C.textSub` text — same pattern as existing status chips but no color coding
- **Employee avatars**: circle, 40px (card) / 64px (profile), `C.blue` bg with white initials as fallback
- **RAG colors are NOT used in wiki** — no health scoring in the knowledge base
- **Search modal overlay**: `rgba(0,0,0,0.5)` backdrop, `C.surface` modal, `C.shMd` shadow, 600px max-width

---

### Edit / Create Page Form (`/wiki/edit/page.tsx`)

Fields:
- Title (text input, required)
- Category (dropdown from `/api/wiki/categories`)
- Tags (multi-select or comma-separated input)
- Body (textarea — plain markdown; add a simple toolbar for bold/italic/heading if time allows)
- Is Pinned (checkbox — admin only)
- Author (auto-filled from current user name; editable for now since no auth yet)

On save:
1. `PUT /api/wiki/pages/[slug]` with updated body
2. Previous body is saved to `wiki_page_versions` before overwrite
3. Redirect to `/wiki/[slug]` on success

---

### Integration with Existing Dashboard Data

The wiki directory integrates with live NetSuite data in two ways:

1. **Employee active projects** — on an employee's profile page, cross-reference their `ns_id` against the project data from `/api/projects` to show their currently assigned projects and hours.

2. **Seed sync script** — `/db/wiki-seed.ts` should import from `lib/constants.ts` (`EMPLOYEES`, `PMS`) so the directory stays in sync with the existing employee roster. Run this once on first deploy.

---

### Out of Scope for Wiki (Phase 1)

- File/attachment uploads (link to external docs instead)
- Rich WYSIWYG editor (plain markdown textarea is sufficient)
- Comments on pages
- Page locking / concurrent edit detection
- Client-visible wiki pages
- AI-generated SOP summaries (can be added later using existing Anthropic integration)

