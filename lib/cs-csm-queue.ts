import { getSupabaseAdmin } from "./supabase";
import { fetchNsContracts, currentContractByCustomer } from "./cs-ns-contracts";
import { renewalClock } from "./cs-contracts";

/**
 * Choosing which accounts the CSM agent looks at tonight.
 *
 * ⚠ THE CAP IS THE POINT, NOT A PERFORMANCE SETTING. `00-PROJECT-BRIEF.md`:
 * "Single human in the loop — review throughput is the bottleneck. Optimise for
 * fast approval, not volume of generation." A queue of forty drafts nobody gets
 * through is worse than five that are read, because the unread ones expire and
 * the reviewer learns to ignore the queue.
 *
 * ⚠ CANDIDACY IS NOT A DECISION. Being enqueued means "worth looking at", not
 * "worth emailing". The agent skipping is a normal and desirable outcome — the
 * queue is deliberately wider than the set of accounts that will get a draft.
 */

export const NIGHTLY_BATCH_CAP = 10;

export interface QueuedCandidate {
  customerNsId: string;
  reason: string;
}

/**
 * Find tonight's candidates and insert `queued` rows.
 *
 * Returns what it queued and, separately, what it SKIPPED because a run already
 * exists today — a silent no-op and a genuinely empty night must not look the
 * same in the cron's response.
 */
export async function enqueueCsmCandidates(
  { cap = NIGHTLY_BATCH_CAP }: { cap?: number } = {},
): Promise<{ queued: QueuedCandidate[]; alreadyRunToday: number; considered: number; error?: string }> {
  const supabase = getSupabaseAdmin();
  const candidates = new Map<string, string>();

  // 1. Open or acknowledged flags — the primary trigger.
  const { data: flags, error: fErr } = await supabase
    .from("cs_health_flags")
    .select("customer_ns_id, title, severity")
    .in("status", ["open", "acknowledged"]);
  if (fErr) return { queued: [], alreadyRunToday: 0, considered: 0, error: fErr.message };

  for (const f of flags ?? []) {
    const id = String(f.customer_ns_id);
    if (!candidates.has(id)) candidates.set(id, `flag: ${f.title}`);
  }

  // 2. Overdue commitments THEY owe us — there is something concrete to chase.
  //    An overdue commitment WE owe them is a reason to stay quiet, not to
  //    write, and suppression blocks that case anyway.
  const today = new Date().toISOString().slice(0, 10);
  const { data: commitments } = await supabase
    .from("cs_commitments")
    .select("customer_ns_id, description, due_date")
    .eq("status", "open").eq("direction", "they_owe").lt("due_date", today);
  for (const c of commitments ?? []) {
    const id = String(c.customer_ns_id);
    if (!candidates.has(id)) candidates.set(id, `overdue commitment: ${c.description}`);
  }

  // 3. Renewal notice windows. Read from NetSuite, so a failure here must not
  //    take the whole enqueue down — the flags above are the bulk of it.
  try {
    const all = await fetchNsContracts();
    const current = currentContractByCustomer(all);
    const overlays = await supabase.from("cs_contracts").select("source, notice_period_days");
    const notice = new Map<string, number | null>();
    for (const o of overlays.data ?? []) notice.set(String(o.source), o.notice_period_days ?? null);

    for (const [customerNsId, contract] of Object.entries(current)) {
      const k = renewalClock({
        end_date: contract.endDate,
        notice_period_days: notice.get(`netsuite:${contract.nsContractId}`) ?? null,
      } as never);
      if (k.daysToNotice !== null && k.daysToNotice >= 0 && k.daysToNotice <= 120) {
        candidates.set(customerNsId, `notice deadline in ${k.daysToNotice} days`);
      }
    }
  } catch {
    // Swallowed deliberately: NetSuite being unreachable should cost the
    // renewal candidates, not the whole night's queue.
  }

  const considered = candidates.size;
  if (!considered) return { queued: [], alreadyRunToday: 0, considered: 0 };

  // Don't re-queue an account the agent already looked at today. Running twice
  // in a night produces two drafts for one reviewer and burns the budget.
  const since = new Date(Date.now() - 20 * 3_600_000).toISOString();
  const { data: recent } = await supabase
    .from("cs_agent_runs").select("customer_ns_id")
    .in("customer_ns_id", [...candidates.keys()])
    .gte("queued_at", since);
  const seen = new Set((recent ?? []).map(r => String(r.customer_ns_id)));

  const fresh = [...candidates.entries()]
    .filter(([id]) => !seen.has(id))
    .slice(0, cap)
    .map(([customerNsId, reason]) => ({ customerNsId, reason }));

  if (!fresh.length) {
    return { queued: [], alreadyRunToday: seen.size, considered };
  }

  const { error: iErr } = await supabase.from("cs_agent_runs").insert(
    fresh.map(c => ({
      customer_ns_id: c.customerNsId,
      trigger: "nightly",
      status: "queued",
      run_by: "cron",
      // Why it was picked, kept even if the agent later skips — "we looked at
      // this because of X and decided not to write" is the useful record.
      skip_reason: null,
      transcript: [{ tool: "enqueued", input: null, output: c.reason }],
    })));

  if (iErr) return { queued: [], alreadyRunToday: seen.size, considered, error: iErr.message };
  return { queued: fresh, alreadyRunToday: seen.size, considered };
}

/**
 * Claim the oldest queued run for processing.
 *
 * ⚠ THE `.eq("status", "queued")` ON THE UPDATE IS THE LOCK. Two overlapping
 * cron invocations will both select the same row; only one update matches a
 * row still in `queued`, and the loser gets zero rows back and does nothing.
 * Without that predicate both would process the same account and produce two
 * drafts for one reviewer.
 */
export async function claimNextRun(): Promise<
  { id: string; customerNsId: string } | null
> {
  const supabase = getSupabaseAdmin();

  const { data: next } = await supabase
    .from("cs_agent_runs").select("id, customer_ns_id")
    .eq("status", "queued")
    .order("queued_at", { ascending: true })
    .limit(1).maybeSingle();
  if (!next) return null;

  const { data: claimed } = await supabase
    .from("cs_agent_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", next.id).eq("status", "queued")
    .select("id, customer_ns_id");

  if (!claimed?.length) return null;   // someone else took it
  return { id: String(claimed[0].id), customerNsId: String(claimed[0].customer_ns_id) };
}
