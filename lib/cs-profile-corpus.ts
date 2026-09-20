import { runSuiteQLAll } from "@/lib/netsuite";
import { LEAVE_PROJECT_IDS } from "@/lib/constants";

// ─── Customer corpus — the raw material profile extraction reads ─────────────
//
// docs/02-CUSTOMER-PROFILES.md expects to extract from ClickUp descriptions,
// NetSuite tickets, licence records, email threads and consultant notes, and
// warns that if the data is too thin the fix is upstream rather than a better
// prompt. Measured against the live account (Sep 2026), the problem is the
// opposite: there is far too much, and most of it is noise.
//
//   Yield Engineering (11619): 142 cases carrying 3,033,670 characters of body
//   text — about 750k tokens, and nearly all of it quoted HTML email. Plus
//   250,398 characters of time-entry memos, most of them "CU" or "Updates".
//
//   Salt and Stone (16650): no cases at all, but 43,346 characters of memos
//   across 10 projects.
//
// So the job here is reduction, not collection: strip, dedupe, budget, and
// preserve the parts that carry signal.
//
// ⚠ TWO ROLLUP TRAPS, both the same shape as timebill.customer:
//
//   1. `supportcase.company` is often a JOB, not a customer — 596 of 1080 cases
//      in this account. Joining it straight to `customer` loses over half the
//      ticket history: Yield Engineering reads as having ZERO cases when it
//      actually has the most in the account, 142, hung off its Managed Services
//      Agreement job.
//   2. `timebill.customer` is a job id too. Same rollup.
//
// (The Cases tab itself is fine — it resolves through `entity`, whose altname
// renders as "Customer : Job Name". It is the programmatic join that breaks.)

export interface CorpusProject {
  id:        string;
  entityid:  string;
  name:      string;
  userNotes: string | null;
}

export interface CorpusCase {
  id:    string;
  title: string;
  date:  string;
  text:  string;   // stripped of HTML and quoted replies
}

export interface CustomerCorpus {
  customerNsId: string;
  windowMonths: number;
  projects:     CorpusProject[];
  cases:        CorpusCase[];
  /** Deduped, with how often each was written. Repetition is itself a signal. */
  timeMemos:    Array<{ text: string; count: number }>;
  taskTitles:   string[];
  stats: {
    rawCaseChars:     number;
    keptCaseChars:    number;
    rawMemoCount:     number;
    uniqueMemoCount:  number;
    casesTruncated:   number;
    notes:            string[];
  };
}

export interface CorpusOptions {
  /** How far back to look. The spec suggests 24 months. */
  windowMonths?: number;
  /** Per-case cap after stripping. Long threads are mostly repetition. */
  maxCaseChars?: number;
  /** Ceiling on cases pulled, newest first. */
  maxCases?: number;
}

// ─── Text reduction ──────────────────────────────────────────────────────────

/** Strip HTML to readable text. Case bodies arrive as full Outlook HTML mail. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cut an email at the first quoted reply.
 *
 * These cases are email threads, so each message repeats every message before
 * it. Keeping the whole thing multiplies the corpus by the thread depth and
 * tells the model the same thing ten times — while pushing the part that is
 * actually new out of the budget.
 */
export function stripQuotedReply(text: string): string {
  const markers = [
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^_{10,}/m,
    /^From:\s.+$/im,
    /^On .{4,80}\bwrote:\s*$/im,
    /^Sent from my \w+/im,
  ];
  let cut = text.length;
  for (const m of markers) {
    const hit = text.match(m);
    if (hit?.index !== undefined && hit.index < cut) cut = hit.index;
  }
  return text.slice(0, cut).trim();
}

/**
 * Collapse repeated memos to unique text plus a count.
 *
 * 3,732 memos on one account reduce to a few hundred distinct lines — "CU" and
 * "Updates" appear hundreds of times each. The count is kept because a phrase
 * written ninety times describes a recurring activity, which is exactly the kind
 * of manual process the profile is looking for.
 */
export function dedupeMemos(memos: Array<string | null>): Array<{ text: string; count: number }> {
  const seen = new Map<string, { text: string; count: number }>();
  for (const raw of memos) {
    const text = (raw ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 3) continue;           // "CU", "-", ""
    const key = text.toLowerCase();
    const hit = seen.get(key);
    if (hit) hit.count++;
    else seen.set(key, { text, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

// ─── Gathering ───────────────────────────────────────────────────────────────

export async function gatherCustomerCorpus(
  customerNsId: string | number,
  opts: CorpusOptions = {},
): Promise<CustomerCorpus> {
  const cid          = Number(customerNsId);
  const windowMonths = opts.windowMonths ?? 24;
  const maxCaseChars = opts.maxCaseChars ?? 4_000;
  const maxCases     = opts.maxCases ?? 150;
  const notes: string[] = [];

  if (!Number.isFinite(cid)) throw new Error(`Invalid customer id: ${customerNsId}`);

  // Projects. The names alone carry real signal — "Advanced Procurement
  // Implementation", "Field Synchronization for Work Orders", "Shopify -
  // NetSuite Celigo Integration" name modules and integrations outright.
  const projectRows = await runSuiteQLAll<{
    id: string; entityid: string; companyname: string | null;
    custentity_user_notes: string | null;
  }>(`
    SELECT id, entityid, companyname, custentity_user_notes
    FROM job WHERE customer = ${cid}
  `);

  const projects: CorpusProject[] = projectRows.map(p => ({
    id:        String(p.id),
    entityid:  p.entityid ?? "",
    name:      p.companyname ?? "",
    userNotes: (p.custentity_user_notes ?? "").trim() || null,
  }));

  const jobIds = projects.map(p => Number(p.id)).filter(Number.isFinite);

  // Cases: the customer id AND every job id (see the rollup trap above).
  const caseScope = [cid, ...jobIds].join(",");
  let rawCaseChars = 0, casesTruncated = 0;
  let cases: CorpusCase[] = [];

  const caseRows = await runSuiteQLAll<{
    id: string; title: string | null; incomingmessage: string | null; createddate: string;
  }>(`
    SELECT sc.id, sc.title, sc.incomingmessage,
           TO_CHAR(sc.createddate, 'YYYY-MM-DD') AS createddate
    FROM supportcase sc
    WHERE sc.company IN (${caseScope})
      AND sc.createddate >= ADD_MONTHS(SYSDATE, -${windowMonths})
    ORDER BY sc.createddate DESC
  `);

  // supportcasemessage is NOT queryable in SuiteQL ("Invalid search type"), so
  // the threaded replies are out of reach; incomingmessage is the opening
  // message only. Enough for a pain point, not a resolution.
  if (caseRows.length) notes.push("Case text is the opening message only — supportcasemessage is not exposed in SuiteQL.");

  cases = caseRows.slice(0, maxCases).map(c => {
    const raw = c.incomingmessage ?? "";
    rawCaseChars += raw.length;
    let text = stripQuotedReply(stripHtml(raw));
    if (text.length > maxCaseChars) { text = text.slice(0, maxCaseChars); casesTruncated++; }
    return { id: String(c.id), title: (c.title ?? "").trim(), date: c.createddate, text };
  });
  if (caseRows.length > maxCases) {
    notes.push(`${caseRows.length} cases in window; kept the ${maxCases} most recent.`);
  }

  // Consultant memos at the point of work — the spec's richest source of manual
  // processes. Leave jobs excluded: PTO descriptions say nothing about a client.
  const workJobIds = jobIds.filter(id => !LEAVE_PROJECT_IDS.has(String(id)));
  let memoRows: Array<{ memo: string | null }> = [];
  if (workJobIds.length) {
    memoRows = await runSuiteQLAll<{ memo: string | null }>(`
      SELECT tb.memo FROM timebill tb
      WHERE tb.customer IN (${workJobIds.join(",")})
        AND tb.timetype = 'A'
        AND tb.trandate >= ADD_MONTHS(SYSDATE, -${windowMonths})
    `);
  }
  const timeMemos = dedupeMemos(memoRows.map(m => m.memo));

  // Project task titles — the delivery breakdown, phase and task names.
  let taskTitles: string[] = [];
  if (jobIds.length) {
    const taskRows = await runSuiteQLAll<{ title: string | null }>(`
      SELECT pt.title FROM projecttask pt WHERE pt.project IN (${jobIds.join(",")})
    `);
    taskTitles = [...new Set(taskRows.map(t => (t.title ?? "").trim()).filter(Boolean))];
  }

  if (!cases.length)     notes.push("No support cases — pain points must come from memos and project names.");
  if (!timeMemos.length) notes.push("No time-entry memos — the manual-process signal is absent for this account.");

  return {
    customerNsId: String(cid),
    windowMonths,
    projects,
    cases,
    timeMemos,
    taskTitles,
    stats: {
      rawCaseChars,
      keptCaseChars:   cases.reduce((n, c) => n + c.text.length, 0),
      rawMemoCount:    memoRows.length,
      uniqueMemoCount: timeMemos.length,
      casesTruncated,
      notes,
    },
  };
}
