# 00 — Project Brief

## What we are building

An agent-assisted customer success layer inside the existing project management
dashboard. It replaces the sensing, preparation and record-keeping work of a
Customer Success Manager, leaving the human to do the calls, the judgment and the
negotiation.

It is **not** a CRM replacement and **not** an email marketing tool.

## Why

We are a NetSuite partner also selling Loop ERP. We want to:

1. Keep an open line of communication with every customer without hiring a CSM.
2. Detect accounts going quiet before they churn.
3. Reduce friction on NetSuite and Loop ERP licence upsell/cross-sell by making
   outreach genuinely useful rather than promotional.

The core insight the build should serve: **NetSuite ships two major releases a year
with hundreds of changes, and customers ignore the release notes because they are
undifferentiated.** We know each customer's modules, configuration, open pain points
and manual workarounds. So we can tell each customer *only* what is relevant to them,
and why. That is the differentiator. Everything else supports it.

## The three motions

### 1. Health check — monthly, low touch
Triggered by risk signals. Output is a short, specific, personal email referencing
something real about the account. Purpose is conversation, not conversion.

### 2. QBR — quarterly, high touch
Agent assembles a pack: work delivered, ticket trends, outcomes against original
engagement goals, plus a forward-looking section on relevant upcoming NetSuite
features and Loop ERP capability covering processes the customer currently does
manually. Human presents it. The commercial conversation sits inside a value
review rather than being a standalone ask.

### 3. Release-driven — per NetSuite release and Loop ERP release
Parse release notes, match features to individual customer profiles, generate a
per-customer PDF containing only relevant items with customer-specific reasoning,
draft the covering email. Ten customers receive ten different documents.

## Architectural stance

The existing dashboard is a **system of record**: humans enter facts, the app stores
and displays them.

This module is a **system of attention**: it reads the record on a schedule, forms
judgments, and proposes actions. Its outputs are *opinions*, not facts.

Keep the seam clean:

- Agent-generated content lives in its own tables, never written into
  system-of-record tables.
- Every agent output row carries: generation timestamp, the inputs it was derived
  from, the model/rule version, and a human review state.
- Nothing generated becomes an external action without explicit human approval.

## Hard constraints

| Constraint | Implication |
|---|---|
| No product usage telemetry | Health scoring uses delivery, support, engagement and relationship signals only. Do not design around usage data that does not exist. |
| Consultants and PM use the same dashboard | Commercial risk data sits behind a role boundary, enforced server-side, not just hidden in the UI. |
| Small number of historical churns | Start with human-authored rules, not statistical inference. Anomaly detection over prediction. |
| Single human in the loop | Review throughput is the bottleneck. Optimise for fast approval, not volume of generation. |

## Principles

**Evidence or it didn't happen.** Every flag, score and draft must be traceable to
specific underlying records. A health score with no drill-down is worse than no
health score, because it will be trusted and shouldn't be.

**Draft, never send.** A wrong dashboard entry is recoverable. A wrong email to a
customer is not. The review queue is a permanent feature, not training wheels.

**Rules before inference.** Encode what the business already knows. Statistical
learning can come later, once there is churn history to learn from.

**Silence is the loudest signal.** The most dangerous account state is one where
nothing is happening — no tickets, no hours, no projects. Nothing in a conventional
event-driven system fires an alert when nothing happens. This module must explicitly
detect absence.

## Out of scope for v1

- Autonomous email sending
- Predictive/ML churn modelling
- Customer-facing portal
- Contract lifecycle management or e-signature
- Replacing NetSuite as the customer master
- Marketing automation, campaigns, or list-based sending

## Integration notes for the implementing agent

Before writing code, survey the existing codebase and report back on:

- Current stack, ORM, migration tooling, job scheduling, auth and role model
- How NetSuite and ClickUp data currently reach the dashboard (live API, sync job,
  cached tables?) and the refresh cadence
- Existing customer identity model — the key everything will join on
- Whether email access exists in the application today, or needs to be added

**Conform to what exists.** Do not introduce a new framework, ORM, job runner or
styling system. This module should look and feel like part of the application it
lives in.
