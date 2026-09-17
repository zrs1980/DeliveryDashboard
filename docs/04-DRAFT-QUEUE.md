# 04 — Draft Queue & Email Pipeline

## The control surface

This is the most important component in the package. Every generated communication
passes through here. Build it **before** building any generator, so there is
somewhere for output to land and be inspected.

## Non-negotiable: draft, never autosend

Every outbound email is a draft awaiting explicit human approval. This is permanent,
not a v1 safety measure to be removed later.

Three reasons, worth preserving in a comment at the top of the sending module:

1. A wrong email to a customer is unrecoverable in a way a wrong database row is not.
2. The goal is to *open* relationships. One tone-deaf automated message closes them,
   and the failure is silent — people don't tell you they've written you off.
3. Human review is the training signal. What gets edited reveals where generation is
   weak. Removing review removes the feedback loop.

In practice most drafts will be approved in seconds. The 10% that get rewritten are
the ones that would have cost something.

---

## Pipeline

```
Trigger → Generate → Suppression checks → Draft queue → Human review → Send → Log
```

### Trigger
- Health flag raised (health_check motion)
- Scheduled QBR due
- Release published and matched
- Renewal window entered
- Commitment overdue

### Generate
Compose using customer profile, health signals, recent history, and prior
correspondence. See generation rules below.

### Suppression checks
Run before the draft reaches the queue. Record which checks were evaluated.

| Rule | Behaviour |
|---|---|
| Open escalation on account | Block |
| Contacted within 14 days | Block |
| More than 2 emails to this contact in 30 days | Block |
| Contact marked inactive or departed | Block |
| Customer opted out | Block, permanently |
| Active commercial negotiation in progress | Block |
| Overdue `we_owe` commitment on the account | Block — do not ask for anything while we owe them something |
| Topic previously declined by this customer | Block for that topic |
| Contact is not the right role for this motion | Reroute or block |

That last-but-two rule matters more than it appears. Sending an upsell to a customer
we owe work to is the fastest way to damage the relationship.

### Queue
Drafts land with status `draft`. Auto-expire after a configurable window (suggest
14 days) — a stale health-check reference is worse than no email.

### Review
See UI below.

### Send
On approval, send from the human's mailbox. Log fully.

---

## Review interface

Optimise for **fast approval**. The human is the throughput bottleneck; every extra
click is a queue that backs up.

Each queued item shows:

- **Recipient** — name, role, company, last contacted
- **Why this, why now** — the rationale in one or two lines. Non-negotiable field.
- **Evidence** — expandable; the actual flags, tickets, projects behind it
- **The draft** — subject and body, inline editable
- **Attachments** — generated PDF, previewable
- **Suppression checks passed** — collapsed, but visible

Actions: **Approve & send** · **Edit & send** · **Reject** (with reason) · **Snooze**

Keyboard shortcuts for approve/reject. Batch approve for low-risk motions once
confidence is established.

### Capture the edit

When a draft is edited, retain `original_body`. The diff between generated and sent
is the highest-value training data in the system. Build a view showing recent edits
side by side — patterns will be obvious within twenty reviews and should feed back
into the generation prompts.

Rejection reasons should be a short enum plus free text: *wrong timing · wrong person
· tone off · factually wrong · not relevant · already handled*.

---

## Generation rules

**Specific, not templated.** If the email could have been sent to any customer, it is
worthless. Every message must reference something true and particular about this
account: a project completed, a ticket resolved, a process they described, a feature
they asked about eighteen months ago.

**Short.** Three to five sentences for health checks. Long automated email reads as
marketing and gets filed accordingly.

**One ask, at most.** Usually a conversation, not a purchase.

**No fabrication, ever.** Only reference facts traceable to a record. If the profile
field is low-confidence or inferred rather than observed, it cannot appear in an
email without human sign-off. This must be enforced in the generation step, not left
to the model's discretion — pass only verified fields into the prompt.

**Match the existing relationship.** Pull tone from prior correspondence with that
contact where available. A customer you've worked with for six years should not
receive a formal introduction.

**Human voice.** The email sends from a person and should read like one. No
"I hope this email finds you well." No "I wanted to reach out." No bullet-pointed
value propositions.

### Motion-specific guidance

**Health check** — Lead with the observation, not the ask. "Noticed the Q3 project
wrapped and things have been quiet since — is the new process bedding in okay?"
Purpose is a reply, not a meeting.

**Release** — Lead with the specific relevance. "Three things in the 2026.1 release
touch the inventory reconciliation you've been doing manually." Attach the custom PDF.

**Renewal** — Never lead with the renewal. Lead with the value delivered, reference
the renewal as logistics.

**Commitment follow-up** — Direct, brief, no padding.

---

## Sending infrastructure

For v1, send from the human's existing mailbox via the connected email integration.
Volume is low and deliverability follows the existing sender reputation.

Watch for: if volume climbs past roughly 50–100 sends a week, move to a dedicated
sending domain with proper SPF/DKIM/DMARC. Personal mailbox reputation degrades
quickly under automated volume, and the damage extends to genuine correspondence.

Log every send: recipient, content, timestamp, message ID. Thread replies against
the original where the integration supports it, so responses appear in the account
timeline rather than disappearing into the inbox.

## Reply handling

Out of scope for v1, but design the data model so it can be added:

- Store `message_id` on sent drafts
- Allow linking inbound replies to the originating draft
- Reply received should clear any open health flag on that account and reset the
  contact-frequency clock

A reply is the goal of the entire system. Make sure it is visible when it happens.
