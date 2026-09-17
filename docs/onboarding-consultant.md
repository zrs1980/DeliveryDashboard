# Onboarding a new consulting employee

Everything that has to be true before a new hire shows up correctly across the dashboard.

Written after Andrea Wilhelm and Ivan Balderas were added to NetSuite on 17 Sep 2026 and
appeared in none of the views people expected. Their employee fields were right; the gaps were
everywhere else.

**The short version:** set `custentity10` on the NetSuite employee record, give them a Google
account on an allowed domain, and add them to ClickUp. Everything else follows. No code change is
needed for a new hire — if you find yourself editing a list of names in `lib/`, something has
regressed.

---

## 1. NetSuite employee record

This is the source of truth. The dashboard reads it live on every request — there is no cache to
clear beyond the 5-minute roster cache in `lib/roster.ts`.

| Field | Set it to | What breaks if you don't |
|---|---|---|
| `isinactive` | unticked | Nothing works. Inactive staff are filtered out of every picker (their name still resolves on old records, which is deliberate). |
| **`custentity10`** — "CEBA Employee Category" | **Consulting (1)** or **PMO (2)** | **The one that matters.** Wrong or blank and they vanish from Delivery Time, Resource Allocation → Forecast, Manager PTO, the SR quota scorecard, the SR assignee dropdown, Admin Utilization and Time Review — while still appearing on Time Analysis, which is what makes it so confusing. |
| `employeetype` | Consultant / Project Manager / … | Rows group under an "Other" heading on Delivery Time. `Project Manager` (or category PMO) is also what puts someone in the PM dropdown. |
| `email` | their Google **primary** address | My Leave returns *"No NetSuite employee found"*. This is the only place a login maps to a NetSuite employee, and it is an exact match. A Workspace **alias** is not the primary address — Google's OIDC claim returns the primary, whatever they typed to sign in. |
| `hiredate` | their start date | PTO accrual silently dates from 1 January instead of their hire anniversary, over-counting leave taken. |
| `targetutilization` | 0.75 for a standard consultant | Defaults to 0.75 anyway, but Delivery Time's billable target is 87% × this number, so a stray 1.0 measures them against 87% while the team sits at 65%. |
| `custentity_ceba_pto_hours` | 80 | My Leave reads "0h remaining". |
| `custentity_ceba_sick_hours` | 40 | As above. |

Note the **internal id** from the URL — useful for the verification step, not needed anywhere else.

`custentity10` values in this account: 1 Consulting · 2 PMO · 3 Managed Services ·
4 Sales and Marketing · 5 Back Office · 6 Management · 7 Product. Only **1 and 2** count as
delivery consultants; the list lives in `CONSULTANT_CATEGORY_IDS` in `lib/roster.ts` if that ever
needs to change.

## 2. Google Workspace

The account must be on a domain in `AUTH_ALLOWED_DOMAIN` (Vercel env var) — today
`cebasolutions.com,loopservices.co`. Anyone else cannot sign in at all.

Watch for a second, separate list: `INTERNAL_EMAIL_DOMAINS` in `lib/constants.ts` also includes
`looperp.ai`. That one decides who counts as "us" on meeting attendee lists. **A `@looperp.ai`
person is internal for meetings but cannot log in** — if you add a new domain, add it to both.

Changing `AUTH_ALLOWED_DOMAIN` requires a redeploy; Vercel does not apply new env values to an
existing deployment.

## 3. ClickUp

Add them to the workspace, and set their ClickUp display name **character-identical to their
NetSuite full name**. There is no id mapping between the two systems — the join is the name
string. Get it wrong and "My Work" is silently empty, imported tasks land unassigned, and weekly
status reports treat them as client-side rather than Loop-side.

## 4. Permissions — only if they need them

These are the only lists still hardcoded, deliberately: they are permissions, not headcount.

| To give them | Edit | Then |
|---|---|---|
| PTO approval (and the Manager PTO tab) | `PTO_APPROVER_EMAILS` — `lib/constants.ts` | deploy |
| Admin Utilization | `ADMIN_EMAIL` — `app/api/admin/utilization/route.ts` | deploy |
| A Slack @handle that isn't their email local part | `SLACK_HANDLES` — `components/dashboard/ServiceRequestsView.tsx` | deploy |

## 5. First sign-in

**They** have to do this, once. The Google consent screen is what writes their `google_tokens`
row, and Calendar, Gmail send and PTO notification emails all depend on it. Until they sign in
those features do nothing for them — with no error.

## 6. Resource allocation

A brand-new hire with no allocation **cannot** appear on Resource Allocation → Allocation. That
grid is built from `resourceallocation` records with a future end date; the employee table is not
even joined. Book them onto a project (any `entitystatus = 2` job) and they appear.

Until then they show on Resource Allocation → **Forecast** as Bench, at the bottom of the table,
out of alphabetical order. That is expected, not a bug.

## 7. Refresh

Hard-reload the browser (Ctrl-F5), then click **↻ Refresh Data**.

The reload re-arms the tabs that only fetch once on mount (Manager PTO, My Leave, SR Dashboard);
the button re-reads projects, allocations and cases. Delivery Time and Time Analysis have their
own **↻ Refresh** inside the tab. The roster itself is cached for 5 minutes, so a NetSuite change
can take that long to appear.

Then `POST /api/employee/sync` to copy hire dates into Supabase.

---

## Where they will and won't appear

The single most useful thing to know: every view draws its people from either a **roster** (a
NetSuite query — a new hire is there immediately, at zero) or from **data** (time, allocations,
ClickUp assignments — a new hire is absent until they have some). Neither is broken.

| View | Source | New hire visible? |
|---|---|---|
| Delivery Time | roster, filtered to Consulting + PMO | **Yes** — immediately, showing "No data" |
| Time Analysis | roster, every active employee | **Yes** — immediately |
| Resource Allocation → Forecast | roster + allocations | **Yes** — as Bench |
| Manager PTO | roster, `custentity10 IN (1,2)` | **Yes** |
| SR Dashboard (quota) | roster, `custentity10 IN (1,2)` | **Yes** — at 0 SRs, red RAG, and they dilute team attainment |
| SR Pipeline assignee dropdown | roster, consultants | **Yes** |
| PM task assignee · health-check consultant | roster | **Yes** |
| Resource Allocation → Allocation grid | allocations only | **No** — until allocated |
| Manager Review | time or allocations | **No** — until one exists |
| My Work · Tasks | ClickUp assignees | **No** — until assigned a task |
| Cases · Projects PM column | data, name resolved from roster | Only once they own a case / log the most hours on a project |
| My Leave | the signed-in user | **Yes**, once they sign in and the email matches |

Two counters deliberately exclude them: Delivery Time's *"N active consultants"* counts only
people with hours, and Resource Allocation's *Total Resources* counts only people with
allocations.

## Verifying it worked

With them signed in, or from your own session:

1. `GET /api/staff?category=consultants` → they are in the list.
2. `GET /api/employee/me` while signed in as them → 200, not 404. This is the one that proves the
   email matches.
3. `GET /api/manager/employees` → present (Manager PTO).
4. `GET /api/service-requests/metrics` → they have a quota row.

If a response carries `rosterFallback: true`, NetSuite was unreachable and the names you are
looking at came from the emergency constants in `lib/constants.ts` — fix that before trusting
anything on the page.

## Sharp edges worth knowing

- **Names are the join key in more places than they should be.** Resource Allocation groups the
  grid by employee *name* (`ResourceAllocation.tsx`), and the Forecast roster merge de-dupes by
  name too — so a person whose NetSuite name differs from the name on their allocation rows can
  appear twice, once with hours and once at 0%.
- **`/api/employee/me`'s name fallback** splits the Google display name on whitespace and takes
  the first and last word. It fails on middle names and two-word surnames ("Loza Palma" → "Palma"),
  which is why the email match matters.
- **Leave must be booked to one of the PTO/Sick/Holiday jobs** in `LEAVE_PROJECT_IDS`
  (`lib/constants.ts`), or it counts against their utilization instead of being excluded from it.
- **One-click PTO approval from the emailed link records the reviewer as Zabe**, whoever clicked
  it (`app/api/pto-requests/[id]/review/route.ts`). Known bug, not yet fixed.

## Offboarding

Tick `isinactive` in NetSuite. That is the whole procedure — they drop out of every picker,
their allocations stop showing, and their name still resolves on the cases, projects and service
requests they worked on. Remove them from `PTO_APPROVER_EMAILS` / `ADMIN_EMAIL` separately if
they were on either.
