# 06 — Quarterly Business Review Pack

## Purpose

A QBR is the vehicle that lets a commercial conversation happen without it being a
sales call. The structure does the work: value delivered first, forward-looking
opportunity second. The upsell sits inside a value review rather than standing alone
as an ask.

The agent assembles the pack. The human presents it.

## Cadence

Not every customer needs a quarterly review. Tier by contract value and relationship:

| Tier | Cadence |
|---|---|
| Top accounts by ARR | Quarterly |
| Mid | Twice yearly |
| Long tail | Annually, or triggered by renewal approach |

Schedule from the `contracts` table. A QBR should always land comfortably before the
notice deadline, not after it.

## Pack structure

### 1. Period summary
- Projects delivered, with outcomes
- Consultant hours consumed, against plan or retainer
- Tickets raised, resolved, average resolution time
- Anything notable — go-lives, escalations resolved, milestones

### 2. Outcomes against stated goals
The hardest section and the most valuable. Pull the original engagement goals from
project scoping documents and report against them.

If original goals were never captured in a structured way, this section will be
weak — and that itself is a finding. Fix it going forward by capturing success
criteria at project kickoff. Note this as a gap rather than generating filler.

### 3. Support and delivery health
- Ticket trends over the period
- Resolution time trend
- Recurring themes — clusters of tickets on the same underlying issue
- Open items and their status

Recurring ticket themes often reveal a training gap or a configuration problem. Both
are legitimate, non-salesy reasons for further engagement.

### 4. Forward look — relevant capability
Where the commercial content sits.

- Upcoming NetSuite release items relevant to them (from `release_matches`)
- Loop ERP capability addressing manual processes documented in their profile
- Features they enquired about previously that are now viable
- Optimisation opportunities visible in their delivery history

Each framed as **their problem first, capability second.** Not "Loop ERP offers
automated reconciliation" but "the month-end reconciliation your team described takes
roughly two days per cycle — here's what would remove it."

### 5. Proposed next steps
Two or three concrete items. Some should cost nothing — a training session, a config
review. A pack where every recommendation has a price tag reads as a sales document
and the whole framing collapses.

## Generation

Assemble from:
- Project and time data from ClickUp and NetSuite
- Tickets from NetSuite
- Customer profile — pain points, manual processes, enquiry history
- Release matches
- Health snapshot history over the period
- Consultant sentiment, as internal context only

**Consultant sentiment never appears in the customer-facing pack.** It is internal
signal. Surface it to the presenter in a separate internal briefing page.

## Output

Two artefacts:

**Customer-facing pack** — PDF or slides, branded, presentable. Same generation
approach as release PDFs (see `05-RELEASE-MATCHING.md`).

**Internal briefing** — one page, for the human before the call:
- Health score and trend, flags open
- Consultant sentiment and any concerns
- Contract position, days to renewal and notice deadline
- Open commitments both directions
- Contact map — who's still there, who's gone quiet
- Known objections and previously declined items
- Suggested talking points and what to avoid

The internal briefing is arguably more valuable than the pack. It is what a good CSM
would have in their head walking into the room.

## Review

Generated packs enter a review state before use. The human should be able to edit
any section, remove sections, and adjust the forward-look items before the pack is
finalised. Same principle as the draft queue: generated, then approved.

## Build note

This is the last thing to build. It depends on mature customer profiles, working
release matching, and accumulated health history. Built early it will produce thin
packs that undermine confidence in the whole system.
