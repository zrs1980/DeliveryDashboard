// ─── The Focus dashboard ─────────────────────────────────────────────────────
//
// "Which customers should I open this morning, and why."
//
// ⚠ GROUPED BY REASON TO ACT, NOT RANKED INTO ONE LIST — and that is the whole
// design. A single ranked list forces one comparison the data cannot support:
// is a renewal notice due in 20 days more urgent than a draft that has been
// waiting three days? There is no honest answer, and inventing a composite
// score to produce one makes the list confident and wrong.
//
// So each section states its own reason, carries its own ordering, and says
// what it means. The reader does the comparing, which is the part they are
// actually good at.
//
// ⚠ EVERY SECTION MUST BE ABLE TO SAY "NOTHING HERE" AND MEAN IT. `cs_commitments`
// only recently gained a writer, so "nothing overdue" there can mean "nothing
// has ever been recorded". A section whose source is empty reports that it is
// empty rather than rendering as a clean bill of health — the same rule the
// triage view follows for disabled rules.
//
// This complements CsTriage rather than replacing it: triage is flags only,
// ranked by severity, and deliberately short. Focus covers what triage leaves
// out — drafts waiting, commitments owed, accounts never contacted, notice
// deadlines — which between them are most of the work.

import { getSupabaseAdmin } from "@/lib/supabase";
import type { CustomerIndexRow } from "@/lib/cs-customer-index";
import { healthCheckDue, CADENCE_LABEL } from "@/lib/healthchecks";
import type { Healthcheck } from "@/app/api/healthchecks/route";

export type FocusKind =
  | "notice_deadline" | "drafts_waiting" | "we_owe" | "flags_raised"
  | "quiet_under_contract" | "never_health_checked";

export interface FocusItem {
  customerNsId: string;
  name:         string;
  /**
   * Who NetSuite says owns this account. Carried on every item so the client
   * can offer a "mine" filter without a second lookup per row — and so a row
   * with no owner is visibly unowned rather than silently everyone's.
   */
  ownerName:    string | null;
  ownerNsId:    number | null;
  /** The single fact that put this row in this section. Never a judgment. */
  detail:       string;
  /** Sorts within the section. Lower is more urgent. */
  rank:         number;
  /** RAG, and ONLY where the section has earned it — see the section notes. */
  tone?:        "red" | "yellow";
  meta?:        Record<string, string | number | null>;
}

export interface FocusSection {
  kind:    FocusKind;
  title:   string;
  /** Why this section exists, shown to the reader. Not decoration. */
  why:     string;
  items:   FocusItem[];
  /**
   * Set when the section could not be evaluated rather than being genuinely
   * empty. "No overdue commitments" and "nothing has ever recorded a
   * commitment" must not render the same.
   */
  unavailable?: string;
  /**
   * Set when EVERY eligible account qualifies, which makes the section a fact
   * about a process rather than a list of accounts to work.
   *
   * ⚠ This is not a display cap and the threshold is not a tuning knob. 87 of
   * 87 customers having no health check on record does not mean "open 87
   * accounts"; it means the quarterly call is not being recorded at all, and
   * that is one sentence. Listing them would produce the longest section on the
   * page and the least actionable — the failure mode 03-HEALTH-SCORING.md warns
   * about, where a list becomes something you scroll past.
   */
  summary?: string;
}

export interface FocusResult {
  sections:  FocusSection[];
  /** Distinct owners across every item, for the filter. */
  owners:    { nsId: number; name: string }[];
  refreshedAt: string | null;
  /** Total across every section — what the tab badge counts. */
  total:     number;
  warnings:  string[];
}

const NOTICE_HORIZON_DAYS = 120;   // the outermost alert band in cs-contracts
const QUIET_DAYS          = 90;    // the activity window used everywhere else

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null;
  const then = new Date(iso + "T00:00:00");
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - today.getTime()) / 86_400_000);
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export async function buildFocus(): Promise<FocusResult> {
  const supabase = getSupabaseAdmin();
  const warnings: string[] = [];

  const [idx, drafts, commits, anyCommit, flags, checks] = await Promise.all([
    supabase.from("cs_customer_index").select("*"),
    // `generated_at`, not `created_at`, and the waiting statuses are the ones a
    // reviewer still has to act on. `snoozed` is parked on purpose and `expired`
    // is regenerated rather than sent late — neither is work waiting for you.
    supabase.from("cs_outreach_drafts")
      .select("id, customer_ns_id, motion, subject, status, generated_at, expires_at")
      .in("status", ["draft", "edited", "approved"]),
    supabase.from("cs_commitments")
      .select("id, customer_ns_id, description, due_date, direction, status, confirmed_by_human")
      .eq("direction", "we_owe").eq("status", "open"),
    // ⚠ "No open commitments" is only meaningful if commitments are being
    // recorded at all. Asking whether ANY row exists is the same guard
    // lib/cs-suppression.ts had to add after reporting "no open commitments we
    // owe" on every draft ever generated from an empty table.
    supabase.from("cs_commitments").select("id", { count: "exact", head: true }),
    // Severity, which the index does not carry — it holds only a count.
    supabase.from("cs_health_flags")
      .select("customer_ns_id, rule_id, title, severity, raised_at")
      .in("status", ["open", "acknowledged"]),
    // Every check, so the cadence maths can see what was last held.
    supabase.from("healthchecks").select("*"),
  ]);

  if (idx.error) {
    throw new Error(
      `Customer index unreadable: ${idx.error.message}. ` +
      `Run supabase/cs-customer-index.sql, then a scoring run to populate it.`,
    );
  }
  const rows = (idx.data ?? []) as CustomerIndexRow[];
  const byId = new Map(rows.map(r => [r.customer_ns_id, r]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  // NetSuite carries two owner fields and either counts. The consultant is
  // preferred for display because on a delivered account they are the person
  // actually in contact; the sales rep is the fallback.
  const ownerOf = (id: string): { ownerNsId: number | null; ownerName: string | null } => {
    const r = byId.get(id);
    if (!r) return { ownerNsId: null, ownerName: null };
    if (r.consultant_ns_id) return { ownerNsId: r.consultant_ns_id, ownerName: r.consultant_name };
    if (r.salesrep_ns_id)   return { ownerNsId: r.salesrep_ns_id,   ownerName: r.salesrep_name };
    return { ownerNsId: null, ownerName: null };
  };

  const sections: FocusSection[] = [];

  // ── 1. Notice deadlines ───────────────────────────────────────────────────
  // RAG is earned here: a notice date inside 30 days is a hard fact requiring
  // action, not an inference about health, so it cannot cry wolf the way
  // colouring 40 quiet accounts would.
  sections.push({
    kind: "notice_deadline",
    title: "Renewal decision due",
    why: "The deadline is the NOTICE date, not the end date. Past it, an auto-renewing "
       + "contract is already committed.",
    items: rows
      .map(r => ({ r, d: daysUntil(r.notice_date) }))
      .filter(x => x.d !== null && x.d <= NOTICE_HORIZON_DAYS)
      .map(({ r, d }) => ({
        customerNsId: r.customer_ns_id,
        ...ownerOf(r.customer_ns_id),
        name: r.name,
        detail: d! < 0
          ? `Notice date passed ${plural(Math.abs(d!), "day")} ago`
          : d === 0 ? "Notice due today" : `Notice due in ${plural(d!, "day")}`,
        rank: d!,
        tone: d! <= 30 ? "red" as const : "yellow" as const,
        meta: { noticeDate: r.notice_date, endDate: r.contract_end_date, annualValue: r.annual_value },
      }))
      .sort((a, b) => a.rank - b.rank),
  });

  // ── 2. Drafts waiting ─────────────────────────────────────────────────────
  // No RAG: a draft waiting is a queue, not a risk. Oldest first, because an
  // expired draft is regenerated rather than sent late.
  if (drafts.error) {
    sections.push({
      kind: "drafts_waiting", title: "Drafts waiting for you",
      why: "Nothing sends without a human. A draft sitting here is work already done.",
      items: [], unavailable: `Drafts unreadable: ${drafts.error.message}`,
    });
  } else {
    const now = Date.now();
    sections.push({
      kind: "drafts_waiting",
      title: "Drafts waiting for you",
      why: "Nothing sends without a human. A draft sitting here is work already done — "
         + "and one that expires is regenerated rather than sent late.",
      items: (drafts.data ?? []).filter(d => {
        // Expiry is enforced on read everywhere else in the queue; a draft whose
        // facts are stale is not work waiting, it is work to regenerate.
        const exp = d.expires_at ? new Date(d.expires_at).getTime() : null;
        return exp === null || exp > now;
      }).map(d => {
        const age = Math.floor((now - new Date(d.generated_at).getTime()) / 86_400_000);
        const exp = d.expires_at ? daysUntil(String(d.expires_at).slice(0, 10)) : null;
        return {
          customerNsId: d.customer_ns_id,
          ...ownerOf(d.customer_ns_id),
          name: nameOf(d.customer_ns_id),
          detail: `${d.motion.replace(/_/g, " ")} · waiting ${plural(age, "day")}`
                + (exp !== null && exp <= 3 ? ` · expires in ${plural(Math.max(exp, 0), "day")}` : ""),
          rank: -age,
          meta: { subject: d.subject, motion: d.motion },
        };
      }).sort((a, b) => a.rank - b.rank),
    });
  }

  // ── 3. We owe them ────────────────────────────────────────────────────────
  // The one section most likely to be empty for the wrong reason.
  const commitSection: FocusSection = {
    kind: "we_owe",
    title: "We owe them, overdue",
    why: "A promise we made and missed is the fastest way to lose an account, and the "
       + "cheapest thing on this page to fix.",
    items: [],
  };
  if (commits.error) {
    commitSection.unavailable = `Commitments unreadable: ${commits.error.message}`;
  } else if ((anyCommit.count ?? 0) === 0) {
    commitSection.unavailable =
      "No commitment has ever been recorded, so this section cannot tell you anything yet. "
      + "They are captured by the Process-meeting wizard when a human keeps them.";
  } else {
    commitSection.items = (commits.data ?? [])
      .map(c => ({ c, d: daysUntil(c.due_date) }))
      .filter(x => x.d !== null && x.d! <= 0)
      .map(({ c, d }) => ({
        customerNsId: c.customer_ns_id,
        ...ownerOf(c.customer_ns_id),
        name: nameOf(c.customer_ns_id),
        detail: `${c.description} — due ${plural(Math.abs(d!), "day")} ago`,
        rank: d!,
        tone: "red" as const,
        // An agent-extracted commitment nobody confirmed is a claim, not a fact.
        meta: { confirmed: c.confirmed_by_human ? "yes" : "unconfirmed" },
      }))
      .sort((a, b) => a.rank - b.rank);
  }
  sections.push(commitSection);

  // ── 4. Serious flags only ─────────────────────────────────────────────────
  //
  // ⚠ HIGH AND CRITICAL ONLY, AND THE NARROWING IS THE POINT. Every open flag
  // put 23 accounts here on the first real run, most of them banded `healthy`
  // with one or two low-severity flags — a list nobody would work, duplicating
  // a view that already does this properly.
  //
  // CsTriage is the flags view: it ranks by severity, carries the evidence and
  // owns the dismiss-with-reason flow, and its own spec says to keep it short.
  // Focus shows only the ones serious enough to interrupt a morning and points
  // at Triage for the rest, rather than being a worse second copy of it.
  const flagSection: FocusSection = {
    kind: "flags_raised",
    title: "Serious flags",
    why: "High and critical flags from the nightly run. Lower-severity flags live in "
       + "Triage, which ranks them and holds the evidence — this section exists to "
       + "interrupt you, not to list everything.",
    items: [],
  };
  if (flags.error) {
    flagSection.unavailable = `Flags unreadable: ${flags.error.message}`;
  } else {
    const serious = (flags.data ?? []).filter(
      f => f.severity === "high" || f.severity === "critical");
    const byCustomer = new Map<string, typeof serious>();
    for (const f of serious) {
      const list = byCustomer.get(f.customer_ns_id) ?? [];
      list.push(f);
      byCustomer.set(f.customer_ns_id, list);
    }
    flagSection.items = [...byCustomer.entries()].map(([id, fs]) => {
      const worst = fs.some(f => f.severity === "critical") ? "critical" : "high";
      return {
        customerNsId: id,
        ...ownerOf(id),
        name: nameOf(id),
        // The flag's own title, not a count — "2 open flags" tells you nothing
        // you can act on, and the point of interrupting someone is to say why.
        detail: fs.length === 1
          ? fs[0].title
          : `${fs[0].title} · +${fs.length - 1} more`,
        rank: worst === "critical" ? 0 : 1,
        tone: (worst === "critical" ? "red" : "yellow") as "red" | "yellow",
        meta: { severity: worst, band: byId.get(id)?.health_band ?? null },
      };
    }).sort((a, b) => a.rank - b.rank);

    const lower = (flags.data ?? []).length - serious.length;
    if (lower > 0) {
      flagSection.summary = flagSection.items.length === 0
        ? `No high or critical flags. ${plural(lower, "lower-severity flag")} open in Triage.`
        : undefined;
      flagSection.why += ` ${plural(lower, "lower-severity flag")} not shown here.`;
    }
  }
  sections.push(flagSection);

  // ── 5. Quiet under contract ───────────────────────────────────────────────
  // ⚠ THE CONTRACT GATE IS LOAD-BEARING. Without it this section is 40 of 55
  // accounts, because most are finished implementations rather than live
  // relationships going quiet — the exact failure documented for silent_account
  // in the rules engine. No RAG: quiet is a fact, not a verdict.
  sections.push({
    kind: "quiet_under_contract",
    title: "Quiet, under an active contract",
    why: `No logged time for ${QUIET_DAYS}+ days on an account still under contract. `
       + "Accounts with no contract are excluded — a finished implementation going quiet "
       + "is not the same thing, and including them puts most of the book on this list.",
    items: rows.filter(r =>
        (r.contract_status ?? "").toLowerCase() === "active" &&
        (r.days_since_activity === null || (r.days_since_activity ?? 0) >= QUIET_DAYS))
      .map(r => ({
        customerNsId: r.customer_ns_id,
        ...ownerOf(r.customer_ns_id),
        name: r.name,
        detail: r.days_since_activity === null
          ? "No logged time on record"
          : `Quiet ${plural(r.days_since_activity, "day")}`,
        rank: -(r.days_since_activity ?? 9999),
        meta: { hours90d: r.hours_90d, lastActivity: r.last_activity_date },
      })).sort((a, b) => a.rank - b.rank),
  });

  // ── 6. Health checks due ──────────────────────────────────────────────────
  //
  // ⚠ THIS USED TO SAY "NEVER HAD ONE" AND COLLAPSE TO A SENTENCE when every
  // customer qualified — true, honest, and completely unactionable. 87 of 87 is
  // a real process gap, but "which five do I book this week" is the question
  // that follows, and a sentence cannot answer it.
  //
  // It now ranks by CADENCE, which comes from contract value with a renewal in
  // sight overriding size — qbrTier(), shared with the QBR pack, so a health
  // check and a QBR cannot disagree about how often an account is owed a
  // conversation. A never-checked account on a quarterly cadence outranks a
  // never-checked account on an annual one, so the list stays short and in the
  // right order even while everyone is technically overdue.
  const hcRows = (checks.data ?? []) as Healthcheck[];
  const eligible = rows.filter(r => r.stage === "CUSTOMER");

  const due = eligible.map(r => ({
    r,
    d: healthCheckDue(r.customer_ns_id, hcRows, {
      annualValue:  r.annual_value ?? null,
      daysToNotice: daysUntil(r.notice_date),
    }),
  })).filter(({ r, d }) => {
    // ⚠ GATED ON A LIVE RELATIONSHIP, exactly like the silence rules. Without
    // this it is 87 rows — the entire customer book — because nobody has ever
    // recorded a check, and a list containing everyone ranks nothing.
    //
    // A finished implementation with no contract and no recent time is not
    // owed a quarterly call; it is done. The gate is the same one
    // `stalled_work` uses: money on the table, work in flight, or an open
    // project.
    const live = (r.annual_value ?? 0) > 0
      || (r.hours_90d ?? 0) > 0
      || (r.active_project_count ?? 0) > 0;
    if (!live) return false;
    return d.neverHeld || (d.daysUntil !== null && d.daysUntil <= 30);
  });

  const CADENCE_RANK = { quarterly: 0, twice_yearly: 1000, annual: 2000 };

  sections.push({
    kind: "never_health_checked",
    title: "Health check due",
    why: "Ranked by how often the account is owed one: contract value sets the cadence, "
       + "and a renewal inside 180 days promotes it to quarterly. An account that has "
       + "never had a check is owed one NOW, not twelve months from a clock nobody started.",
    items: due.map(({ r, d }) => ({
      customerNsId: r.customer_ns_id,
      ...ownerOf(r.customer_ns_id),
      name: r.name,
      detail: d.neverHeld
        ? `Never held · ${CADENCE_LABEL[d.cadence].toLowerCase()} · ${d.reason}`
        : (d.daysUntil ?? 0) < 0
          ? `${plural(Math.abs(d.daysUntil ?? 0), "day")} overdue · ${CADENCE_LABEL[d.cadence].toLowerCase()}`
          : `Due in ${plural(d.daysUntil ?? 0, "day")} · ${CADENCE_LABEL[d.cadence].toLowerCase()}`,
      rank: CADENCE_RANK[d.cadence]
          + (d.neverHeld ? -500 : Math.max(-499, Math.min(499, d.daysUntil ?? 0))),
      // Amber only when genuinely late. Due next week is not a missed deadline.
      tone: (d.neverHeld || (d.daysUntil ?? 0) < 0) ? "yellow" as const : undefined,
      meta: { cadence: d.cadence, dueDate: d.dueDate, projects: r.project_count ?? 0 },
    })).sort((a, b) => a.rank - b.rank),
  });

  // Owners actually present on something actionable — not the whole staff list.
  // A filter offering people with nothing in it is noise.
  const owners = [...new Map(
    sections.flatMap(sec => sec.items)
      .filter(i => i.ownerNsId !== null && i.ownerName)
      .map(i => [i.ownerNsId!, { nsId: i.ownerNsId!, name: i.ownerName! }])
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    sections,
    owners,
    refreshedAt: rows[0]?.refreshed_at ?? null,
    total: sections.reduce((n, s) => n + s.items.length, 0),
    warnings,
  };
}
