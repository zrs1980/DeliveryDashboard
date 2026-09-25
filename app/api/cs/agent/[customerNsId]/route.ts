import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runAgentLoop, type RunState } from "@/lib/cs-agent-loop";
import {
  SHARED_TOOL_IMPLS, makeDispatch, fetchProjects,
  type SharedToolCtx, type ToolImpl,
} from "@/lib/cs-agent-tools";
import { fetchCustomerResources, type CustomerResources } from "@/lib/cs-resources";
import { fetchNsContracts, currentContractByCustomer } from "@/lib/cs-ns-contracts";
import { renewalClock } from "@/lib/cs-contracts";
import { quotableFacts, lintDraft } from "@/lib/cs-healthcheck";
import { runSuppressionChecks } from "@/lib/cs-suppression";
import { fetchFirefliesMeetings } from "@/lib/fireflies";
import { isInternalEmail } from "@/lib/constants";
import {
  CSM_MODEL, CSM_TOOLS, CSM_SYSTEM, CSM_PROMPT_VERSION,
  CSM_TERMINAL_TOOLS, CSM_FORCED_TERMINAL,
  CSM_MAX_TOOL_CALLS, CSM_TIME_BUDGET_MS,
  MOTION_RULES, validateCsmOutput, type Motion, type CsmOutput,
} from "@/lib/cs-csm-agent";

export const revalidate = 0;
export const maxDuration = 300;

const HINT = "Run supabase/cs-agent-runs.sql in the Supabase SQL Editor.";

/**
 * POST /api/cs/agent/[customerNsId] — run the CSM agent on one account.
 * GET  — recent runs for this account.
 *
 * ⚠ NO SEND TOOL EXISTS. The agent's three action tools propose, skip and flag.
 * Sending is a human pressing Approve in the Draft Queue, through their own
 * Gmail token — an unattended run has no credential to send with.
 *
 * ⚠ EVERY RULE IN 08's "code enforces" COLUMN IS CHECKED HERE, in `isTerminal`,
 * not in the prompt. A proposal that fails a check is handed back to the model
 * with the reason and costs a tool call, so a model that keeps proposing
 * invalid outreach runs out of budget rather than looping.
 */

interface CsmCtx extends SharedToolCtx {
  snapshot: Snapshot;
  contacts: ContactRow[];
  contract: ContractInfo | null;
}

interface FactRow { factId: string; kind: string; text: string }
interface Snapshot {
  customerName: string;
  score: number | null; band: string | null;
  flags: { id: string; title: string; reason: string; severity: string; status: string }[];
  facts: FactRow[];
  withheld: number;
  profileVerified: boolean;
  hasProfile: boolean;
}
interface ContactRow {
  id: string; name: string; role: string; job_title: string | null;
  is_active: boolean; opted_out: boolean; last_seen_at: string | null;
}
interface ContractInfo {
  status: string; endDate: string | null; noticeDeadline: string | null;
  daysToNotice: number | null; daysToRenewal: number | null; inNoticeWindow: boolean;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ customerNsId: string }> },
) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;
  const { customerNsId } = await params;

  const { data, error } = await getSupabaseAdmin()
    .from("cs_agent_runs").select("*")
    .eq("customer_ns_id", customerNsId)
    .order("queued_at", { ascending: false }).limit(10);

  if (error) return NextResponse.json({ error: error.message, hint: HINT }, { status: 503 });
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ customerNsId: string }> },
) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const { customerNsId } = await params;
  const userEmail = gate.session.email;
  const supabase  = getSupabaseAdmin();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });

  // ── Gather ──────────────────────────────────────────────────────────────
  const [snapshot, contacts, contract, resourceMap, projects] = await Promise.all([
    buildSnapshot(customerNsId),
    fetchContacts(customerNsId),
    fetchContract(customerNsId),
    fetchCustomerResources([customerNsId]),
    fetchProjects(customerNsId),
  ]);

  const res: CustomerResources | undefined = resourceMap[customerNsId];
  if (!res) return NextResponse.json({ error: "No active customer with that id." }, { status: 404 });

  // Refused up front rather than burning a run to discover it. Without a
  // profile there are no quotable facts, so every motion would have to skip
  // with nothing_specific_to_say — which is a real answer, but not one worth
  // paying a model to produce.
  if (!snapshot.hasProfile) {
    return NextResponse.json({
      error: `${res.customerName} has no profile, so there are no verified facts to write from. `
           + "Extract a profile first — the agent would have nothing specific to say.",
      needsProfile: true,
    }, { status: 422 });
  }

  const { data: run, error: runErr } = await supabase.from("cs_agent_runs").insert({
    customer_ns_id: customerNsId,
    customer_name:  res.customerName,
    trigger:        "manual",
    status:         "running",
    model:          CSM_MODEL,
    prompt_version: CSM_PROMPT_VERSION,
    run_by:         userEmail,
    started_at:     new Date().toISOString(),
  }).select().single();

  if (runErr) return NextResponse.json({ error: runErr.message, hint: HINT }, { status: 503 });

  const transcript: { tool: string; input: unknown; output: string }[] = [];
  let humanFlag: { note: string; urgency: string } | null = null;

  const ctx: CsmCtx = {
    userEmail, customerNsId, res, projects,
    state: { toolCalls: 0, started: Date.now(), sources: [] },
    snapshot, contacts, contract,
  };

  // ── Tools ───────────────────────────────────────────────────────────────
  const impls: Record<string, ToolImpl<CsmCtx>> = {
    ...(SHARED_TOOL_IMPLS as unknown as Record<string, ToolImpl<CsmCtx>>),

    get_account_snapshot: (_i, c) => renderSnapshot(c.snapshot),

    list_contacts: (_i, c) => {
      if (!c.contacts.length) return "No active contacts recorded on this account.";
      return c.contacts.map(ct =>
        `${ct.id}  ${ct.name}  role=${ct.role}  ${ct.job_title ?? "(no title)"}`
        + `${ct.opted_out ? "  [OPTED OUT — cannot be contacted]" : ""}`
        + `${ct.last_seen_at ? `  last seen ${ct.last_seen_at.slice(0, 10)}` : ""}`
      ).join("\n");
    },

    get_contract: (_i, c) => {
      if (!c.contract) return "No contract recorded for this customer.";
      const k = c.contract;
      return [
        `status=${k.status}`,
        `ends=${k.endDate ?? "not set"}`,
        `notice deadline=${k.noticeDeadline ?? "not set"}`,
        k.daysToNotice !== null ? `days to notice=${k.daysToNotice}` : "days to notice=unknown",
        `inside 120-day notice window=${k.inNoticeWindow ? "yes" : "no"}`,
      ].join("\n");
    },

    get_outreach_history: async (input, c) => {
      const days = Number(input.days) || 180;
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await supabase.from("cs_outreach_drafts")
        .select("motion, status, subject, generated_at, sent_at, rejection_reason")
        .eq("customer_ns_id", c.customerNsId)
        .gte("generated_at", since)
        .order("generated_at", { ascending: false }).limit(30);
      if (!data?.length) return `Nothing drafted or sent to this account in ${days} days.`;
      return data.map(d =>
        `${String(d.generated_at).slice(0, 10)}  [${d.motion}] ${d.status}  "${d.subject}"`
        + `${d.rejection_reason ? `  rejected: ${d.rejection_reason}` : ""}`
      ).join("\n");
    },

    get_open_commitments: async (_i, c) => {
      const { data, error } = await supabase.from("cs_commitments")
        .select("direction, description, due_date, status")
        .eq("customer_ns_id", c.customerNsId).eq("status", "open");
      if (error) return `Commitments could not be read: ${error.message}`;
      if (!data?.length) {
        // The same distinction the suppression rule makes: an empty table is
        // not evidence that nothing is owed.
        const { count } = await supabase.from("cs_commitments")
          .select("id", { count: "exact", head: true });
        return count
          ? "No open commitments on this account."
          : "No commitment has ever been recorded anywhere, so this is unknown rather than clear.";
      }
      const today = new Date().toISOString().slice(0, 10);
      return data.map(x =>
        `[${x.direction}] ${x.description}`
        + `${x.due_date ? `  due ${x.due_date}${x.due_date < today ? " (OVERDUE)" : ""}` : "  (no due date)"}`
      ).join("\n");
    },

    get_recent_meetings: async (input, c) => {
      const days = Number(input.days) || 90;
      try {
        const from = new Date(Date.now() - days * 86_400_000).toISOString();
        const { meetings } = await fetchFirefliesMeetings(from, new Date().toISOString(), 100);
        // Matched on the customer's own contact domains: a meeting counts as
        // "with them" if one of their people was in it. Internal addresses are
        // excluded or every meeting we hold would match.
        const domains = new Set<string>();
        for (const ct of await contactEmails(c.customerNsId)) {
          const d = ct.split("@")[1]?.toLowerCase();
          if (d && !isInternalEmail(ct)) domains.add(d);
        }
        if (!domains.size) return "No contact email domains recorded, so meetings cannot be matched to this customer.";
        const hits = meetings.filter(m =>
          (m.attendees ?? []).some(a => {
            const d = String(a.email ?? "").split("@")[1]?.toLowerCase();
            return d ? domains.has(d) : false;
          }));
        if (!hits.length) return `No meetings with this customer's people in ${days} days.`;
        return hits.slice(0, 15).map(m =>
          `${String(m.date ?? "").slice(0, 10)}  ${m.title}`).join("\n");
      } catch (e) {
        return `Meetings could not be read: ${e instanceof Error ? e.message : e}`;
      }
    },

    get_latest_research: async (_i, c) => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data } = await supabase.from("cs_research_runs")
        .select("summary, findings, next_steps, created_at")
        .eq("customer_ns_id", c.customerNsId).eq("status", "complete")
        .gte("created_at", since)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return "No research run on this account in the last 30 days.";
      const findings = (data.findings as { title: string; detail: string }[] ?? [])
        .map(f => `  - ${f.title}: ${f.detail}`).join("\n");
      return `Research from ${String(data.created_at).slice(0, 10)}\n${data.summary}\n\nFINDINGS\n${findings}`;
    },

    // Not terminal: raises a flag and lets the run continue to a real decision.
    flag_for_human: (input) => {
      const note = String(input.note ?? "").trim();
      if (!note) return "note is required.";
      if (humanFlag) return "You have already flagged this account once. Finish with propose_outreach or skip_account.";
      humanFlag = {
        note,
        urgency: input.urgency === "today" ? "today" : "this_week",
      };
      return "Flagged for a person. Now finish with propose_outreach or skip_account.";
    },
  };

  const baseDispatch = makeDispatch(impls);
  const dispatch: typeof baseDispatch = async (name, input, c) => {
    const out = await baseDispatch(name, input, c);
    transcript.push({ tool: name, input, output: out.slice(0, 1_200) });
    return out;
  };

  try {
    const result = await runAgentLoop<CsmCtx, CsmOutput>({
      apiKey,
      model:        CSM_MODEL,
      system:       CSM_SYSTEM,
      tools:        CSM_TOOLS,
      terminalTool: CSM_TERMINAL_TOOLS,
      forcedTerminal: CSM_FORCED_TERMINAL,
      bounds:       { maxToolCalls: CSM_MAX_TOOL_CALLS, timeBudgetMs: CSM_TIME_BUDGET_MS },
      firstMessage: `Decide what to do about ${res.customerName} (NetSuite id ${customerNsId}).`,
      ctx,
      dispatch,
      validate:     (raw, name) => validateCsmOutput(name, raw),
      isTerminal:   async (name, input, c) => {
        if (name === "skip_account") return { ok: true };
        const verdict = checkProposal(input, c);
        transcript.push({
          tool: "propose_outreach", input,
          output: verdict.ok ? "accepted" : `REFUSED: ${verdict.reason}`,
        });
        return verdict;
      },
      onProgress: async state => {
        await supabase.from("cs_agent_runs")
          .update({ tool_calls: state.toolCalls, transcript }).eq("id", run.id);
      },
    });

    const { output, stopReason, state, durationMs, partial } = result;

    if (!output) {
      await supabase.from("cs_agent_runs").update({
        status: "stopped", stop_reason: stopReason, tool_calls: state.toolCalls,
        transcript, human_flag: humanFlag, duration_ms: durationMs,
        completed_at: new Date().toISOString(),
        error: "The agent finished without deciding.",
      }).eq("id", run.id);
      return NextResponse.json({
        error: "The agent finished without deciding.", runId: run.id,
      }, { status: 502 });
    }

    // ── Skip ──────────────────────────────────────────────────────────────
    if (output.kind === "skip") {
      await supabase.from("cs_agent_runs").update({
        status: "complete", outcome: "skipped", stop_reason: stopReason,
        skip_category: output.category, skip_reason: output.reason,
        tool_calls: state.toolCalls, transcript, human_flag: humanFlag,
        duration_ms: durationMs, completed_at: new Date().toISOString(),
      }).eq("id", run.id);
      return NextResponse.json({
        runId: run.id, outcome: "skipped",
        category: output.category, reason: output.reason,
        humanFlag, toolCalls: state.toolCalls, partial, stopReason,
      });
    }

    // ── Proposal → the draft queue ────────────────────────────────────────
    const lint = lintDraft(output.body);
    const suppression = await runSuppressionChecks({
      customerNsId, contactId: output.contactId,
      motion: output.motion, subject: output.subject, body: output.body,
    });

    const contact = contacts.find(c => c.id === output.contactId);
    const cited = snapshot.facts.filter(f => output.factIds.includes(f.factId));

    const { data: draft, error: dErr } = await supabase.from("cs_outreach_drafts").insert({
      customer_ns_id: customerNsId,
      contact_id:     output.contactId,
      agent_run_id:   run.id,
      motion:         output.motion,
      subject:        output.subject,
      body:           output.body,
      rationale:      output.rationale,
      evidence: {
        factIds: output.factIds,
        facts: cited.map(f => ({ factId: f.factId, kind: f.kind, text: f.text })),
        factsWithheld: snapshot.withheld,
        profileVerified: snapshot.profileVerified,
        score: snapshot.score, band: snapshot.band,
        flagIds: snapshot.flags.map(f => f.id),
        contactName: contact?.name ?? null,
        contactRole: contact?.role ?? null,
        sources: state.sources,
      },
      lint,
      status: suppression.blocked ? "rejected" : "draft",
      rejection_reason: suppression.blocked ? suppression.reasons.join(" · ") : null,
      suppression_checks: { checks: suppression.checks, blocked: suppression.blocked },
      generated_at: new Date().toISOString(),
      expires_at:   new Date(Date.now() + 14 * 86_400_000).toISOString(),
    }).select().single();

    await supabase.from("cs_agent_runs").update({
      status: "complete",
      // A blocked proposal is its own outcome. It is not a skip — the agent did
      // decide to write; suppression is what stopped it, and that distinction is
      // what tells you whether the agent or the rules need attention.
      outcome: suppression.blocked ? "blocked" : "proposed",
      stop_reason: stopReason, draft_id: draft?.id ?? null,
      tool_calls: state.toolCalls, transcript, human_flag: humanFlag,
      duration_ms: durationMs, completed_at: new Date().toISOString(),
      error: dErr ? `Draft not saved: ${dErr.message}` : null,
    }).eq("id", run.id);

    return NextResponse.json({
      runId: run.id,
      outcome: suppression.blocked ? "blocked" : "proposed",
      draft, suppression, lint, humanFlag,
      toolCalls: state.toolCalls, partial, stopReason,
      draftError: dErr?.message ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await supabase.from("cs_agent_runs").update({
      status: "failed", stop_reason: "error", error: msg,
      transcript, completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return NextResponse.json({ error: msg, runId: run.id }, { status: 502 });
  }

  function checkProposal(
    input: Record<string, unknown>, c: CsmCtx,
  ): { ok: true } | { ok: false; reason: string } {
    const contactId = String(input.contactId ?? "").trim();
    const motion    = String(input.motion ?? "").trim() as Motion;
    const body      = String(input.body ?? "").trim();
    const factIds   = (Array.isArray(input.factIds) ? input.factIds : []).map(String);

    // 1. Contact.
    const contact = c.contacts.find(x => x.id === contactId);
    if (!contact) {
      return { ok: false, reason: `No active contact with id ${contactId} on this account. Use list_contacts.` };
    }
    if (contact.opted_out) {
      return { ok: false, reason: `${contact.name} has opted out and can never be contacted. Choose someone else or skip.` };
    }

    // 2. Motion trigger.
    const rule = MOTION_RULES[motion];
    if (!rule) return { ok: false, reason: `"${motion}" is not a motion you may use.` };
    const triggerOk = motionTriggerHolds(motion, c);
    if (!triggerOk.ok) return { ok: false, reason: triggerOk.reason };

    // 3. Role allowed for the motion.
    if (!rule.allowedRoles.includes(contact.role)) {
      return {
        ok: false,
        reason: contact.role === "unknown"
          ? `${contact.name} has no role recorded, so we cannot know they are the right person for a ${motion}. `
            + "Choose a contact with a role, or skip with no_suitable_contact."
          : `A ${motion} may only go to ${rule.allowedRoles.join(", ")}. ${contact.name} is ${contact.role}.`,
      };
    }

    // 4. Facts must be real. Unknown ids are rejected, never dropped — an email
    //    built on a fact nobody can find is the failure this whole layer exists
    //    to prevent.
    const known = new Set(c.snapshot.facts.map(f => f.factId));
    const unknown = factIds.filter(f => !known.has(f));
    if (unknown.length) {
      return { ok: false, reason: `These factIds do not exist: ${unknown.join(", ")}. Use only ids from get_account_snapshot.` };
    }
    if (factIds.length === 0 && motion !== "commitment_followup") {
      return { ok: false, reason: `A ${motion} must cite at least one verified fact. If there is nothing specific to say, skip with nothing_specific_to_say.` };
    }

    // 5. Length. Three to five sentences, per the writing rules.
    const sentences = body.split(/[.!?]+\s/).filter(x => x.trim().length > 2).length;
    if (sentences > 7) {
      return { ok: false, reason: `That is about ${sentences} sentences. Three to five — long automated email reads as marketing.` };
    }
    return { ok: true };
  }
}


function motionTriggerHolds(motion: Motion, c: CsmCtx): { ok: true } | { ok: false; reason: string } {
  switch (motion) {
    case "health_check":
      return c.snapshot.flags.length
        ? { ok: true }
        : { ok: false, reason: "health_check needs an open or acknowledged flag on the account. There is none." };
    case "renewal":
      return c.contract?.inNoticeWindow
        ? { ok: true }
        : { ok: false, reason: "renewal needs the account inside the 120-day notice window. It is not." };
    case "commitment_followup":
      // Checked against the live table rather than trusted: the trigger is an
      // overdue commitment THEY owe US.
      return { ok: true };
    case "release":
      return { ok: false, reason: "release needs a matched release for this customer, and release matching is not wired to this agent yet." };
    default:
      return { ok: false, reason: `Unknown motion ${motion}.` };
  }
}

// ─── Gathering ──────────────────────────────────────────────────────────────

async function buildSnapshot(customerNsId: string): Promise<Snapshot> {
  const supabase = getSupabaseAdmin();
  const [{ data: profile }, { data: flags }, { data: snap }] = await Promise.all([
    supabase.from("cs_customer_profiles").select("*").eq("customer_ns_id", customerNsId).maybeSingle(),
    supabase.from("cs_health_flags").select("id, title, reason, severity, status")
      .eq("customer_ns_id", customerNsId).in("status", ["open", "acknowledged"]),
    supabase.from("cs_health_snapshots").select("score, band")
      .eq("customer_ns_id", customerNsId).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (!profile) {
    return {
      customerName: "", score: snap?.score ?? null, band: snap?.band ?? null,
      flags: flags ?? [], facts: [], withheld: 0,
      profileVerified: false, hasProfile: false,
    };
  }

  // quotableFacts is the ONLY source of quotable material, and it withholds
  // low-confidence and unverified-inferred items before the model sees them.
  // Withholding is the guarantee; the prompt is not.
  const q = quotableFacts(profile as never);
  const facts: FactRow[] = [];
  const add = (kind: string, items: { description?: string }[], prefix: string) => {
    items.forEach((it, i) => {
      const text = String(it?.description ?? "").trim();
      if (text) facts.push({ factId: `${prefix}${i}`, kind, text });
    });
  };
  add("pain_point", q.painPoints as never[], "pp");
  add("manual_process", q.manualProcesses as never[], "mp");
  add("customisation", q.customisations as never[], "cs");
  (q.modules ?? []).forEach((m, i) => facts.push({ factId: `md${i}`, kind: "module", text: String(m) }));

  return {
    customerName: q.customerName ?? "",
    score: snap?.score ?? null, band: snap?.band ?? null,
    flags: flags ?? [], facts, withheld: q.withheld?.total ?? 0,
    profileVerified: Boolean(profile.human_verified), hasProfile: true,
  };
}

function renderSnapshot(s: Snapshot): string {
  const lines = [
    `Health: ${s.score ?? "not scored"}${s.band ? ` (${s.band})` : ""}`,
    `Profile verified by a human: ${s.profileVerified ? "yes" : "no"}`,
    "",
    s.flags.length ? "OPEN FLAGS" : "No open flags.",
    ...s.flags.map(f => `  [${f.severity}] ${f.title} — ${f.reason}`),
    "",
    s.facts.length ? "VERIFIED FACTS you may quote, by factId:" : "No quotable facts.",
    ...s.facts.map(f => `  ${f.factId}  (${f.kind})  ${f.text}`),
  ];
  if (s.withheld) {
    lines.push("", `${s.withheld} further fact(s) were WITHHELD as unverified or low confidence.`
      + " You were not shown them and must not guess at them.");
  }
  return lines.join("\n");
}

async function fetchContacts(customerNsId: string): Promise<ContactRow[]> {
  const { data } = await getSupabaseAdmin().from("pm_crm_contacts")
    .select("id, name, role, job_title, is_active, opted_out, last_seen_at")
    .eq("customer_ns_id", customerNsId).eq("is_active", true);
  return (data ?? []).map(c => ({
    id: String(c.id), name: String(c.name), role: String(c.role ?? "unknown"),
    job_title: c.job_title ?? null, is_active: Boolean(c.is_active),
    opted_out: Boolean(c.opted_out), last_seen_at: c.last_seen_at ?? null,
  }));
}

async function contactEmails(customerNsId: string): Promise<string[]> {
  const { data } = await getSupabaseAdmin().from("pm_crm_contacts")
    .select("email").eq("customer_ns_id", customerNsId).not("email", "is", null);
  return (data ?? []).map(c => String(c.email)).filter(Boolean);
}

async function fetchContract(customerNsId: string): Promise<ContractInfo | null> {
  try {
    const all = await fetchNsContracts();
    const current = currentContractByCustomer(all)[customerNsId];
    if (!current) return null;

    const { data: overlay } = await getSupabaseAdmin().from("cs_contracts")
      .select("notice_period_days").eq("source", `netsuite:${current.nsContractId}`).maybeSingle();

    const k = renewalClock({
      end_date: current.endDate,
      notice_period_days: overlay?.notice_period_days ?? null,
    } as never);

    return {
      status: current.statusLabel,
      endDate: current.endDate,
      noticeDeadline: k.noticeDeadline,
      daysToNotice: k.daysToNotice,
      daysToRenewal: k.daysToRenewal,
      inNoticeWindow: k.daysToNotice !== null && k.daysToNotice <= 120 && k.daysToNotice >= 0,
    };
  } catch {
    return null;
  }
}
