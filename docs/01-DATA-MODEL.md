# 01 — Data Model

## Before implementing

Survey the existing schema first. Some of this may already exist under different
names. **Do not duplicate an existing table.** Report any overlap and propose
adaptations before writing migrations.

All new tables should carry whatever conventions the existing schema uses for
primary keys, timestamps, soft deletes and tenancy.

---

## Layer separation

Two categories of table:

**System of record** — human-entered or synced facts. Contracts, contacts,
commitments. Trustworthy.

**System of attention** — agent-generated opinions. Health snapshots, flags,
profiles, drafts. Must always be visibly attributed and reviewable.

Never write agent output into a system-of-record table.

---

## System of record additions

### `contracts`
The most commonly missing piece, and renewal motion is dead without it.

- `customer_id` → existing customer
- `product` — enum: `netsuite` | `loop_erp` | `services` | `other`
- `start_date`, `end_date`
- `notice_period_days` — critical; the real deadline is usually earlier than end date
- `auto_renew` — boolean
- `annual_value`
- `seat_count` / `licence_count`
- `modules` — array or join table; which NetSuite modules / SuiteApps / Loop modules
- `status` — active | pending_renewal | renewed | churned
- `source` — where this came from (NetSuite record, manual entry)

Derived and exposed, not stored: `days_to_renewal`, `days_to_notice_deadline`.

### `contacts`
Existing customer records likely have contacts. What is probably missing is **role
and liveness**.

- `customer_id`
- `name`, `email`, `job_title`
- `role` — enum: `economic_buyer` | `champion` | `admin` | `end_user` | `technical` | `unknown`
- `is_active` — boolean
- `last_seen_at` — most recent appearance in any ticket, email or meeting
- `first_seen_at`
- `departed_detected_at` — when the system first noticed them going silent
- `notes`

Role matters more than it looks. A champion departing is one of the strongest churn
signals available and is invisible without this.

### `commitments`
Who owes what to whom, by when. Both directions.

- `customer_id`
- `direction` — `we_owe` | `they_owe`
- `description`
- `due_date`
- `status` — open | done | slipped | cancelled
- `source_type` / `source_id` — the call, email or ticket it came from
- `created_by` — human or agent
- `confirmed_by_human` — boolean; agent-extracted commitments need confirmation

### `consultant_sentiment`
The cheapest high-value signal available, and the only route to relational context
given no telemetry.

- `customer_id`
- `project_id` (nullable)
- `consultant_id`
- `rating` — enum: `green` | `amber` | `red`
- `note` — optional free text
- `captured_at`

Capture point: a single optional prompt at time entry or project close. Three
seconds to complete. An amber from a consultant who has been on site outranks any
derived metric in the system.

---

## System of attention tables

### `customer_profiles`
One current profile per customer. See `02-CUSTOMER-PROFILES.md` for extraction.

- `customer_id`
- `modules_owned` — NetSuite modules, SuiteApps, Loop ERP modules
- `netsuite_edition`, `netsuite_version`
- `integrations` — array
- `customisations` — array with descriptions
- `pain_points` — array of `{description, evidence_refs[], confidence, first_seen}`
- `manual_processes` — array; these are the cross-sell targets
- `features_enquired_not_purchased` — array with date and outcome
- `declined_items` — array of `{item, reason, date}` — suppression input
- `industry`, `company_size`
- `extracted_at`, `extraction_version`
- `human_verified` — boolean
- `human_notes` — free text the human can add; never overwritten by re-extraction

**Re-extraction must never destroy human-verified fields or `human_notes`.**

### `health_snapshots`
Append-only. One row per customer per run. History is the point — a score moving
from 80 to 60 matters more than the absolute value.

- `customer_id`
- `computed_at`
- `score` — 0–100
- `band` — healthy | watch | at_risk | critical
- `signals` — JSON: every signal evaluated, its raw value, threshold, and pass/fail
- `rules_version`
- `previous_score`, `delta`

### `health_flags`
Discrete issues requiring attention. Distinct from score, because a flag has a
lifecycle and an owner.

- `customer_id`
- `rule_id`
- `severity` — low | medium | high | critical
- `title`, `reason` — human-readable, one line
- `evidence` — JSON: record IDs and values that triggered it, must support drill-down
- `raised_at`, `resolved_at`
- `status` — open | acknowledged | actioned | resolved | dismissed
- `dismissed_reason`

Flags must be idempotent — re-running the job updates an existing open flag rather
than creating duplicates.

### `outreach_drafts`
See `04-DRAFT-QUEUE.md`.

- `customer_id`, `contact_id`
- `motion` — health_check | qbr | release | renewal | commitment_followup
- `subject`, `body`
- `attachments` — generated PDF references
- `rationale` — why this customer, why now; shown to the reviewer
- `evidence` — JSON, supports drill-down
- `status` — draft | approved | edited | sent | rejected | expired
- `generated_at`, `reviewed_at`, `sent_at`
- `reviewed_by`
- `original_body` — retained when edited; the diff is the training signal
- `suppression_checks` — JSON record of which rules were evaluated and passed

### `release_items`
Parsed release note entries. See `05-RELEASE-MATCHING.md`.

- `product` — netsuite | loop_erp
- `release_version`, `release_date`
- `title`, `description`, `source_url`
- `modules_affected` — array
- `relevance_criteria` — structured conditions for matching
- `category` — new_feature | enhancement | deprecation | breaking_change

### `release_matches`
- `release_item_id`, `customer_id`
- `relevance_score`
- `reasoning` — customer-specific, appears in the PDF
- `matched_on` — which profile attributes drove the match
- `included_in_pdf` — boolean, human-adjustable

---

## Access control

Introduce a `cs_layer` permission distinct from existing roles.

| Data | Consultant | PM | CS/Owner |
|---|---|---|---|
| Projects, tickets, time | ✅ | ✅ | ✅ |
| Consultant sentiment entry | ✅ (own) | ✅ | ✅ |
| Customer profiles | read | read | full |
| Health scores & flags | ❌ | ✅ | ✅ |
| Contracts & renewal data | ❌ | limited | ✅ |
| Outreach drafts & queue | ❌ | ❌ | ✅ |

Enforce server-side. Hiding in the UI is not sufficient.

Rationale worth preserving in a code comment: risk flags visibly change how people
behave toward a client. A false positive that reaches the delivery team becomes
self-fulfilling.

---

## Indexing and volume notes

- `health_snapshots` grows daily per customer. Index on `(customer_id, computed_at)`.
  Plan a retention policy — daily for 90 days, then weekly rollups.
- `health_flags` should index `(status, severity)` for the triage view.
- `outreach_drafts` index `(status, generated_at)`.
- Drafts should expire — a health-check draft generated three weeks ago is stale and
  should not be sendable. Auto-expire after a configurable window.
