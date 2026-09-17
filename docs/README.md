# Customer Success Agent Layer — Spec Package

This package specifies a new module inside the existing project management dashboard:
an agent-assisted customer success layer that monitors account health, generates
customer-specific outreach, and reduces friction on NetSuite and Loop ERP
upsell/cross-sell.

## How to use this package

1. Drop the whole `cs-agent-layer/` folder into the root of your existing repo
   (or into `docs/`, wherever specs live).
2. Open Claude Code in the repo.
3. Start with:

   > Read `cs-agent-layer/00-PROJECT-BRIEF.md` and `cs-agent-layer/07-BUILD-SEQUENCE.md`.
   > Then survey the existing codebase and tell me how the proposed data model in
   > `01-DATA-MODEL.md` should be adapted to what already exists before writing any code.

4. Work through the phases in `07-BUILD-SEQUENCE.md` one at a time. Do not ask
   Claude Code to build the whole package in one pass.

## File index

| File | Purpose |
|---|---|
| `00-PROJECT-BRIEF.md` | Context, goals, constraints, principles. Read first. |
| `01-DATA-MODEL.md` | New tables and fields required. |
| `02-CUSTOMER-PROFILES.md` | Extracting structured customer profiles from NetSuite/ClickUp/email. |
| `03-HEALTH-SCORING.md` | Signal definitions and the rules engine. |
| `04-DRAFT-QUEUE.md` | Review-and-approve email pipeline. The control surface. |
| `05-RELEASE-MATCHING.md` | Release notes → per-customer relevance → custom PDF. |
| `06-QBR-PACK.md` | Quarterly business review generation. |
| `07-BUILD-SEQUENCE.md` | Phasing, dependencies, and definition of done per phase. |

## Non-negotiables

These appear throughout the specs and should not be engineered away:

- **No autonomous sending.** Every outbound email is a draft awaiting human approval.
- **Agent output is separated from system-of-record data.** Different tables, always
  attributed, always timestamped, never silently mixed with human-entered facts.
- **Every flag carries its evidence.** If the system says an account is at risk, it
  must be able to show exactly which signals fired and what the underlying values were.
- **Consultants do not see commercial risk data.** Role boundary enforced server-side.

## Environment context

- NetSuite — customer master, projects, support tickets, licences
- ClickUp — project delivery
- Email — primary outreach channel
- Existing dashboard already surfaces tickets, projects, consultant time, customer details
- **No product usage telemetry.** Health signals derive from delivery, support,
  engagement and relationship data instead. This is a constraint, not an oversight.
