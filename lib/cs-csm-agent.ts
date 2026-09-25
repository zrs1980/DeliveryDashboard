import type Anthropic from "@anthropic-ai/sdk";
import { SHARED_TOOL_DEFS } from "./cs-agent-tools";
import { WRITING_RULES } from "./cs-healthcheck";

/**
 * The CSM agent — decides whether to contact an account, who, and about what,
 * then proposes the email.
 *
 * ⚠ IT NEVER SENDS. There is no send tool defined, so the loop cannot reach
 * one. The only way anything leaves the building is a person pressing Approve
 * in the Draft Queue. `lib/gmail-send.ts` sends as the signed-in user's own
 * mailbox, so an unattended run has no credential to send with even if someone
 * wired one up.
 *
 * ⚠ THE PROMPT DESCRIBES THE RULES; THE TOOLS ENFORCE THEM. Anything in the
 * "code enforces" column of 08-CSM-AGENT.md is checked server-side in
 * `propose_outreach` and must not depend on the model having read it. The
 * prompt mentions them only so it wastes fewer calls discovering them.
 */

export const CSM_MODEL = "claude-sonnet-4-6";

/**
 * Bumped on EVERY prompt change. Stored on the run so outcomes can be compared
 * across versions — without it, "did that prompt change help?" is unanswerable
 * and the feedback loop 08 asks for cannot close.
 */
export const CSM_PROMPT_VERSION = "2026-09-25.1";

export const CSM_MAX_TOOL_CALLS = 20;
export const CSM_TIME_BUDGET_MS = 240_000;

// ─── Motions ────────────────────────────────────────────────────────────────

export type Motion = "health_check" | "renewal" | "commitment_followup" | "release";

export interface MotionRule {
  /** Roles allowed to receive this motion. Mapped to what pm_crm_contacts holds. */
  allowedRoles: string[];
  /** Human-readable trigger, shown to the model and used in refusals. */
  trigger: string;
  leadWith: string;
}

/**
 * ⚠ THE ROLE NAMES HERE ARE THE ONES `pm_crm_contacts.role` ACTUALLY HOLDS.
 * 08 writes them in prose ("day-to-day owner", "champion"); the column's CHECK
 * allows economic_buyer · champion · admin · end_user · technical · unknown.
 * "Day-to-day owner" maps to admin and end_user.
 *
 * ⚠ `unknown` IS NEVER ALLOWED. A contact whose role nobody has set is a
 * contact nobody has decided we may write to, and defaulting that to yes would
 * make the whole role field decorative.
 */
export const MOTION_RULES: Record<Motion, MotionRule> = {
  health_check: {
    allowedRoles: ["admin", "end_user", "champion"],
    trigger: "an open or acknowledged flag on the account",
    leadWith: "an observation about their side — work that wrapped, a go-live, a manual process they were left with",
  },
  renewal: {
    allowedRoles: ["economic_buyer", "champion"],
    trigger: "the account being inside the 120-day notice window with no active negotiation",
    leadWith: "value delivered; the renewal is logistics and never the lead",
  },
  commitment_followup: {
    allowedRoles: ["admin", "end_user", "champion", "technical", "economic_buyer"],
    trigger: "an overdue commitment the customer owes us",
    leadWith: "the specific item, directly and briefly",
  },
  release: {
    allowedRoles: ["admin", "end_user", "champion"],
    trigger: "a release matched to this customer",
    leadWith: "the specific relevance to their process",
  },
};

export const SKIP_CATEGORIES = [
  "recently_contacted", "we_owe_them", "nothing_specific_to_say",
  "no_suitable_contact", "not_the_right_time", "other",
] as const;

// ─── Tools ──────────────────────────────────────────────────────────────────

const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_account_snapshot",
    description:
      "The account's health score and band, its open and acknowledged flags, and "
      + "the VERIFIED profile facts you may quote — each with a factId. Also tells "
      + "you how many facts were withheld as unverified. Start here.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_contacts",
    description:
      "Active contacts on this account: id, name, role, job title, whether they "
      + "have opted out, and when they were last seen. Email addresses are not "
      + "shown — you choose a person, not an address.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_contract",
    description:
      "Contract status, end date, notice deadline and days to notice. Dates only "
      + "— no values. You need these to time outreach, not to price anything.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_outreach_history",
    description:
      "What we have already drafted or sent to this account: motion, contact, "
      + "status, date, and why anything was rejected. Check this before proposing.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Default 180." } },
    },
  },
  {
    name: "get_open_commitments",
    description:
      "Open commitments in both directions, with due dates and whether they are "
      + "overdue. If we owe them something overdue, do not ask them for anything.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_meetings",
    description:
      "Meetings with this customer's people in the last N days, from the meeting "
      + "recorder: date, title and attendees. Use it to tell whether someone here "
      + "has spoken to them recently.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Default 90." } },
    },
  },
  {
    name: "get_latest_research",
    description:
      "The most recent research run on this account, if one is under 30 days old: "
      + "its summary, findings and suggested next steps.",
    input_schema: { type: "object", properties: {} },
  },
];

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_outreach",
  description:
    "Propose an email. A human reviews it before anything is sent. Every check "
    + "below runs server-side; if one fails you get the reason back and can choose "
    + "again, at the cost of a tool call.",
  input_schema: {
    type: "object",
    properties: {
      contactId: { type: "string", description: "From list_contacts." },
      motion: {
        type: "string",
        enum: ["health_check", "renewal", "commitment_followup", "release"],
      },
      subject: { type: "string" },
      body:    { type: "string", description: "The email. Three to five sentences." },
      rationale: {
        type: "string",
        description:
          "For the REVIEWER, not the customer: why this account, why this person, "
          + "why now, and which fact the email is built around. One to three sentences.",
      },
      factIds: {
        type: "array",
        description:
          "The factIds from get_account_snapshot that this email relies on. "
          + "Unknown ids are rejected. May be empty only for commitment_followup, "
          + "where the commitment itself is the subject.",
        items: { type: "string" },
      },
    },
    required: ["contactId", "motion", "subject", "body", "rationale", "factIds"],
  },
};

const SKIP_TOOL: Anthropic.Tool = {
  name: "skip_account",
  description:
    "Decide NOT to contact this account now. This is a good outcome when it is "
    + "the right one, and it is recorded rather than discarded.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: [...SKIP_CATEGORIES] },
      reason: { type: "string", description: "One or two sentences, specific to this account." },
    },
    required: ["category", "reason"],
  },
};

const FLAG_TOOL: Anthropic.Tool = {
  name: "flag_for_human",
  description:
    "Raise something a person should handle instead of an email — a champion who "
    + "has left near a renewal, an escalation brewing, an account where a call is "
    + "needed. Does NOT create a draft. Use at most once, then still finish with "
    + "propose_outreach or skip_account.",
  input_schema: {
    type: "object",
    properties: {
      note:    { type: "string", description: "What needs a person, and why." },
      urgency: { type: "string", enum: ["today", "this_week"] },
    },
    required: ["note", "urgency"],
  },
};

/** Read tools, the shared five, then the three that decide. */
export const CSM_TOOLS: Anthropic.Tool[] = [
  ...READ_TOOLS, ...SHARED_TOOL_DEFS, PROPOSE_TOOL, SKIP_TOOL, FLAG_TOOL,
];

export const CSM_TERMINAL_TOOLS = ["propose_outreach", "skip_account"];
/**
 * Forced when a budget runs out. It must be the skip: running out of budget is
 * not a reason to propose contacting a customer, and a proposal assembled under
 * a forced terminal call would be exactly the "partial run presented as a
 * considered decision" this module refuses to produce.
 */
export const CSM_FORCED_TERMINAL = "skip_account";

// ─── Prompt ─────────────────────────────────────────────────────────────────

export const CSM_SYSTEM = `
You are the customer success manager at Loop Services, a NetSuite implementation
partner that also sells Loop ERP. You are looking at ONE customer account.

Your job is to decide whether we should reach out to this customer now, and if
so, to whom and about what — then propose the email. A human reviews everything
you propose. Nothing you write is sent without their approval.

HOW TO WORK
- Start with get_account_snapshot and get_outreach_history. Most decisions are
  visible from those two.
- Check get_open_commitments before proposing anything. If we owe them something
  overdue, do not ask them for anything. Skip, or flag for a human.
- Check get_recent_meetings. If someone here spoke to them recently, the right
  answer is usually to skip.
- Read further (projects, tasks, cases, documents, research) only when it would
  change your decision or give you something specific and true to say.
- Finish with exactly one of propose_outreach or skip_account.

⚠ YOU CANNOT SEE EMAIL. This tool set has no access to anyone's inbox, so
get_recent_meetings shows meetings only. Absence of a meeting does NOT mean
nobody has been in touch — somebody here may have emailed them yesterday and you
would not know. Weigh silence accordingly, and prefer skipping when the account
looks quiet but you have no way to confirm it.

DECIDING
- Skipping is a good outcome when it is the right one. An unnecessary email costs
  more than a missed one.
- The goal of outreach is a reply and an open line, not a sale. Commercial topics
  appear only through the renewal motion, and only when its trigger holds.
- If an email is the wrong tool — a call is needed, something is going wrong, you
  cannot tell who owns the account — use flag_for_human.
- A motion is only available when its trigger holds, and a contact is only
  eligible when their role is allowed for that motion. Both are checked
  server-side; proposing against them costs you a tool call and you will be told
  why.

WRITING
${WRITING_RULES}

FACTS
- You may reference only facts from get_account_snapshot, cited by factId.
- The other tools help you DECIDE. They are not a source of quotable claims.
- If the verified facts are too thin to say anything specific, skip with
  nothing_specific_to_say. Do not write a vague email to fill the gap.

YOUR RATIONALE is for the reviewer: why this account, why this person, why now,
and which fact the email is built around. One to three sentences.
`.trim();

// ─── Output ─────────────────────────────────────────────────────────────────

export interface ProposeOutput {
  kind: "propose";
  contactId: string; motion: Motion;
  subject: string; body: string; rationale: string; factIds: string[];
}
export interface SkipOutput {
  kind: "skip";
  category: string; reason: string;
}
export type CsmOutput = ProposeOutput | SkipOutput;

export function validateCsmOutput(terminalName: string, raw: unknown): CsmOutput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => String(v ?? "").trim();

  if (terminalName === "skip_account") {
    const category = s(o.category);
    return {
      kind: "skip",
      category: (SKIP_CATEGORIES as readonly string[]).includes(category) ? category : "other",
      reason: s(o.reason),
    };
  }

  return {
    kind: "propose",
    contactId: s(o.contactId),
    motion: s(o.motion) as Motion,
    subject: s(o.subject),
    body: s(o.body),
    rationale: s(o.rationale),
    factIds: (Array.isArray(o.factIds) ? o.factIds : []).map(s).filter(Boolean),
  };
}
