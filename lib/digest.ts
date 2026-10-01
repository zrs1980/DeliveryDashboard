// ─── The morning digest ──────────────────────────────────────────────────────
//
// ⚠ NOTHING IN THIS APPLICATION EVER REACHED A PERSON WHO WAS NOT ALREADY
// LOOKING AT IT. Two crons run at 07:00 — scoring, then the CSM agent — and
// both produce findings and tell nobody. Every surface is pull: Focus, Triage,
// Drafts, health checks, tasks. All of them answer a question you have to
// remember to ask. Assigning someone a task did not even notify them.
//
// This assembles, per person, the things that are actually waiting on them, so
// one message can carry it.
//
// ─── Rules, each the difference between useful and muted ────────────────────
//
// ⚠ AN EMPTY DIGEST IS NOT SENT. A daily message saying "nothing today" trains
// people to ignore the one that matters. Silence is a valid and common output.
//
// ⚠ ONLY THINGS WITH A DEADLINE OR A DECISION. Not "here is your book", not a
// count of accounts. Every line is something that is late, due, or waiting on
// a judgment only that person can make — if it would not change their morning,
// it is not in here.
//
// ⚠ IT NEVER INVENTS URGENCY. Where a section would be long it is truncated
// with an honest "+N more", and a section with nothing in it is omitted
// entirely rather than rendered as a reassuring zero.

import { getSupabaseAdmin } from "@/lib/supabase";
import { getActiveStaff } from "@/lib/roster";
import { readCustomerIndex, type CustomerIndexRow } from "@/lib/cs-customer-index";
import { lastContactOf } from "@/lib/cs-focus";
import { healthCheckDue } from "@/lib/healthchecks";
import { hasCsLayer } from "@/lib/cs-permissions";
import type { Healthcheck } from "@/app/api/healthchecks/route";

const SOON_DAYS = 2;          // "due in the next couple of days" counts as due
const QUIET_MIN = 90;
const QUIET_MAX = 365;        // past this it is a dormant record, not a signal
const MAX_PER_SECTION = 5;

export interface DigestLine {
  text:   string;
  /** Late enough to lead with. Drives ordering, not colour — Slack has none. */
  urgent: boolean;
}

export interface DigestSection {
  title: string;
  lines: DigestLine[];
  more:  number;
}

export interface Digest {
  email:    string;
  name:     string | null;
  nsId:     number | null;
  sections: DigestSection[];
  total:    number;
}

const daysUntil = (d: string | null | undefined): number | null => {
  if (!d) return null;
  const x = new Date(String(d).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(x.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((x.getTime() - t.getTime()) / 86_400_000);
};

const whenText = (d: number | null): string =>
  d === null ? "no date" : d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "due today" : `due in ${d}d`;

function section(title: string, lines: DigestLine[]): DigestSection | null {
  if (!lines.length) return null;
  const sorted = [...lines].sort((a, b) => Number(b.urgent) - Number(a.urgent));
  return {
    title,
    lines: sorted.slice(0, MAX_PER_SECTION),
    more: Math.max(0, sorted.length - MAX_PER_SECTION),
  };
}

/**
 * Build a digest for everyone who has something waiting.
 *
 * One pass over the shared data, then a slice per person — the alternative is
 * re-reading the index and the task table once per member of staff.
 */
export async function buildDigests(): Promise<Digest[]> {
  const db = getSupabaseAdmin();

  const [roster, index, tasksRes, commitsRes, checksRes, draftsRes] = await Promise.all([
    // ⚠ ACTIVE STAFF, NOT THE WHOLE ROSTER. getStaffRoster() deliberately
    // includes people who have left, so a name on last year's record still
    // resolves — and the first real run built a digest for a consultant who
    // left in April. Messaging someone who no longer works here is the kind of
    // wrong that ends a daily message's credibility on day one.
    getActiveStaff(),
    readCustomerIndex().catch(() => [] as CustomerIndexRow[]),
    db.from("pm_crm_tasks")
      .select("id, title, due_date, status, assigned_to, customer_ns_id")
      .in("status", ["open", "in_progress"]),
    db.from("cs_commitments")
      .select("id, customer_ns_id, description, due_date, direction, status")
      .eq("status", "open"),
    db.from("healthchecks").select("*"),
    db.from("cs_outreach_drafts")
      .select("id, customer_ns_id, motion, subject, status, generated_at, expires_at")
      .in("status", ["draft", "edited", "approved"]),
  ]);

  const rows    = index;
  const nameOf  = new Map(rows.map(r => [r.customer_ns_id, r.name]));
  const hcRows  = (checksRes.data ?? []) as Healthcheck[];

  // Account ownership, the same rule Focus uses: consultant first, then rep.
  const ownerOf = (r: CustomerIndexRow): number | null =>
    r.consultant_ns_id ?? r.salesrep_ns_id ?? null;

  const out: Digest[] = [];

  for (const staff of Object.values(roster.byId)) {
    const email = String(staff.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const nsId = Number(staff.id);
    const mine = rows.filter(r => ownerOf(r) === nsId);
    const sections: DigestSection[] = [];

    // ── Tasks assigned to them ────────────────────────────────────────────
    const tasks = (tasksRes.data ?? [])
      .filter(t => String(t.assigned_to ?? "").toLowerCase() === email)
      .map(t => ({ t, d: daysUntil(t.due_date) }))
      .filter(({ d }) => d !== null && d <= SOON_DAYS);
    const taskSec = section("Your tasks", tasks.map(({ t, d }) => ({
      text: `${t.title}${t.customer_ns_id ? ` — ${nameOf.get(t.customer_ns_id) ?? ""}` : ""} (${whenText(d)})`,
      urgent: (d ?? 0) < 0,
    })));
    if (taskSec) sections.push(taskSec);

    // ── Promises on their accounts ────────────────────────────────────────
    // cs_commitments has no owner column, so the ACCOUNT's owner is who this
    // lands on. That is also who the customer will chase.
    const mineIds = new Set(mine.map(r => r.customer_ns_id));
    const commits = (commitsRes.data ?? [])
      .filter(c => mineIds.has(c.customer_ns_id) && c.direction === "we_owe")
      .map(c => ({ c, d: daysUntil(c.due_date) }))
      .filter(({ d }) => d !== null && d <= SOON_DAYS);
    const comSec = section("You promised", commits.map(({ c, d }) => ({
      text: `${nameOf.get(c.customer_ns_id) ?? c.customer_ns_id}: ${c.description} (${whenText(d)})`,
      urgent: (d ?? 0) < 0,
    })));
    if (comSec) sections.push(comSec);

    // ── Health checks to book ─────────────────────────────────────────────
    const due = mine.map(r => ({
      r, h: healthCheckDue(r.customer_ns_id, hcRows, {
        annualValue: r.annual_value ?? null, daysToNotice: daysUntil(r.notice_date),
      }),
    })).filter(({ r, h }) => {
      // Same live-relationship gate Focus uses — a finished implementation is
      // not owed a quarterly call, and without this it is the whole book.
      const live = (r.annual_value ?? 0) > 0 || (r.hours_90d ?? 0) > 0
                || (r.active_project_count ?? 0) > 0;
      if (!live) return false;

      // ⚠ THE ANNUAL NEVER-HELD TAIL IS A BACKLOG, NOT A MORNING'S WORK, AND
      // IT DOES NOT BELONG IN A DAILY MESSAGE. The first real run gave one
      // consultant 19 items of which 16 were "never held (annual)" — a list
      // nobody can act on, pushed every day, which is precisely how a digest
      // gets muted.
      //
      // The digest carries accounts on a REAL clock: quarterly or twice-yearly
      // cadence, meaning there is contract value or a renewal in sight. The
      // annual tail stays on Focus, ranked, where someone can work through it
      // when they choose to.
      if (h.cadence === "annual" && h.neverHeld) return false;
      return h.neverHeld || (h.daysUntil !== null && h.daysUntil <= 0);
    });
    const hcSec = section("Health checks to book", due.map(({ r, h }) => ({
      text: `${r.name} — ${h.neverHeld ? "never held" : `${Math.abs(h.daysUntil ?? 0)}d overdue`} (${h.cadence.replace("_", " ")})`,
      urgent: h.neverHeld,
    })));
    if (hcSec) sections.push(hcSec);

    // ── Accounts that have gone quiet ─────────────────────────────────────
    const quiet = mine.map(r => ({ r, lc: lastContactOf(r) }))
      .filter(({ r, lc }) =>
        ((r.contract_status ?? "").toLowerCase() === "active"
          || (r.annual_value ?? 0) > 0 || (r.active_project_count ?? 0) > 0)
        && lc.days !== null && lc.days >= QUIET_MIN && lc.days <= QUIET_MAX);
    const qSec = section("Gone quiet", quiet.map(({ r, lc }) => ({
      text: `${r.name} — ${lc.days}d since ${lc.source}`,
      urgent: false,
    })));
    if (qSec) sections.push(qSec);

    // ── Drafts waiting ────────────────────────────────────────────────────
    // ⚠ cs_layer ONLY. A draft is outreach the CS layer proposed; surfacing one
    // to the delivery team would put a risk judgment in front of exactly the
    // people the boundary exists to keep it from.
    if (hasCsLayer(email)) {
      const now = Date.now();
      const drafts = (draftsRes.data ?? [])
        .filter(d => mineIds.has(d.customer_ns_id))
        .filter(d => !d.expires_at || new Date(d.expires_at).getTime() > now);
      const dSec = section("Drafts waiting for you", drafts.map(d => ({
        text: `${nameOf.get(d.customer_ns_id) ?? d.customer_ns_id}: ${d.subject ?? d.motion}`,
        urgent: false,
      })));
      if (dSec) sections.push(dSec);
    }

    const total = sections.reduce((n, s) => n + s.lines.length + s.more, 0);
    // Silence is a valid output — see the header.
    if (total > 0) {
      out.push({ email, name: staff.name ?? null, nsId, sections, total });
    }
  }

  return out.sort((a, b) => b.total - a.total);
}

/** Slack mrkdwn. Plain enough to read as text if it is ever sent elsewhere. */
export function renderDigest(d: Digest): string {
  const lines: string[] = [
    `*Good morning${d.name ? `, ${d.name.split(" ")[0]}` : ""}* — ${d.total} thing${d.total === 1 ? "" : "s"} waiting on you.`,
  ];
  for (const s of d.sections) {
    lines.push("", `*${s.title}*`);
    for (const l of s.lines) lines.push(`• ${l.text}`);
    if (s.more) lines.push(`• _+${s.more} more_`);
  }
  lines.push("", "_Reply here if any of this is wrong or noisy._");
  return lines.join("\n");
}
