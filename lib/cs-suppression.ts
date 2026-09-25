import { getSupabaseAdmin } from "@/lib/supabase";

// ─── Suppression ────────────────────────────────────────────────────────────
//
// Runs before a draft reaches the queue. docs/04-DRAFT-QUEUE.md lists nine
// rules; the record of which ones were evaluated is stored on the draft, because
// "passed suppression" means nothing if half the checks could not run.
//
// The rule the spec singles out, and it is right to:
//
//   "Sending an upsell to a customer we owe work to is the fastest way to
//    damage the relationship."
//
// Several rules need tables that are still empty (pm_crm_contacts roles,
// cs_commitments). Those return `skipped` with the reason — NEVER `passed`. A
// check that could not run has not been passed, and recording it as passed would
// quietly convert missing data into permission to send.
//
// ⚠ THAT RULE WAS STATED HERE FOR MONTHS WHILE TWO CHECKS BROKE IT. Both
// `owed_commitment` and `declined_topic` returned `passed` on an empty read — a
// zero-row query and a genuinely clean account produced byte-identical output.
// Fixed September 2026. When adding a check, the test is not "did the query
// error" but "did I actually learn anything": an empty result from a table
// nothing writes teaches you nothing.
//
// `opted_out` and `active_negotiation` were unconditional skips until the
// columns existed (supabase/cs-phase-a.sql). They are real checks now — but
// both still SKIP rather than pass when what they read is absent: no contact
// means no opt-out state, no profile means no negotiation state.

export type CheckOutcome = "passed" | "blocked" | "skipped";

export interface SuppressionCheck {
  rule:    string;
  outcome: CheckOutcome;
  detail:  string;
}

export interface SuppressionResult {
  blocked: boolean;
  checks:  SuppressionCheck[];
  /** Why it was blocked, for the reviewer. Empty when it passed. */
  reasons: string[];
}

export interface SuppressionInput {
  customerNsId: string;
  contactId?:   string | null;
  contactEmail?: string | null;
  motion:       string;
  /** The subject and body, for the declined-topic check. */
  subject?:     string;
  body?:        string;
}

const DAY = 86_400_000;

export async function runSuppressionChecks(input: SuppressionInput): Promise<SuppressionResult> {
  const supabase = getSupabaseAdmin();
  const checks: SuppressionCheck[] = [];
  const reasons: string[] = [];

  const block = (rule: string, detail: string) => {
    checks.push({ rule, outcome: "blocked", detail });
    reasons.push(detail);
  };
  const pass = (rule: string, detail: string) => checks.push({ rule, outcome: "passed", detail });
  const skip = (rule: string, detail: string) => checks.push({ rule, outcome: "skipped", detail });

  // ── Recent contact, and frequency ────────────────────────────────────────
  const { data: sent, error: sentErr } = await supabase
    .from("cs_outreach_drafts")
    .select("id, contact_id, sent_at, motion")
    .eq("customer_ns_id", input.customerNsId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(50);

  if (sentErr) {
    // Cannot see the send history: refuse rather than guess. The cost of
    // blocking is a delayed email; the cost of guessing is the third one this
    // month landing on someone who has stopped replying.
    block("contacted_recently", `Send history unreadable (${sentErr.message}) — refusing rather than risk a duplicate.`);
  } else {
    const now = Date.now();
    const lastSent = sent?.find(d => d.sent_at);
    if (lastSent?.sent_at) {
      const days = Math.floor((now - new Date(lastSent.sent_at).getTime()) / DAY);
      if (days < 14) block("contacted_recently", `Last contacted ${days} days ago; the floor is 14.`);
      else pass("contacted_recently", `Last contacted ${days} days ago.`);
    } else {
      pass("contacted_recently", "No previous outreach on this account.");
    }

    if (input.contactId) {
      const recent = (sent ?? []).filter(d =>
        d.contact_id === input.contactId && d.sent_at &&
        (now - new Date(d.sent_at).getTime()) < 30 * DAY);
      if (recent.length >= 2) block("frequency_cap", `${recent.length} emails to this contact in the last 30 days.`);
      else pass("frequency_cap", `${recent.length} email(s) to this contact in the last 30 days.`);
    } else {
      skip("frequency_cap", "No contact id on the draft.");
    }
  }

  // ── Previously declined topic ────────────────────────────────────────────
  // The profile records what a customer turned down and why. Pitching it again
  // is the clearest possible signal that nobody is reading their own notes.
  const { data: profile, error: pErr } = await supabase
    .from("cs_customer_profiles")
    .select("declined_items, active_negotiation, active_negotiation_note")
    .eq("customer_ns_id", input.customerNsId)
    .maybeSingle();

  if (pErr) {
    skip("declined_topic", `Profile unreadable (${pErr.message}).`);
  } else if (!profile) {
    // ⚠ `.maybeSingle()` returns null WITHOUT an error when no profile row
    // exists, so "this customer has never been profiled" arrived here
    // indistinguishable from "nothing has been declined" and was reported as a
    // pass. Nothing was checked, so nothing passed.
    skip("declined_topic", "No profile for this customer — nothing could be checked.");
  } else if (!profile.declined_items?.length) {
    pass("declined_topic", "Profile exists; nothing recorded as declined.");
  } else {
    const haystack = `${input.subject ?? ""} ${input.body ?? ""}`.toLowerCase();
    const hits = (profile.declined_items as Array<{ description?: string }>)
      .map(d => String(d?.description ?? ""))
      .filter(desc => {
        // Match on the distinctive words of a declined item, not the whole
        // sentence — "SFTP" is what matters in "SFTP-based upload was rejected
        // on security grounds".
        const tokens = desc.toLowerCase().match(/\b[a-z][a-z0-9.+-]{3,}\b/g) ?? [];
        const distinctive = tokens.filter(t => !STOPWORDS.has(t));
        return distinctive.some(t => haystack.includes(t) && t.length >= 5);
      });
    if (hits.length) block("declined_topic", `Touches something previously declined: "${hits[0].slice(0, 120)}"`);
    else pass("declined_topic", `${(profile.declined_items as unknown[]).length} declined item(s), none matched.`);
  }

  // ── We owe them something overdue ────────────────────────────────────────
  const { data: commitments, error: cErr } = await supabase
    .from("cs_commitments")
    .select("description, due_date, status, direction")
    .eq("customer_ns_id", input.customerNsId)
    .eq("direction", "we_owe")
    .eq("status", "open");

  if (cErr) {
    skip("owed_commitment", `Commitments unreadable (${cErr.message}).`);
  } else if (!commitments?.length) {
    // ⚠ THIS BRANCH USED TO `pass`, AND THAT WAS THE WORST BUG IN THE MODULE.
    //
    // Nothing in the application writes cs_commitments yet, so the table is
    // empty for everyone — which meant "No open commitments we owe" was
    // reported on EVERY draft ever generated. That is precisely the failure the
    // header rule above forbids: missing data quietly becoming permission to
    // send. And it is the rule docs/04-DRAFT-QUEUE.md singles out as mattering
    // "more than it appears", because asking a customer for something while we
    // owe them work is the fastest way to damage the relationship.
    //
    // A zero-row answer for one account is only meaningful if commitments are
    // being recorded at all, so that is what gets probed. `head: true` fetches
    // no rows — it is a count, not a scan.
    const { count, error: anyErr } = await supabase
      .from("cs_commitments").select("id", { count: "exact", head: true });

    if (anyErr || !count) {
      skip("owed_commitment",
        "No commitment has ever been recorded, so this could not be evaluated.");
    } else {
      pass("owed_commitment", "No open commitments we owe on this account.");
    }
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = commitments.filter(c => c.due_date && c.due_date < today);
    if (overdue.length) {
      block("owed_commitment", `We owe them something overdue: "${String(overdue[0].description).slice(0, 120)}". Do not ask for anything while we owe them.`);
    } else {
      pass("owed_commitment", `${commitments.length} open commitment(s), none overdue.`);
    }
  }

  // ── Contact liveness and role ────────────────────────────────────────────
  // Read once here and reused by the opt-out check below — same row, one query.
  let optOutKnown = false;
  let contactOptedOut = false;
  let optOutReason = "";

  if (!input.contactId) {
    skip("contact_active", "No contact recorded — cs_contacts is not populated.");
    skip("contact_role",   "No contact recorded — cs_contacts is not populated.");
  } else {
    const { data: contact, error: ctErr } = await supabase
      .from("pm_crm_contacts")
      .select("is_active, departed_detected_at, role, opted_out, opt_out_reason")
      .eq("id", input.contactId).maybeSingle();
    if (ctErr || !contact) {
      skip("contact_active", "Contact not found.");
      skip("contact_role",   "Contact not found.");
    } else {
      optOutKnown = true;
      contactOptedOut = Boolean(contact.opted_out);
      optOutReason = String(contact.opt_out_reason ?? "").trim();


      if (!contact.is_active || contact.departed_detected_at) {
        block("contact_active", "Contact is marked inactive or departed.");
      } else pass("contact_active", "Contact is active.");

      if (contact.role === "unknown") skip("contact_role", "Contact role is unknown.");
      else pass("contact_role", `Contact role is ${contact.role}.`);
    }
  }

  // ── Open escalation ──────────────────────────────────────────────────────
  // Approximated from health flags rather than a support field: a critical open
  // flag is the best available proxy for "something is on fire here".
  const { data: flags, error: fErr } = await supabase
    .from("cs_health_flags")
    .select("title, severity")
    .eq("customer_ns_id", input.customerNsId)
    .eq("status", "open")
    .eq("severity", "critical");

  if (fErr) skip("open_escalation", `Flags unreadable (${fErr.message}).`);
  else if (flags?.length) block("open_escalation", `Critical flag open: "${flags[0].title}".`);
  else pass("open_escalation", "No critical flag open.");

  // ── Opted out ────────────────────────────────────────────────────────────
  // Permanent, per 04-DRAFT-QUEUE.md. Checked on the CONTACT rather than the
  // account: one person asking to be left alone does not mute their colleagues.
  //
  // ⚠ Without a contact this cannot be evaluated — opting out is a property of
  // a person, and a draft with no recipient has no person to check. Skip, not
  // pass.
  if (!input.contactId) {
    skip("opted_out", "No contact on the draft, so there is no opt-out state to check.");
  } else if (!optOutKnown) {
    skip("opted_out", "Contact not found.");
  } else if (contactOptedOut) {
    block("opted_out", `This contact has opted out${optOutReason ? `: ${optOutReason}` : "."}`);
  } else {
    pass("opted_out", "This contact has not opted out.");
  }

  // ── Active negotiation ───────────────────────────────────────────────────
  // A health check landing mid-negotiation is noise at best and leverage handed
  // away at worst. Set by a human on the profile; re-extraction never touches it.
  //
  // ⚠ No profile is a SKIP. `false` on a row that does not exist is not a
  // finding, it is the absence of one — and this is the check where that
  // distinction is most expensive to get wrong.
  if (pErr) {
    skip("active_negotiation", `Profile unreadable (${pErr.message}).`);
  } else if (!profile) {
    skip("active_negotiation", "No profile for this customer — negotiation state is unrecorded.");
  } else if (profile.active_negotiation) {
    const negNote = String(profile.active_negotiation_note ?? "").trim();
    block("active_negotiation",
      `A commercial negotiation is marked active${negNote ? `: ${negNote}` : "."}`);
  } else {
    pass("active_negotiation", "No negotiation marked active.");
  }

  return { blocked: reasons.length > 0, checks, reasons };
}

const STOPWORDS = new Set([
  "that", "this", "with", "from", "they", "their", "have", "been", "were", "which",
  "would", "could", "should", "about", "there", "where", "when", "what", "into",
  "rejected", "declined", "instead", "approach", "preference", "favour", "favor",
  "customer", "client", "team", "based", "using", "option", "method", "during",
  "because", "however", "system", "netsuite", "loop", "project", "process",
]);
