import { NextResponse } from "next/server";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runHealthScoring } from "@/lib/cs-scoring-run";
import { SEVERITY_WEIGHT, type Severity, type Band } from "@/lib/cs-rules";
import { fetchNsContracts, currentContractByCustomer } from "@/lib/cs-ns-contracts";
import { fetchCsCustomers } from "@/lib/cs-customers";

export const revalidate  = 0;
export const maxDuration = 300;

const SCHEMA_HINT = "Run supabase/cs-agent-schema.sql in the Supabase SQL Editor.";

/**
 * The triage view: who needs attention today, and why.
 *
 * Ranked by severity first, then how soon a contract decision is due, then the
 * size of the score drop. docs/03-HEALTH-SCORING.md is firm that the default
 * view stays short — "ten accounts you should look at today is useful; a list of
 * two hundred sorted by score is not" — so accounts with no open flag are left
 * out entirely rather than padding the list with healthy rows.
 */

interface FlagRow {
  id: string; customer_ns_id: string; rule_id: string; severity: Severity;
  title: string; reason: string; evidence: Record<string, unknown>;
  status: string; raised_at: string; suppressed_until: string | null;
}

export async function GET(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const includeAll = new URL(req.url).searchParams.get("all") === "1";
  const supabase = getSupabaseAdmin();

  try {
    const [
      { data: flags, error: fErr }, { data: snaps, error: sErr },
      nsContracts, customers, { data: overlays },
    ] = await Promise.all([
        supabase.from("cs_health_flags").select("*")
          .in("status", includeAll ? ["open", "acknowledged", "resolved", "dismissed"] : ["open", "acknowledged"]),
        supabase.from("cs_health_snapshots")
          .select("customer_ns_id, score, band, delta, computed_at, signals, rules_version")
          .order("computed_at", { ascending: false }).limit(5000),
        // Contracts come from NetSuite, not cs_contracts — that table now holds
        // only notice-period overlays. Reading it here was leaving renewal
        // proximity and contract value empty for every row, which silently
        // removed two of the four ranking keys.
        fetchNsContracts().catch(() => [] as Awaited<ReturnType<typeof fetchNsContracts>>),
        // Names come from the canonical customer list. They used to be taken
        // from cs_contracts, so once contracts moved to NetSuite every row fell
        // back to the raw customer id.
        fetchCsCustomers().catch(() => [] as Awaited<ReturnType<typeof fetchCsCustomers>>),
        supabase.from("cs_contracts").select("source, notice_period_days"),
      ]);

    if (fErr) return NextResponse.json({ error: fErr.message, hint: SCHEMA_HINT }, { status: 503 });
    if (sErr) return NextResponse.json({ error: sErr.message, hint: SCHEMA_HINT }, { status: 503 });

    // Newest snapshot per customer.
    const latest: Record<string, { score: number; band: Band; delta: number | null; computed_at: string; signals: Record<string, unknown> }> = {};
    for (const s of snaps ?? []) {
      if (!latest[s.customer_ns_id]) {
        latest[s.customer_ns_id] = { score: s.score, band: s.band, delta: s.delta, computed_at: s.computed_at, signals: s.signals ?? {} };
      }
    }

    // Every scored customer resolves to a name, whether or not they hold a
    // contract — which is most of them.
    const nameOf: Record<string, string> = {};
    for (const c of customers) nameOf[String(c.id)] = c.companyname;

    const noticeBySource: Record<string, number> = {};
    for (const o of overlays ?? []) {
      if (o.source?.startsWith("netsuite:")) noticeBySource[o.source] = o.notice_period_days ?? 0;
    }

    const noticeOf: Record<string, number | null> = {};
    const valueOf: Record<string, number | null> = {};
    const DAY = 86_400_000;
    for (const c of Object.values(currentContractByCustomer(nsContracts))) {
      valueOf[c.customerNsId] = c.annualValue;
      // A contract name from NetSuite beats the customer list where they differ.
      if (c.customerName) nameOf[c.customerNsId] ??= c.customerName;
      if (!c.endDate) continue;
      const end = new Date(`${c.endDate}T00:00:00`);
      if (Number.isNaN(end.getTime())) continue;
      const noticeDays = noticeBySource[`netsuite:${c.nsContractId}`] ?? 0;
      noticeOf[c.customerNsId] = Math.round((end.getTime() - noticeDays * DAY - Date.now()) / DAY);
    }

    const byCustomer = new Map<string, FlagRow[]>();
    for (const f of (flags ?? []) as FlagRow[]) {
      const list = byCustomer.get(f.customer_ns_id) ?? [];
      list.push(f);
      byCustomer.set(f.customer_ns_id, list);
    }

    const rows = [...byCustomer.entries()].map(([cid, fs]) => {
      const sorted = [...fs].sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]);
      const top = sorted[0];
      const snap = latest[cid];
      const sig = (snap?.signals ?? {}) as Record<string, unknown>;
      return {
        customerNsId: cid,
        customerName: nameOf[cid] ?? cid,
        score: snap?.score ?? null,
        band:  snap?.band  ?? null,
        delta: snap?.delta ?? null,
        computedAt: snap?.computed_at ?? null,
        topSeverity: top.severity,
        headline: top.reason,
        headlineTitle: top.title,
        daysToNotice: noticeOf[cid] ?? null,
        annualValue:  valueOf[cid] ?? null,
        daysSinceLastHour: (sig.daysSinceLastHour as number | null) ?? null,
        flags: sorted.map(f => ({
          id: f.id, ruleId: f.rule_id, severity: f.severity, title: f.title,
          reason: f.reason, evidence: f.evidence, status: f.status, raisedAt: f.raised_at,
        })),
      };
    });

    // Severity → renewal proximity → contract value → score drop. The spec's
    // order, and it puts "critical, and a decision is due in nine days" above
    // "critical, no contract on file".
    rows.sort((a, b) => {
      const s = SEVERITY_WEIGHT[b.topSeverity] - SEVERITY_WEIGHT[a.topSeverity];
      if (s) return s;
      const an = a.daysToNotice ?? Number.POSITIVE_INFINITY;
      const bn = b.daysToNotice ?? Number.POSITIVE_INFINITY;
      if (an !== bn) return an - bn;
      const av = b.annualValue ?? 0, bv = a.annualValue ?? 0;
      if (av !== bv) return av - bv;
      return (a.delta ?? 0) - (b.delta ?? 0);
    });

    return NextResponse.json({
      rows,
      lastRun: snaps?.[0]?.computed_at ?? null,
      rulesVersion: snaps?.[0]?.rules_version ?? null,
      contractsRecorded: nsContracts.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/** POST — run scoring now, rather than waiting for 07:00 UTC. */
export async function POST() {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  try {
    const result = await runHealthScoring();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/**
 * PATCH { flagId, status, dismissedReason?, suppressDays? } — acknowledge or dismiss.
 *
 * Dismissal takes a reason on purpose. The spec calls dismissal reasons "the
 * best available feedback on rule quality" — a rule dismissed repeatedly across
 * accounts is a bad rule, and without the reason there is nothing to review.
 */
export async function PATCH(req: Request) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  let body: { flagId?: string; status?: string; dismissedReason?: string; suppressDays?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 }); }

  const flagId = String(body.flagId ?? "").trim();
  const status = String(body.status ?? "").trim();
  const ALLOWED = ["open", "acknowledged", "actioned", "resolved", "dismissed"];
  if (!flagId || !ALLOWED.includes(status)) {
    return NextResponse.json({ error: `flagId and a status in ${ALLOWED.join("/")} are required` }, { status: 400 });
  }
  if (status === "dismissed" && !String(body.dismissedReason ?? "").trim()) {
    return NextResponse.json({ error: "A dismissal needs a reason — it is the only feedback on rule quality." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "dismissed") {
    patch.dismissed_reason = String(body.dismissedReason).trim();
    const days = Math.max(0, Math.floor(Number(body.suppressDays ?? 90)));
    if (days > 0) {
      patch.suppressed_until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    }
  }
  if (status === "resolved") patch.resolved_at = new Date().toISOString();

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("cs_health_flags").update(patch).eq("id", flagId).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message, hint: SCHEMA_HINT }, { status: 503 });
    if (!data)  return NextResponse.json({ error: "No flag with that id" }, { status: 404 });
    return NextResponse.json({ flag: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
