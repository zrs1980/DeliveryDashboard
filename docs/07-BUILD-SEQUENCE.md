# 07 — Build Sequence

Ordered by dependency, not by value. Each phase should be working and in use before
the next begins.

---

## Phase 0 — Survey & schema

**Before writing any code**, Claude Code should report:

- Existing stack, ORM, migrations, job scheduler, auth and role model
- How NetSuite and ClickUp data reach the dashboard, and refresh cadence
- The customer identity key everything will join on
- Which proposed tables overlap with existing ones
- Whether email sending exists in the app today

Then: migrations for the new tables in `01-DATA-MODEL.md`, adapted to what exists.

**Done when:** schema deployed, role boundary (`cs_layer` permission) enforced
server-side, no duplicate tables introduced.

---

## Phase 1 — Customer profiles

Everything downstream depends on this.

- Extraction job pulling from ClickUp, NetSuite tickets, project notes, email
- Profile UI with evidence drill-down and inline editing
- Confidence levels and human verification flags
- Re-extraction with diff view, preserving human-verified fields

**Validate on three known accounts before running at scale.** Read the output
yourself. If you wouldn't reference it in an email to that customer, stop and fix the
source data before proceeding.

**Done when:** three profiles are recognisably accurate, contain at least one
manual process you'd forgotten about, and you'd be comfortable quoting from them.

---

## Phase 2 — Health scoring & triage

Highest leverage per unit of effort. This is most of what CSM attention is for.

- Signal computation across engagement, delivery, support, relationship, commercial
- Rules engine with rules stored as editable data, not code
- Starter rule set from `03-HEALTH-SCORING.md`
- Nightly job iterating **every account**, including silent ones
- Triage view: ranked list, one-line reasons, evidence drill-down
- Acknowledge and dismiss-with-reason actions

Also in this phase: **consultant sentiment capture** at time entry or project close.
Small change, disproportionate value, and it needs time to accumulate data before it
is useful — so add it early.

**Done when:** the daily triage list is short, the reasons are accurate, and you are
checking it without being reminded. If you're ignoring it, the rules are wrong.

---

## Phase 3 — Contracts & renewal calendar

Small, and the cheapest insurance in the package.

- Contract records populated
- Renewal calendar with alerts at 120/90/60/30 days to **notice deadline**, not end date
- Auto-renew and notice-period flags
- Renewal proximity feeding the health rules

**Done when:** no renewal or notice deadline can pass unnoticed.

---

## Phase 4 — Draft queue

Build the review surface **before** any generator. Output needs somewhere to land.

- `outreach_drafts` table and queue UI
- Rationale and evidence display
- Approve / edit / reject / snooze, with keyboard shortcuts
- Suppression rules engine
- Edit capture — retain `original_body`, build the diff view
- Send integration from the human mailbox, with full logging
- Draft expiry

**Done when:** you can approve a draft in under ten seconds and see exactly why it
was generated.

---

## Phase 5 — Health check motion

The simplest generator. Exercises the whole pipeline end to end.

- Flag-triggered draft generation
- Generation rules from `04-DRAFT-QUEUE.md` — specific, short, one ask, verified facts only
- Prior correspondence as tone input

**Done when:** you've sent twenty and had replies. Review what you edited and feed it
back into the prompts.

---

## Phase 6 — Release matching & custom PDFs

The big one. Time it to the next NetSuite release for a real deadline.

- Release note ingestion, including a manual paste path
- Parsing into `release_items` with structured relevance criteria
- Per-customer matching with customer-specific reasoning and stored evidence
- Curation matrix for human adjustment
- Branded PDF generation, 3–7 items per customer
- Covering email through the draft queue

**Validate by generating three PDFs for known accounts and reading them side by side.**
If they're substantially similar, matching isn't working — fix before sending.

**Done when:** three customers would each get a document they'd actually read, and
all three are meaningfully different.

---

## Phase 7 — QBR packs

Last, because it depends on everything above being mature.

- Tiered scheduling from contracts
- Customer-facing pack generation
- Internal briefing page
- Review and edit before finalisation

**Done when:** you've walked into a review with the pack and not needed to prepare
anything else.

---

## Deliberately deferred

| Item | Why |
|---|---|
| Autonomous sending | Permanent exclusion, not a deferral |
| ML churn prediction | Needs churn history; rules outperform until then |
| Reply handling & threading | Design the data model for it; build later |
| Customer portal | Different product |
| Dedicated sending domain | Only when volume justifies it |

---

## Guidance for the implementing agent

**One phase at a time.** Do not scaffold all seven. Each phase should be deployed and
used before the next starts, because each one reveals data gaps that change the next.

**Conform to the existing codebase.** No new frameworks, ORMs, job runners or styling
systems.

**Ask before assuming.** Where a spec conflicts with existing architecture, raise it
rather than working around it. The specs were written without sight of the code.

**The stated non-negotiables hold.** Draft-not-send, evidence on every claim, layer
separation, and the consultant permission boundary are not optimisations to be
refactored away under time pressure.
