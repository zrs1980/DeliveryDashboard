# 02 — Customer Profile Extraction

## Why this is phase one

Every downstream motion depends on knowing what each customer has, what hurts, and
what they do manually. Without profiles:

- Release matching cannot work at all
- QBR forward-looking sections are generic
- Health checks are content-free

The information already exists — it is sitting unstructured in ClickUp project
descriptions, NetSuite ticket text, scoping documents and email threads. This job
extracts it into queryable form.

## Sources, in order of value

| Source | Yields |
|---|---|
| ClickUp project descriptions & scoping notes | Modules in use, customisations, integrations, what they asked for |
| NetSuite support tickets | Pain points, recurring friction, who is actually using what |
| NetSuite customer/licence records | Modules owned, seat counts, edition — authoritative |
| Email threads | Enquiries that didn't convert, objections, declined items |
| Consultant notes & time entry descriptions | Manual processes, workarounds, operational reality |

Ticket text and project notes are the richest source of *pain points*. Consultant
notes are the richest source of *manual processes* — which are the cross-sell targets.

## Extraction approach

Run per customer. For each:

1. Pull the corpus — all projects, tickets, notes and threads for that customer,
   bounded to a sensible window (suggest 24 months).
2. Chunk if needed; summarise progressively rather than truncating.
3. Extract to the `customer_profiles` schema.
4. Attach evidence references to every extracted claim.
5. Assign a confidence level per field.
6. Write the profile; flag low-confidence fields for human review.

## Extraction rules

**Every claim needs a source.** A pain point with no ticket or note behind it is a
hallucination. Store `evidence_refs` as record IDs, and make them clickable in the UI.

**Distinguish observed from inferred.** "Customer owns Advanced Inventory" (from a
licence record) is a fact. "Customer struggles with inventory reconciliation" (from
three tickets) is an inference. Mark them differently — inferences go in the email
draft only after human sign-off.

**Capture the negative space.** What they asked about and did not buy, and why, is
as valuable as what they own. It drives both targeting and suppression.

**Manual processes are the highest-value extraction.** Look for phrases in consultant
notes and tickets indicating spreadsheet workarounds, double entry, manual
reconciliation, exports to Excel, offline approval steps. Each one is a concrete
cross-sell hypothesis with a built-in business case.

## Confidence and review

Three levels:

- **High** — from a structured source (licence record, contract). Auto-accept.
- **Medium** — consistently stated across multiple unstructured sources. Accept, flag for review.
- **Low** — single mention or ambiguous. Surface for human confirmation before use in any outreach.

Only high and human-verified medium fields may drive outbound email content.

## Refresh

- Full re-extraction: quarterly, or on demand
- Incremental: when a project closes, or on significant ticket volume
- **Never overwrite `human_verified` fields or `human_notes`** — merge, and flag
  conflicts between new extraction and human-verified values for review

## UI

A profile view per customer:

- Structured summary — modules, integrations, customisations
- Pain points, each expandable to its evidence
- Manual processes, each with a suggested Loop ERP or NetSuite capability that addresses it
- Enquiry history — what they asked about, what happened
- Confidence indicators, and inline editing for human correction
- "Re-extract" action with a diff view before committing

## Validation before scaling

Do not run this across the whole customer base first. Run it on **three accounts you
know well**, then read the output yourself and answer:

- Is this recognisably the customer?
- Are the pain points real, or generic filler?
- Did it find manual processes you'd forgotten about?
- Would you be comfortable referencing any of this in an email to them?

If the answer to the last question is no, the source data is too thin and the fix is
upstream: get consultants capturing more at the point of work. Better to learn that
on three accounts than after processing two hundred.
