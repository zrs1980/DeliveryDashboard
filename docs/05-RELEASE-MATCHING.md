# 05 — Release Matching & Custom PDFs

## The core value of the whole build

NetSuite ships two major releases a year, each with hundreds of changes. Customers
ignore the release notes because they are written for everyone and therefore land for
no one.

We know each customer's modules, customisations, pain points and manual processes.
So we can send each customer a document containing **only what affects them, with
customer-specific reasoning for why it matters.**

Ten customers receive ten different PDFs. That is the differentiator. It converts
upsell outreach from a pitch into a service, which is exactly what earns the open
line of communication.

The same mechanism applies to Loop ERP releases.

---

## Pipeline

```
Release notes → Parse into items → Match per customer → Score & rank
    → Human curation → Generate per-customer PDF → Draft covering email → Queue
```

### 1. Ingest release notes

Sources: NetSuite release notes and release preview documentation; Loop ERP release
notes (internal, likely structured already).

Ingest as PDF, HTML or manual paste. Manual paste must be supported — release note
formats change and an ingestion pipeline that breaks twice a year at exactly the
moment you need it is worse than a paste box.

### 2. Parse into `release_items`

Per item extract: title, description, affected modules, category (new feature /
enhancement / deprecation / breaking change), and structured relevance criteria —
which module, which configuration, which process it touches.

Deprecations and breaking changes matter as much as new features. They are a
*reason to call* that has nothing to do with selling, and they build the credibility
that makes later commercial conversations land.

### 3. Match against customer profiles

For each customer × each release item, score relevance on:

| Dimension | Weight | Note |
|---|---|---|
| Owns the affected module | High | Hard prerequisite for most matches |
| Addresses a known pain point | Very high | Strongest possible match |
| Addresses a known manual process | Very high | Direct cross-sell case |
| Relates to a prior enquiry that didn't convert | Very high | Re-open a dormant opportunity |
| Affects an existing customisation | High | Risk-flavoured; possible service work |
| Deprecation of something they use | Critical | Must-tell regardless of commercial angle |
| General module relevance | Low | Include sparingly |

**Generate reasoning per match**, specific to that customer, referencing the actual
pain point or process. That reasoning becomes the text in their PDF. This is the
difference between "2026.1 includes enhanced inventory counting" and "the new cycle
counting workflow removes the spreadsheet reconciliation step your warehouse team
described in the March scoping session."

Store the evidence. If a match claims a pain point, it must point to the ticket.

### 4. Human curation

Before generation, present a matrix: customers down, matched items across, with
relevance scores. The human can:

- Toggle items in or out per customer
- Reorder by importance
- Edit reasoning text
- Exclude a customer from this release entirely

Cap items per customer — suggest 3–7. A document with thirty items is a release note,
which is the thing they already ignore. Ruthless filtering is the product.

### 5. PDF generation

**Library:** ReportLab Platypus for structured flowing documents. Avoid Unicode
sub/superscript characters — the built-in fonts lack those glyphs and they render as
black boxes. Use `<sub>` / `<super>` markup in Paragraph objects instead.

Alternative if the stack is JS-heavy: HTML template → headless Chrome → PDF. Better
for design control and easier to iterate on. Choose based on existing stack; do not
introduce a Python service into a Node codebase for this alone.

**Structure:**

1. Cover — customer name, release version, date, your branding
2. Short intro — two or three sentences, customer-specific, why you're sending this
3. Relevant items — each with: what it is, **why it matters to you specifically**,
   what it would take to adopt, and whether it needs a licence change
4. Items requiring action — deprecations or breaking changes affecting them
5. Close — offer to walk through it

The "why it matters to you specifically" block is the entire point. If that section
reads generically, the document has failed and is no better than the vendor's own notes.

**Requirements:** branded template, consistent typography, professional enough to
forward internally to a CFO. Store generated PDFs against the customer record and
link them from the draft queue.

### 6. Covering email

Short. Reference one or two of the most relevant items by name. Attach the PDF.
Offer a conversation. Routed through the draft queue like everything else.

---

## Loop ERP cross-sell

Same mechanism, different targeting. The match is against **manual processes** in
the customer profile rather than modules owned.

The strongest cross-sell signal in the whole system: a customer with a documented
manual process, evidenced in consultant notes, that a Loop ERP module directly
addresses. The business case writes itself because the pain is already documented in
their own words from a scoping session.

Maintain a mapping of Loop ERP capabilities → the manual processes they eliminate.
Run it against profiles on a schedule, not only on release. Surface matches in the
triage view as opportunities rather than risks.

---

## Timing

Time the first build to the next NetSuite release — a real deadline forces the
pipeline to actually work end to end.

For NetSuite specifically: release preview arrives before general availability.
Reaching out during preview, ahead of the release landing, is materially more
valuable to the customer than reaching out after. Build the ingestion to handle
preview documentation.

---

## Validation

Before sending anything, generate PDFs for three customers you know well and read
all three side by side.

- Are they meaningfully different from each other?
- Does each one contain something the customer would actually care about?
- Would you be comfortable if all three recipients compared notes?

If the three documents are substantially similar, the matching is not working and the
profiles are too thin. Fix that before scaling — a generic "personalised" document is
worse than sending nothing, because it teaches the customer to ignore you.
