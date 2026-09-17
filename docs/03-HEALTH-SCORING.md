# 03 — Health Scoring & Triage

## Constraint that shapes everything here

**There is no product usage telemetry.** We cannot see whether customers are using
the software. We can see whether the *relationship* and the *delivery* are healthy —
engagement, support, project delivery and relationship continuity.

For a services-attached partner model this is arguably a better signal anyway: a
customer winding down stops booking consultant time months before they say anything.

Do not design around usage data. It does not exist.

---

## Signals

### Engagement — are they still investing?

| Signal | Computation | Why it matters |
|---|---|---|
| Days since last consultant hour | max(time_entry.date) to today | Primary silence detector |
| Hours this month vs trailing 3-month avg | ratio | Decline precedes departure |
| Retainer / block burn rate | consumed vs elapsed | Not burning = disengaged |
| Forward-scheduled work | count of projects with future start | Empty calendar = strong signal |
| Days since last project closed | — | Combined with no forward work, serious |

### Delivery — is the work going well?

| Signal | Computation |
|---|---|
| Projects over estimate | actual vs estimated hours, % over |
| Milestone slippage | count of pushed target dates |
| Rework | hours logged against completed items |
| Stalled projects | open, no activity 30+ days |
| Project duration vs comparable projects | outlier detection |

### Support — is friction increasing?

| Signal | Computation |
|---|---|
| Ticket volume vs trailing average | ratio |
| Time to resolution, trend | degrading = problem |
| Reopened ticket rate | quality signal |
| Severity mix shift | more high-priority over time |
| Ageing tickets | open, no update 7+ days |
| Ticket sentiment | LLM-scored on ticket text; cheap and predictive |

### Relationship — are the right people still there?

| Signal | Computation |
|---|---|
| Distinct active contacts, last 90d vs prior 90d | contraction is a warning |
| Champion silence | days since the `champion`-role contact appeared anywhere |
| Contact concentration | % of tickets from a single person; single point of failure |
| New unknown contacts appearing | could be a transition, good or bad |
| Consultant sentiment | latest `amber`/`red`, and trend |

### Commercial

| Signal | Computation |
|---|---|
| Days to renewal | from `contracts` |
| Days to notice deadline | the real deadline |
| Open commitments overdue (we_owe) | trust damage |
| Seat utilisation vs licensed | expansion or contraction indicator |

---

## The absence problem

Conventional alerting is event-driven and therefore blind to the most dangerous
state: **nothing happening at all.**

The nightly job must evaluate **every account**, including ones with no activity —
not iterate over recent events. An account with zero tickets, zero hours and zero
projects for 90 days generates no events and is the account most likely to churn.

Make this explicit in the implementation. It is the single easiest thing to get wrong.

---

## Rules engine

Start with **human-authored rules**, not statistical inference. There is insufficient
churn history to learn from, and encoded business knowledge will outperform any model
at this stage.

Rules should be data, not code — stored, versioned, editable in the UI without deploy.

Rule shape:

```
id:            silence_with_no_forward_work
severity:      high
condition:     days_since_last_hour > 45
               AND forward_scheduled_projects == 0
               AND contract_status == 'active'
title:         "Gone quiet with nothing booked"
reason:        "No consultant hours in {days_since_last_hour} days and no
                scheduled work. Last project closed {days_since_project_close} days ago."
evidence:      [last_time_entry, last_project, contract]
```

### Starter rule set

Compound rules matter more than single-signal ones. Any one signal alone is noise.

| Rule | Condition | Severity |
|---|---|---|
| Silent account | no hours 45d AND no forward work | high |
| Deep silence | no hours 90d AND no tickets 90d | critical |
| Engagement decline | hours < 50% of trailing avg for 2 consecutive months | medium |
| Champion lost | champion contact silent 60d | high |
| Contact contraction | active contacts down >50% vs prior period | medium |
| Renewal approaching, unhealthy | days_to_notice < 90 AND band in (watch, at_risk) | critical |
| Renewal approaching, no contact | days_to_notice < 90 AND no outreach 60d | high |
| Delivery trouble | project >30% over estimate OR 2+ milestones slipped | medium |
| Support escalation | ticket volume >2× trailing avg | medium |
| Resolution degrading | avg TTR up >50% over 2 months | medium |
| Stalled work | open project, no activity 30d | low |
| Consultant red flag | any `red` sentiment in last 30d | high |
| Consultant amber trend | 2+ `amber` in last 60d | medium |
| Broken promise | overdue `we_owe` commitment | high |
| Single point of failure | >80% of tickets from one contact | low |

### Scoring

Weighted composite across the four categories, 0–100, banded:

- 80–100 healthy
- 60–79 watch
- 40–59 at_risk
- below 40 critical

Weights should be configurable. **The trend matters more than the absolute value** —
surface the delta prominently. A stable 65 is fine; 85 → 65 in a month is not.

Critical-severity flags should be able to override the band regardless of composite
score.

---

## Triage view — build this first

The primary interface. A ranked list answering: *who needs attention today, and why.*

Each row:
- Customer name, health band, score with trend arrow
- **One-line reason** — the highest-severity open flag, in plain language
- Days to renewal, if within 180
- Last contact date
- Expandable evidence — the actual records, clickable
- Actions: generate draft outreach · acknowledge · dismiss with reason · open account

Ranking: severity first, then renewal proximity, then contract value, then score delta.

Keep the default view short. Ten accounts you should look at today is useful; a
list of two hundred sorted by score is not.

## Dismissal is a feature

Let the human dismiss a flag with a reason, and suppress that rule for that account
for a configurable period. Dismissal reasons are the best available feedback on rule
quality — review them monthly and retune. A rule dismissed repeatedly across accounts
is a bad rule.

## Job scheduling

- Nightly full recompute across all accounts
- Store a snapshot per account per run, append-only
- Flags updated idempotently — no duplicates on re-run
- Job failures must alert; a silently dead health job is worse than none, because
  absence of flags will be read as absence of risk
