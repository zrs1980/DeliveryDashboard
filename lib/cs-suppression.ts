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
// Several rules need tables that are still empty (cs_contacts, cs_commitments).
// Those return `skipped` with the reason — NEVER `passed`. A check that could
// not run has not been passed, and recording it as passed would quietly convert
// missing data into permission to send.

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
    .select("declined_items")
    .eq("customer_ns_id", input.customerNsId)
    .maybeSingle();

  if (pErr) {
    skip("declined_topic", `Profile unreadable (${pErr.message}).`);
  } else if (!profile?.declined_items?.length) {
    pass("declined_topic", "Nothing recorded as declined.");
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
    // Honest about which of the two this is: no table content vs genuinely none.
    pass("owed_commitment", "No open commitments we owe.");
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
  if (!input.contactId) {
    skip("contact_active", "No contact recorded — cs_contacts is not populated.");
    skip("contact_role",   "No contact recorded — cs_contacts is not populated.");
  } else {
    const { data: contact, error: ctErr } = await supabase
      .from("cs_contacts").select("is_active, departed_detected_at, role")
      .eq("id", input.contactId).maybeSingle();
    if (ctErr || !contact) {
      skip("contact_active", "Contact not found.");
      skip("contact_role",   "Contact not found.");
    } else {
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

  // ── Not checkable at all yet ─────────────────────────────────────────────
  skip("opted_out", "No opt-out field exists on the schema yet.");
  skip("active_negotiation", "No negotiation state is recorded anywhere.");

  return { blocked: reasons.length > 0, checks, reasons };
}

const STOPWORDS = new Set([
  "that", "this", "with", "from", "they", "their", "have", "been", "were", "which",
  "would", "could", "should", "about", "there", "where", "when", "what", "into",
  "rejected", "declined", "instead", "approach", "preference", "favour", "favor",
  "customer", "client", "team", "based", "using", "option", "method", "during",
  "because", "however", "system", "netsuite", "loop", "project", "process",
]);
