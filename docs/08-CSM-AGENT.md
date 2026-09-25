# 08 — CSM Agent

## What this is

An agent that does the judgment work of a Customer Success Manager across the
book: deciding which accounts need attention, who to talk to, about what, and
proposing the outreach. It sits on top of everything built in phases 0–5 and
reuses it rather than replacing it.

It is the natural extension of two things that already exist:

- **The research agent** (`lib/cs-research.ts`, `app/api/cs/research/[customerNsId]`)
  already proves the pattern: a bounded, logged tool-use loop over customer data.
- **The health-check motion** (`lib/cs-healthcheck.ts`) already proves the writing
  rules and the no-fabrication filter. Today it is a single model call, triggered
  by a human choosing an account and a flag.

The CSM agent combines them. It chooses the account, the contact, and the motion
itself, then proposes a draft through the same queue and approval path.

**It never sends.** The only way anything leaves the building is a human pressing
Approve in the Draft Queue. See "Non-negotiables".

---

## Why an agent here, and not elsewhere

`lib/cs-research.ts` says it plainly: the research agent is "the one genuinely
agentic surface in the module", because which document matters depends on what the
earlier ones said. The same test applies here.

Deciding *whether* to contact an account, *who*, and *about what* depends on reading
the account in context: a flag, a renewal date, an unanswered email, a project that
wrapped, a ticket we still owe them. The inputs interact. Fixed rules for every
combination would be the hardcoded outreach logic we are trying to avoid.

Everything else stays deterministic code, exactly as it is now:

| Stays code | Why |
|---|---|
| Signal computation and scoring (`cs-signals.ts`, `cs-scoring-run.ts`) | Must be reproducible and explainable |
| Rules engine and flags (`cs-rules.ts`) | Rules are data, edited by a human |
| Suppression (`cs-suppression.ts`) | A guarantee, not a suggestion |
| The verified-fact filter (`quotableFacts`) | Withholding material is the only real guarantee against fabrication |
| Contract and renewal dates (`cs-ns-contracts.ts`) | Dates are facts, never inferred |
| Sending (`gmail-send.ts`, `/api/cs/drafts`) | Human action only |

**The principle: hardcode the guardrails and the data access; let the agent make the
judgment calls.**

---

## What the agent decides vs. what code enforces

| The agent decides | Code enforces, inside the tools |
|---|---|
| Whether this account warrants outreach at all | Suppression rules, at proposal time and again at send time |
| Which motion fits (health check, renewal, commitment follow-up, release) | Motion is valid only if its trigger condition holds (see "Motions") |
| Which contact, and why them | Contact must exist in `cs_contacts`, be active, not opted out, and hold a role allowed for the motion |
| What to say | Every fact cited must be from the verified set; banned phrases are linted; length limits enforced |
| Whether a human should step in instead | Hard budget on tool calls and wall-clock time |

If a rule appears in the right-hand column, it must not also depend on the prompt.
The prompt may *mention* it so the model wastes fewer calls, but the tool is what
holds.

---

## Run model

### Triggers

1. **Nightly, after scoring.** When `runHealthScoring()` completes in
   `/api/cs/cron/health`, enqueue candidate accounts into `cs_agent_runs` with
   status `queued`. Candidates are accounts with an open or acknowledged flag,
   accounts entering a renewal notice window, and accounts with an overdue
   commitment. Cap the nightly batch (start at 10) so the review queue stays small.
   Review throughput is the bottleneck (see `00-PROJECT-BRIEF.md`).
2. **On demand.** A "Run CSM agent" action per account in Triage, which enqueues
   one run and processes it immediately.

### Processing

Vercel functions are capped at `maxDuration = 300`. So:

- **One account per invocation.** Never loop the book inside one function.
- A second cron route, `/api/cs/cron/agent`, picks the oldest `queued` run, marks it
  `running`, processes it, and exits. Schedule it every few minutes during a window
  after the nightly scoring job (for example 07:15–08:00 UTC, every 5 minutes).
- Authenticate with `requireCronSecret`, and exempt the path in `proxy.ts` exactly
  as `/api/cs/cron/health` is. Otherwise the request is redirected to `/login` and
  returns HTML 200, which looks like a healthy run.
- Use a conditional update (`status = 'queued'` → `'running'`) so two overlapping
  invocations can't take the same run.

### Bounds (enforced in code, as in the research route)

| Bound | Starting value |
|---|---|
| Max tool calls per run | 20 |
| Wall-clock budget | 240 s |
| Outreach proposals per run | 1 |
| `flag_for_human` calls per run | 1 |

When a budget is hit, force a terminal tool call (`tool_choice` set to
`skip_account`) with the reason "budget reached", and record the stop reason. A run
that ran out of budget must never look like a considered decision.

### Terminal state

A run ends when the agent calls `propose_outreach` or `skip_account`. It may call
`flag_for_human` once, either on its own or alongside one of the terminal tools. A
run that ends without a terminal call gets one nudge, then is marked `stopped` with
`stop_reason = 'no_decision'`. Same pattern as `no_submit` in the research route.

---

## Tools

### Shared infrastructure first

Before adding tools, extract the loop and the tool runner out of
`app/api/cs/research/[customerNsId]/route.ts`:

- `lib/cs-agent-loop.ts`: the bounded loop, budget handling, forced terminal call,
  tool-error-returned-not-thrown, and run logging. Parameterised by system prompt,
  tool set, terminal tool names and bounds.
- `lib/cs-agent-tools.ts`: tool definitions and implementations, keyed by name, so
  both agents share the same `list_projects`, `search_support_cases` and so on.

The research agent must behave identically after the refactor. Verify against a
recent `cs_research_runs` row before moving on.

### Read tools

| Tool | Input | Returns | Source |
|---|---|---|---|
| `get_account_snapshot` | (none; bound to the run's customer) | Latest signals, score and band; open and acknowledged flags with reasons; the **verified** profile facts, each with a stable `factId`; count of withheld facts | `cs_health_snapshots`, `cs_health_flags`, `cs_customer_profiles` via `quotableFacts()` |
| `list_contacts` | (none) | Active contacts: id, name, role, email domain (not full address), last contacted date, opt-out state | `cs_contacts` |
| `get_contract` | (none) | Contract status, end date, notice deadline, auto-renew, days to notice | `cs_contracts` / `cs-ns-contracts.ts` |
| `get_outreach_history` | `days?` (default 180) | Prior drafts and sends to this account: motion, contact, status, sent date, rejection reason | `cs_outreach_drafts` |
| `get_open_commitments` | (none) | Open `we_owe` and `they_owe` commitments with due dates | Commitments table per `01-DATA-MODEL.md` |
| `get_recent_correspondence` | `days?` (default 90) | Recent email threads and meetings with this customer's domain: date, participants, subject or meeting title, short excerpt | `gmail`, `fireflies.ts` (see Phase 2) |
| `list_projects` | (none) | Reuse from research agent | NetSuite |
| `list_clickup_tasks` | `projectNsId` | Reuse from research agent | ClickUp |
| `search_support_cases` | `query` | Reuse from research agent | NetSuite |
| `list_documents` / `read_document` | as today | Reuse from research agent | Drive |
| `get_latest_research` | (none) | Most recent completed `cs_research_runs` summary, findings and next steps, if under 30 days old | `cs_research_runs` |

Notes:

- `get_account_snapshot` is the **only** source of quotable facts. The other read
  tools help the agent reason, but anything it wants to put in an email must be
  cited by `factId` from the snapshot. That keeps the no-fabrication guarantee in
  one place.
- Nothing returns commercial values (contract amounts, ACV, pricing). The agent
  needs dates to time outreach, not money. Keep it that way unless there is a
  specific reason to change it.
- Tool failures are returned to the model as text, never thrown, as in the research
  route.

### Action tools

These are the only tools that change anything, and none of them sends.

#### `propose_outreach`

```
{
  contactId:  string,          // from list_contacts
  motion:     "health_check" | "renewal" | "commitment_followup" | "release",
  subject:    string,
  body:       string,
  rationale:  string,          // for the reviewer: why this account, why this person, why now
  factIds:    string[],        // from get_account_snapshot; may be empty only for commitment_followup
  sources:    { kind, ref, label }[]   // what the agent read to decide, for the evidence panel
}
```

Server-side, in this order, before anything is written:

1. **Contact check.** `contactId` belongs to this customer, is active, not opted out,
   and holds a role allowed for this motion (see "Contact selection"). If it fails,
   return the reason to the model so it can choose again. This costs a tool call
   and counts against the budget.
2. **Motion check.** The motion's trigger condition holds (see "Motions"). If not,
   return the reason to the model.
3. **Fact check.** Every `factId` exists in the verified set for this run's snapshot.
   Unknown IDs are rejected, not silently dropped.
4. **Length and lint.** Health check: 3–5 sentences. Run `lintDraft()`. Lint hits are
   stored and shown to the reviewer, not auto-rewritten (same as today).
5. **Unsupported-claim check.** A short second model call with no tools: given the
   body and the text of the cited facts, list any factual claim about the customer
   that the facts do not support. Store the result on the draft. If any are found,
   the draft still lands, marked with a visible warning. This is a reviewer aid;
   the real guarantee is that the model was never shown unverified material.
6. **Suppression.** `runSuppressionChecks()` with the resolved contact. If blocked,
   write the draft with `status = 'rejected'` and the reasons (matching current
   behaviour), and end the run.
7. **Insert** into `cs_outreach_drafts` with `status = 'draft'`, `agent_run_id`,
   `contact_id`, rationale, evidence (`factIds`, `sources`, flag IDs, snapshot
   score/band, withheld count, lint, unsupported claims), and `expires_at` at 14 days.

#### `skip_account`

```
{ reason: string, category: "recently_contacted" | "we_owe_them" | "nothing_specific_to_say"
                             | "no_suitable_contact" | "not_the_right_time" | "other" }
```

Recorded on the run. A skip is a real outcome and should be visible in the UI.
"Nothing specific to say" on an account that keeps getting flagged is useful: it
means the profile needs work.

#### `flag_for_human`

```
{ note: string, urgency: "this_week" | "today" }
```

For situations where an email is the wrong response: a champion who has left close
to a renewal, an escalation brewing in tickets, an account where a call is needed.
Writes a row the Triage view surfaces prominently. Does not create a draft.

---

## Motions

The agent may only use a motion when its trigger holds. The check lives in
`propose_outreach`, not the prompt.

| Motion | Valid when | Lead with | Allowed contact roles |
|---|---|---|---|
| `health_check` | Open or acknowledged flag on the account | An observation about their side: work that wrapped, a go-live, a manual process they were left with | Day-to-day owner, champion |
| `renewal` | Inside the 120-day notice window and no active negotiation | Value delivered; renewal is logistics, never the lead | Economic buyer, champion |
| `commitment_followup` | An overdue `they_owe` commitment exists | The specific item, directly and briefly | Whoever owns the item |
| `release` | A release has been matched to this customer (phase 6) | The specific relevance to their process | Day-to-day owner, champion |

The **QBR** motion stays a human-scheduled pack (phase 7). The agent may use
`flag_for_human` to say a QBR is overdue, but does not generate one.

Map the role names to whatever `cs_contacts.role` actually holds. Confirm during the
Phase 0 survey.

---

## Contact selection

Rules for the agent, enforced as above:

- Prefer the contact with the most recent **two-way** correspondence, from
  `get_recent_correspondence`, over the one with the most senior title.
- Never write to more than one contact at an account per run.
- If the only suitable contact was emailed within the suppression window, skip
  rather than choosing someone else to get around the rule. Choosing a different
  person at the same account to dodge frequency limits is still over-contacting the
  account.
- If no contact holds an allowed role, call `flag_for_human` ("no owner recorded for
  X") and `skip_account` with `no_suitable_contact`. Don't guess.

---

## System prompt (starting draft)

Put the writing rules from the existing health-check `SYSTEM` prompt into a shared
constant so both generators use the same rules. The CSM agent prompt adds the
decision layer:

```
You are the customer success manager at Loop Services, a NetSuite implementation
partner that also sells Loop ERP. You are looking at ONE customer account.

Your job is to decide whether we should reach out to this customer now, and if so,
to whom and about what — then propose the email. A human reviews everything you
propose. Nothing you write is sent without their approval.

HOW TO WORK
- Start with get_account_snapshot and get_outreach_history. Most decisions are
  visible from those two.
- Check get_open_commitments before proposing anything. If we owe them something
  that is overdue, do not ask them for anything. Skip, or flag for a human.
- Check get_recent_correspondence. If someone here spoke to them recently, the right
  answer is usually to skip.
- Read further (projects, tasks, cases, documents, research) only when it would
  change your decision or give you something specific and true to say.
- Finish with exactly one of propose_outreach or skip_account.

DECIDING
- Skipping is a good outcome when it is the right one. An unnecessary email costs
  more than a missed one.
- The goal of outreach is a reply and an open line, not a sale. Commercial topics
  appear only through the renewal and release motions, and only as the tool rules
  allow.
- If an email is the wrong tool — a call is needed, something is going wrong, you
  can't tell who owns the account — use flag_for_human.

WRITING
[shared writing rules from cs-healthcheck.ts SYSTEM, unchanged]

FACTS
- You may reference only facts from get_account_snapshot, cited by factId.
- Other tools help you decide. They are not a source of quotable claims.
- If the verified facts are too thin to say anything specific, skip with
  nothing_specific_to_say. Do not write a vague email to fill the gap.

YOUR RATIONALE is for the reviewer: why this account, why this person, why now, and
which fact the email is built around. One to three sentences.
```

Tune it from the edit and rejection data, not by guessing.

---

## Data model changes

Adapt names to what exists. Do not duplicate tables.

**New: `cs_agent_runs`**

| Column | Notes |
|---|---|
| `id` | uuid |
| `customer_ns_id` | |
| `trigger` | `nightly` / `manual` |
| `status` | `queued` / `running` / `complete` / `stopped` / `failed` |
| `outcome` | `proposed` / `skipped` / `blocked` / null |
| `skip_category`, `skip_reason` | |
| `draft_id` | fk to `cs_outreach_drafts`, nullable |
| `human_flag` | jsonb, nullable |
| `transcript` | jsonb: tool calls with inputs and truncated outputs, for the run viewer |
| `tool_calls`, `duration_ms`, `stop_reason`, `model`, `prompt_version` | |
| `input_tokens`, `output_tokens` | cost tracking |
| `queued_at`, `started_at`, `completed_at` | |

**`cs_outreach_drafts`**: add `agent_run_id` (nullable fk), `unsupported_claims`
(jsonb), `lint` (jsonb) if not already stored. Keep `original_body` capture as-is.

**`cs_contacts`**: add `opted_out` (boolean), `opted_out_at`, `opt_out_reason` if
not present. Wire the `opted_out` suppression check, which is currently `skipped`.

**Active negotiation**: add a per-customer flag (for example on a small
`cs_account_state` table, or on the profile if that fits better), set manually, and
wire the `active_negotiation` suppression check, which is currently `skipped`.

---

## Dashboard integration

Minimal UI. The Draft Queue is already the control surface.

- **Triage**: a "Run CSM agent" action per account, and an indicator on accounts with
  a run today (proposed / skipped / flagged).
- **Human flags**: surfaced at the top of Triage. They are the items that need a
  person, not an email.
- **Draft Queue**: agent drafts show the rationale (already displayed), the evidence
  panel with `sources` and cited facts, lint hits, any unsupported-claim warning, and
  a link to the run.
- **Approve & send**: pre-fill the recipient from `contact_id`. Today the reviewer
  types the address. Keep it editable.
- **Agent runs view**: a list of recent runs with outcome, and a run detail page
  showing the transcript: every tool call, what came back, and the terminal decision.
  This is how you debug the agent. Without it you'll be guessing why it did something.

All routes behind `requireCsLayer()`. Consultants must not see agent runs, since the
transcripts contain renewal dates and risk flags.

---

## Build sequence

Each phase deployed and used before the next starts.

### Phase A — Prerequisites

- Populate `cs_contacts` from NetSuite contacts on the customer record, with role
  mapping. Relationship signals and recipient selection both depend on this.
- Opt-out fields and active-negotiation flag, and wire both suppression checks.
- Pre-fill recipient from `contact_id` on approve.

**Done when:** every active customer you'd plausibly email has at least one contact
with a role, and no suppression check reports `skipped`.

### Phase B — Shared loop

- Extract `lib/cs-agent-loop.ts` and `lib/cs-agent-tools.ts` from the research route.
- Research agent behaves identically.

**Done when:** a research run on a known account produces equivalent output and the
same logging as before the refactor.

### Phase C — Correspondence tool

- `get_recent_correspondence` from Gmail (threads with the customer's email domain)
  and Fireflies (meetings with customer participants).
- Check the Google OAuth scopes first (`/api/debug/google-scopes`). Sending needs
  `gmail.send`; reading threads needs a read scope, which may not be granted yet.
  Adding one requires users to re-consent.
- Return metadata and short excerpts only, not full bodies.

**Done when:** for three accounts, the tool's output matches what you know about
recent conversations with them.

### Phase D — CSM agent, manual only

- `cs_agent_runs`, the agent route, action tools with all server-side checks, the
  run viewer.
- Manual trigger from Triage only. No cron yet.

**Done when:** you've run it on ten accounts where you already know the right answer
(some that should be emailed, some that should be skipped, one where we owe them
work) and it gets at least eight right, with rationales you agree with.

### Phase E — Nightly

- Enqueue after scoring; `/api/cs/cron/agent` worker; batch cap of 10.

**Done when:** the morning queue is short, most drafts are approved with light edits,
and skips are ones you'd have made yourself.

### Phase F — Feedback loop

- Weekly view: approval rate, edit rate, rejection reasons, skip categories, reply
  rate, cost per run.
- Adjust the prompt from the patterns. Bump `prompt_version` on every change, so
  results can be compared across versions.

**Done when:** you've made at least one prompt change driven by edit data and can see
whether it helped.

---

## Evaluation

The agent's quality is measured by the humans reviewing its work, so instrument
that from day one.

| Measure | Healthy direction |
|---|---|
| Approved without edit | Rising |
| Rejected: `wrong person` / `wrong timing` | Falling (these are agent decision failures) |
| Rejected: `tone off` / `factually wrong` | Falling (these are writing failures) |
| Unsupported-claim warnings | Near zero |
| Skip rate | Stable. A sudden change means something upstream changed |
| Replies to agent-proposed sends | The point of the whole system |
| Cost per run | Tracked, budgeted |

Before going nightly, keep a fixed set of 10–15 accounts with known right answers
and re-run it after any prompt or tool change. Regressions show up there first.

---

## Cost and limits

- Budget one account run at roughly research-agent cost, plus the unsupported-claim
  check. Log tokens per run and check real numbers after Phase D, before enabling
  nightly.
- Keep the model in a constant (like `HEALTHCHECK_MODEL` and `RESEARCH_MODEL`) so it
  can be changed in one place.
- Anthropic API rate limits apply per organisation. The one-run-per-invocation model
  keeps concurrency at one, which is fine at this volume.

---

## Non-negotiables

Unchanged from `00-PROJECT-BRIEF.md` and `04-DRAFT-QUEUE.md`, restated because an
agent makes them easier to erode:

- **No send tool, ever.** Not a send tool the prompt says not to use: no send tool
  defined. Sending is a human action in the Draft Queue.
- **Verified facts only**, enforced by what the model is shown and what
  `propose_outreach` accepts, not by instruction.
- **Suppression at proposal and at send.** Both.
- **Every draft carries its evidence** and links to the run that produced it.
- **Consultants don't see agent runs or commercial data.** `requireCsLayer()` on
  every route.
- **Bounded loops.** Budgets in code, stop reasons recorded, partial runs never
  presented as considered ones.

---

## Guidance for the implementing agent

- **Phase A first.** Without contacts, the agent can't choose anyone and will skip
  everything or guess.
- **Conform to the existing code.** Same Supabase patterns, same permission helpers,
  same inline-style design tokens, same cron authentication. No new frameworks, job
  runners or agent libraries. The research route's loop is the pattern.
- **Survey before building.** Confirm the actual names of the commitments table,
  `cs_contacts.role` values, the `MOTIONS` constant in `/api/cs/drafts`, and the
  current Google OAuth scopes, then report back before writing migrations.
- **Ask before assuming.** This spec was written from a read of the repo, not with
  it open. Where it conflicts with what exists, raise it.