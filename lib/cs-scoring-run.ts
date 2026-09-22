import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchCsCustomers, fetchCustomerProjectIndex, SCORABLE_STAGE } from "@/lib/cs-customers";
import { computeAllSignals, applySupabaseSignals } from "@/lib/cs-signals";
import { evaluateRules, scoreFrom, STARTER_RULES, RULES_VERSION, type FiredFlag } from "@/lib/cs-rules";
import { fetchNsContracts, currentContractByCustomer } from "@/lib/cs-ns-contracts";
import { buildCustomerIndex } from "@/lib/cs-customer-index";

// ─── The nightly run ────────────────────────────────────────────────────────
//
// docs/03-HEALTH-SCORING.md, on the thing easiest to get wrong:
//
//   "The nightly job must evaluate EVERY account, including ones with no
//    activity — not iterate over recent events. An account with zero tickets,
//    zero hours and zero projects for 90 days generates no events and is the
//    account most likely to churn."
//
// So this starts from the customer list and walks all of it. It never iterates
// over changes.
//
// Flags are idempotent. Re-running updates an open flag rather than stacking
// duplicates, and a flag whose rule stops firing is RESOLVED rather than
// deleted — the history is the point. A flag a human dismissed stays dismissed
// until its suppression window expires.

export interface ScoringRunResult {
  scored:         number;
  /** Rows written to cs_customer_index. 0 means the rebuild failed — see warnings. */
  indexed:        number;
  flagsRaised:    number;
  flagsUpdated:   number;
  flagsResolved:  number;
  flagsSuppressed: number;
  bands:          Record<string, number>;
  rulesVersion:   string;
  startedAt:      string;
  finishedAt:     string;
  warnings:       string[];
}

interface OpenFlagRow {
  id: string; customer_ns_id: string; rule_id: string;
  status: string; suppressed_until: string | null;
}

export async function runHealthScoring(): Promise<ScoringRunResult> {
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const supabase = getSupabaseAdmin();

  const index = await fetchCustomerProjectIndex();

  // ⚠ SCORE CUSTOMERS, NOT THE WHOLE ADDRESS BOOK.
  //
  // fetchCsCustomers() returns every active record — 180, including 90
  // prospects and 68 closed-lost — because the rest of the app needs them
  // visible. Health scoring does not: a prospect with no logged hours is not an
  // account going quiet, and scoring them would drop 90 meaningless rows into
  // triage. Being visible and being judged are separate things.
  const everyone  = await fetchCsCustomers();
  const customers = everyone.filter(c => c.stage === SCORABLE_STAGE);
  const ids       = customers.map(c => String(c.id));

  if (customers.length < everyone.length) {
    warnings.push(
      `Scored ${customers.length} of ${everyone.length} active records — ` +
      `only stage "${SCORABLE_STAGE}" is scored; prospects and leads are visible but not judged.`,
    );
  }

  const signals = await computeAllSignals(ids, index);

  // Contracts come from NetSuite (CUSTOMRECORD_CONTRACTS), not from our own
  // table. The local rows carry only the notice period, which NetSuite has no
  // field for — see lib/cs-ns-contracts.ts.
  const [nsContracts, { data: overlays, error: oErr }, { data: sentiment, error: sErr }] = await Promise.all([
    fetchNsContracts().catch((e: unknown) => {
      warnings.push(`NetSuite contracts unreadable, commercial signals skipped: ${e instanceof Error ? e.message : "unknown"}`);
      return [] as Awaited<ReturnType<typeof fetchNsContracts>>;
    }),
    supabase.from("cs_contracts").select("source, notice_period_days"),
    supabase.from("cs_consultant_sentiment").select("customer_ns_id, rating, captured_at"),
  ]);
  if (oErr) warnings.push(`Notice-period overrides unreadable: ${oErr.message}`);
  if (sErr) warnings.push(`Sentiment unreadable, relationship signals skipped: ${sErr.message}`);

  const noticeBySource: Record<string, number> = {};
  for (const o of overlays ?? []) {
    if (o.source?.startsWith("netsuite:")) noticeBySource[o.source] = o.notice_period_days ?? 0;
  }

  // One governing contract per customer — a renewed term must not be reported
  // as the current one.
  const current = currentContractByCustomer(nsContracts);
  const contractSignals = Object.values(current).map(c => ({
    customer_ns_id: c.customerNsId,
    end_date:       c.endDate,
    // No notice period recorded means the clock runs to the end date. That is
    // the honest default: inventing one would produce confident wrong deadlines.
    notice_period_days: noticeBySource[`netsuite:${c.nsContractId}`] ?? 0,
    status:         c.status === "active" ? "active" : "renewed",
    auto_renew:     true,
  }));

  applySupabaseSignals(signals, contractSignals, (sentiment ?? []) as never);

  if (!contractSignals.length) {
    warnings.push(
      "No active contracts found in NetSuite. Silence cannot be told apart from a finished " +
      "implementation, so the silence rules will not fire at all.",
    );
  } else {
    const missingNotice = contractSignals.filter(c => !c.notice_period_days).length;
    if (missingNotice) {
      warnings.push(
        `${missingNotice} of ${contractSignals.length} contracts have no notice period recorded, ` +
        `so their countdown runs to the end date. The notice date is usually the real deadline.`,
      );
    }
  }

  // Previous scores, for the delta the spec says matters more than the value.
  const { data: prevRows, error: pErr } = await supabase
    .from("cs_health_snapshots")
    .select("customer_ns_id, score, computed_at")
    .order("computed_at", { ascending: false })
    .limit(5000);
  if (pErr) warnings.push(`Previous snapshots unreadable, deltas omitted: ${pErr.message}`);

  const previousScore: Record<string, number> = {};
  for (const r of prevRows ?? []) {
    if (previousScore[r.customer_ns_id] === undefined) previousScore[r.customer_ns_id] = r.score;
  }

  const { data: openFlags, error: fErr } = await supabase
    .from("cs_health_flags")
    .select("id, customer_ns_id, rule_id, status, suppressed_until")
    .in("status", ["open", "acknowledged", "dismissed"]);
  if (fErr) {
    // Without this the run would raise duplicates of every existing flag.
    throw new Error(`Could not read existing flags: ${fErr.message}. Refusing to run rather than duplicate flags.`);
  }

  const byKey = new Map<string, OpenFlagRow>();
  for (const f of (openFlags ?? []) as OpenFlagRow[]) byKey.set(`${f.customer_ns_id}::${f.rule_id}`, f);

  const today = new Date().toISOString().slice(0, 10);
  const computedAt = new Date().toISOString();

  const snapshots: Array<Record<string, unknown>> = [];
  const toInsert:  Array<Record<string, unknown>> = [];
  const toUpdate:  Array<{ id: string; patch: Record<string, unknown> }> = [];
  const firedKeys  = new Set<string>();
  const bands: Record<string, number> = { healthy: 0, watch: 0, at_risk: 0, critical: 0 };
  let flagsSuppressed = 0;

  for (const customer of customers) {
    const cid = String(customer.id);
    const s   = signals[cid];
    if (!s) continue;

    const fired: FiredFlag[] = evaluateRules(s, STARTER_RULES);
    const { score, band } = scoreFrom(fired);
    bands[band] = (bands[band] ?? 0) + 1;

    const prev = previousScore[cid];
    snapshots.push({
      customer_ns_id: cid,
      computed_at:    computedAt,
      score, band,
      signals:        s as unknown as Record<string, unknown>,
      rules_version:  RULES_VERSION,
      previous_score: prev ?? null,
      delta:          prev === undefined ? null : score - prev,
    });

    for (const f of fired) {
      const key = `${cid}::${f.ruleId}`;
      firedKeys.add(key);
      const existing = byKey.get(key);

      // A dismissal suppresses the rule for this account until its window ends.
      if (existing?.status === "dismissed") {
        if (!existing.suppressed_until || existing.suppressed_until > today) { flagsSuppressed++; continue; }
      }

      if (existing && existing.status !== "dismissed") {
        toUpdate.push({ id: existing.id, patch: {
          severity: f.severity, title: f.title, reason: f.reason,
          evidence: f.evidence, updated_at: computedAt,
        }});
      } else if (!existing) {
        toInsert.push({
          customer_ns_id: cid, rule_id: f.ruleId, severity: f.severity,
          title: f.title, reason: f.reason, evidence: f.evidence,
          status: "open", raised_at: computedAt, updated_at: computedAt,
        });
      }
    }
  }

  // Flags that stopped firing are resolved, not deleted — a flag that came and
  // went is exactly the history the snapshots exist to preserve.
  const toResolve = [...byKey.values()]
    .filter(f => (f.status === "open" || f.status === "acknowledged")
              && !firedKeys.has(`${f.customer_ns_id}::${f.rule_id}`))
    .map(f => f.id);

  if (snapshots.length) {
    const { error } = await supabase.from("cs_health_snapshots").insert(snapshots);
    if (error) warnings.push(`Snapshots not written: ${error.message}`);
  }
  if (toInsert.length) {
    const { error } = await supabase.from("cs_health_flags").insert(toInsert);
    if (error) warnings.push(`New flags not written: ${error.message}`);
  }
  for (const u of toUpdate) {
    const { error } = await supabase.from("cs_health_flags").update(u.patch).eq("id", u.id);
    if (error) { warnings.push(`Flag ${u.id} not updated: ${error.message}`); break; }
  }
  if (toResolve.length) {
    const { error } = await supabase.from("cs_health_flags")
      .update({ status: "resolved", resolved_at: computedAt, updated_at: computedAt })
      .in("id", toResolve);
    if (error) warnings.push(`Flags not resolved: ${error.message}`);
  }

  // Rebuild the index LAST, so it picks up the scores and flags this run just
  // wrote. A failure here must not fail the run — the scoring is already
  // committed and is the part that matters; a stale index is a stale dashboard,
  // not lost data.
  let indexed = 0;
  try {
    const built = await buildCustomerIndex();
    indexed = built.rows;
    warnings.push(...built.warnings);
  } catch (e) {
    warnings.push(
      `Customer index not rebuilt: ${e instanceof Error ? e.message : "unknown"}. ` +
      `Scoring succeeded; the dashboard will show the previous refresh.`,
    );
  }

  return {
    scored: snapshots.length,
    indexed,
    flagsRaised: toInsert.length,
    flagsUpdated: toUpdate.length,
    flagsResolved: toResolve.length,
    flagsSuppressed,
    bands,
    rulesVersion: RULES_VERSION,
    startedAt,
    finishedAt: new Date().toISOString(),
    warnings,
  };
}
