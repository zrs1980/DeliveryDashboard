# CEBA Solutions — Delivery Dashboard

A real-time project management dashboard for CEBA Solutions, built with Next.js 15 and deployed on Vercel. Pulls live data from NetSuite (projects, phases, support cases) and ClickUp (tasks, assignments).

---

## Tech Stack

- **Framework**: Next.js 15 App Router (TypeScript)
- **Deployment**: Vercel (auto-deploys from `main` branch)
- **Data sources**: NetSuite REST API (SuiteQL), ClickUp REST API v2, Anthropic Claude API
- **Auth**: NetSuite OAuth 1.0a Token-Based Authentication (HMAC-SHA256), ClickUp API key
- **Styling**: Inline styles with shared design tokens (`lib/constants.ts`)

---

## Environment Variables

Set in Vercel dashboard (Settings → Environment Variables):

| Variable | Description |
|---|---|
| `NS_ACCOUNT_ID` | NetSuite account ID (e.g. `12345678`) |
| `NS_CONSUMER_KEY` | OAuth consumer key |
| `NS_CONSUMER_SECRET` | OAuth consumer secret |
| `NS_TOKEN_ID` | OAuth token ID |
| `NS_TOKEN_SECRET` | OAuth token secret |
| `CLICKUP_API_KEY` | ClickUp personal API key |
| `CLICKUP_TEAM_ID` | ClickUp workspace/team ID |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI insights |

---

## Project Structure

```
app/
  page.tsx                      # Main dashboard page (client component)
  api/
    projects/route.ts           # Projects + ClickUp tasks
    reports/phase-rag/route.ts  # Phase RAG status from NetSuite
    cases/route.ts              # Support cases from NetSuite
    insights/route.ts           # AI insights via Claude API
    debug/clickup/route.ts      # Debug: browse ClickUp workspace hierarchy

components/dashboard/
  KpiCards.tsx                  # Portfolio KPI summary cards
  ProjectTable.tsx              # Sortable projects table with expandable metrics
  PhaseHeatmap.tsx              # Phase RAG heatmap
  TaskCommandCenter.tsx         # Task grid with tabs (Overdue, This Week, etc.)
  ResourceAllocation.tsx        # Consultant workload from ClickUp assignments
  ConsultantView.tsx            # Individual contributor view (My Work tab)
  CasesView.tsx                 # Support cases with analytics and filters
  AiInsights.tsx                # AI-generated portfolio/project insights

lib/
  netsuite.ts                   # NetSuite OAuth + SuiteQL query helper
  clickup.ts                    # ClickUp API helpers, list ID resolution
  constants.ts                  # Design tokens (C), employee maps, ClickUp overrides
  types.ts                      # Shared TypeScript types
  health.ts                     # Project health scoring helpers
```

---

## Dashboard Tabs

### Projects
- Sortable table of active NetSuite projects (click any column header)
- Columns: Client, Health, Progress, Phase, Hours Left, Budget Fit, Go-Live, Blocked, Assigned
- Expandable per-project metrics: Earned Value (BAC/ETC/SPI/CPI), Task Health, Risk Flags, Milestones, PM Notes
- Phase heatmap (RAG status across all phases)
- AI Insights panel — portfolio-level or single-project analysis via Claude

### Tasks
- Task Command Center: tabbed view of all tasks across projects
- Tabs: Overdue | This Week | Next Week | Upcoming | Milestones | Blocked | Client Pending
- Tab counts shown; group-by-project toggle

### Resources
- Consultant workload derived from ClickUp task assignments
- Per-consultant: open tasks, overdue, due this week, blocked, estimated hours remaining
- Allocation status: Over (>80h), Normal, Light
- Expandable per-project breakdown

### My Work
- Personal view filtered to logged-in consultant (username match)
- Sub-tabs: All | High Priority | Due This Week | Due Next Week | Upcoming | Milestones | At Risk
- Project filter dropdown
- AI workload insight via Claude
- My open support cases section

### Cases
- Open support cases from NetSuite (`supportcase` table)
- Closed/resolved tickets excluded from table
- **KPI bar**: Open Cases, High Priority, Unassigned, Modified Today, Opened This Week, Closed This Week, Avg Days Open
- **Analytics panel** (collapsible): By Status / By Customer / By Assignee — horizontal bar charts
- **Filters**: text search, priority, assigned-to, company, status
- **Table columns**: Case #, Title, Company, Priority, Status, Assigned, Last Modified, Age, Last Note
- All columns sortable; Age colour-coded (yellow >14d, red >30d)
- Case links open directly in NetSuite

---

## ClickUp List ID Resolution

ClickUp URLs stored in NetSuite use an old view-based format (`/v/l/182ddq-XXXXX`) that doesn't expose the real API list ID. Resolution uses a 3-tier fallback:

1. **Static override map** in `lib/constants.ts` (`CLICKUP_LIST_OVERRIDES`) — keyed by NS project ID
2. **View API** — `GET /api/v2/view/{viewId}` to extract list ID
3. **Name matching** — fuzzy match against workspace list names

To add a new project, use `/api/debug/clickup` to browse the workspace hierarchy and find the list ID, then add it to `CLICKUP_LIST_OVERRIDES`.

---

## NetSuite SuiteQL Notes

- Use `BUILTIN.DF(field)` to convert internal IDs to display names (status, priority, company, assigned)
- `supportcase` table: filter with `isinactive = 'F'` for active cases; `closedate` field does not exist in SuiteQL
- `supportcasemessage` table: used for last note per case (best-effort, wrapped in try/catch)
- Phase data from custom saved search via `/api/reports/phase-rag`

---

## AI Insights

Three modes via `POST /api/insights`:

| Mode | Trigger | Prompt focus |
|---|---|---|
| Portfolio | Multiple projects | Cross-portfolio risk, top 2 risks, priority next steps |
| Single project | One project selected | Risk summary, recommended next steps with specifics |
| Consultant | `body.consultant` set | Workload risk, priority actions for the week |

Model: `claude-sonnet-4-6`, max 400–512 tokens per call.

---

## Local Development

```bash
npm install
npm run dev
```

Requires all environment variables set in `.env.local`. See Vercel dashboard for current values.

---

## Deployment

Push to `main` → Vercel auto-deploys. No manual steps required.

```bash
git push origin main
```
