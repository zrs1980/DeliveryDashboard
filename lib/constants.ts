export const EMPLOYEES: Record<number, string> = {
  11944: "Shai Aradais",
  15622: "Alecia Gilmore",
  15735: "Sam Balido",
  15849: "Jason Tutanes",
  17191: "Piero Loza Palma",
};

export const PMS: Record<number, string> = {
  11944: "Shai Aradais",
  15622: "Alecia Gilmore",
  4812:  "Kathy Bacero",
};

// Design system color tokens
export const C = {
  bg:        "#EEF1F5",
  surface:   "#FFFFFF",
  alt:       "#F7F9FC",
  border:    "#E2E5EA",
  mid:       "#C9CDD4",
  text:      "#0D1117",
  textMid:   "#4A5568",
  textSub:   "#8A95A3",
  green:     "#0C6E44",
  greenBg:   "#E6F7F0",
  greenBd:   "#A7E3C4",
  yellow:    "#92600A",
  yellowBg:  "#FFF8E6",
  yellowBd:  "#F5D990",
  red:       "#C0392B",
  redBg:     "#FEF0EF",
  redBd:     "#F5B8B5",
  blue:      "#1A56DB",
  blueBg:    "#EBF5FF",
  blueBd:    "#93C5FD",
  purple:    "#6B21A8",
  purpleBg:  "#F5F0FF",
  purpleBd:  "#C4B5FD",
  orange:    "#B45309",
  orangeBg:  "#FFF7ED",
  orangeBd:  "#FCD38A",
  teal:      "#0D6E6E",
  tealBg:    "#E6F7F7",
  tealBd:    "#81D4D4",
  sh:        "0 1px 3px rgba(0,0,0,0.05)",
  shMd:      "0 4px 14px rgba(0,0,0,0.07)",
  font:      "'DM Sans','Segoe UI',sans-serif",
  mono:      "'DM Mono','Fira Mono',monospace",
};

export const STATUS_STYLES: Record<string, { bg: string; color: string; bd: string; label: string }> = {
  "done":                  { bg:"#E6F7F0", color:"#0C6E44", bd:"#A7E3C4", label:"Done" },
  "in progress":           { bg:"#EBF5FF", color:"#1A56DB", bd:"#93C5FD", label:"In Progress" },
  "in review":             { bg:"#EBF5FF", color:"#1A56DB", bd:"#93C5FD", label:"In Review" },
  "on hold":               { bg:"#FEF0EF", color:"#C0392B", bd:"#F5B8B5", label:"On Hold" },
  "new":                   { bg:"#F7F9FC", color:"#4A5568", bd:"#C9CDD4", label:"New" },
  "awaiting confirmation": { bg:"#FFF7ED", color:"#B45309", bd:"#FCD38A", label:"Awaiting" },
  "input required":        { bg:"#FFF7ED", color:"#B45309", bd:"#FCD38A", label:"Input Required" },
  "scheduled":             { bg:"#F5F0FF", color:"#6B21A8", bd:"#C4B5FD", label:"Scheduled" },
  "supplied":              { bg:"#E6F7F7", color:"#0D6E6E", bd:"#81D4D4", label:"Supplied" },
  "code review":           { bg:"#E6F7F0", color:"#0C6E44", bd:"#A7E3C4", label:"Code Review" },
  "ready for qa":          { bg:"#F5F0FF", color:"#6B21A8", bd:"#C4B5FD", label:"Ready for QA" },
  "qa in progress":        { bg:"#E6F7F7", color:"#0D6E6E", bd:"#81D4D4", label:"QA In Progress" },
  "uat in progress":       { bg:"#EBF5FF", color:"#1A56DB", bd:"#93C5FD", label:"UAT In Progress" },
  "completed in sb":       { bg:"#E6F7F7", color:"#0D6E6E", bd:"#81D4D4", label:"Completed in SB" },
  "requires ns support":   { bg:"#FFF7ED", color:"#B45309", bd:"#FCD38A", label:"Requires NS Support" },
  "stuck":                 { bg:"#FEF0EF", color:"#C0392B", bd:"#F5B8B5", label:"Stuck" },
  "moved to zendesk":      { bg:"#F7F9FC", color:"#4A5568", bd:"#C9CDD4", label:"Moved to Zendesk" },
};

// ─── ClickUp list ID overrides ────────────────────────────────────────────────
// ClickUp workspace URLs stored in NetSuite use an old view-based format
// (/v/l/182ddq-XXXXX) that doesn't expose the real API list ID.
// Map NetSuite project ID → correct ClickUp API list ID.
// Discovered via /api/debug/clickup. Add new projects here as needed.
export const CLICKUP_LIST_OVERRIDES: Record<number, string> = {
  18386: "901324962382", // NetSuite Optimization Strategy  → Pacific OneSource
  17310: "901312802496", // Service Request - MRP Dry BU    → Yield Engineering
  18380: "901324146845", // Netsuite Implementation          → Nautical Fulfillment & Logistics
  18171: "901306383364", // JGL NS Implementation            → JGL Livestock
  18403: "901317326846", // NS Implementation                → Salt & Stone
};

// ─── Standalone internal ClickUp lists ───────────────────────────────────────
// Lists that have no corresponding NetSuite project (internal team tasks).
// These are fetched and shown in the Task Command Center only — excluded from
// Portfolio Overview and Resource Allocation views.
// Add new internal lists here as needed.
export const STANDALONE_CLICKUP_LISTS: Array<{ listId: string; label: string }> = [
  { listId: "901326539501", label: "Internal Tasks" },
];

/** Hire dates by employee email — used as fallback when hiredate is not exposed in SuiteQL */
export const HIRE_DATES: Record<string, string> = {
  "zabe@cebasolutions.com": "2025-10-01",
};

/**
 * NetSuite project (`job`) internal IDs that represent ABSENCE, not work.
 *
 * Time logged against these is subtracted from a consultant's available hours
 * before utilization is computed — a day off is not a day they failed to
 * utilize. Without this, taking leave silently lowers your utilization: Sam
 * Balido's 8h of `CEBA - Sick` in Aug 2026 read as 68.5% instead of 75.3%, and
 * Jason Tutanes' 16h read as 61.4% instead of 75.0%.
 *
 * Only genuine absence belongs here. Internal Meetings, Admin, Business
 * Development and Training/Certification are all real work that happens to be
 * non-utilized — they SHOULD count against capacity, since measuring how much
 * of the working day reached client-utilized work is the point of the metric.
 *
 * Verified against the account (August 2026). To find new ones:
 *   SELECT id, entityid, companyname FROM job
 *   WHERE LOWER(companyname) LIKE '%sick%' OR LIKE '%pto%' OR LIKE '%holiday%'
 *      OR LIKE '%vacation%' OR LIKE '%leave%' OR LIKE '%bereav%'
 *
 * Kept as explicit IDs rather than a name match: the account holds a project
 * literally named "CEBA - Business Development" that a `%leave%`-style pattern
 * would never catch and a looser one would wrongly swallow, and a name match
 * would silently re-classify any project a PM renames.
 */
export const LEAVE_PROJECT_IDS = new Set<string>([
  "10252",  // 117 — CEBA - PTO
  "10253",  // 118 — CEBA - Sick
  "10254",  // 119 — CEBA - Public Holiday
  "11841",  // 166 — CEBA Leave - Bereavement
  "15855",  // 244 — CEBA - Leave - Parental Leave
  "17432",  // 371 — Loop - Sick
  "17433",  // 372 — Loop - Public Holiday
  "17434",  // 373 — Loop - PTO
]);

/** Emails that can view all PTO requests and approve/reject them */
export const PTO_APPROVER_EMAILS = [
  "zabe@cebasolutions.com",
  "rodrigo@cebasolutions.com",
];

/**
 * Email domains treated as internal (Loop Services / Loop ERP / legacy CEBA).
 * Used to strip our own people out of meeting attendee lists so only the client
 * side shows. Add new domains here rather than at the call site.
 */
export const INTERNAL_EMAIL_DOMAINS = [
  "looperp.ai",
  "loopservices.co",
  "cebasolutions.com",
];

/** True when an email belongs to a Loop-side domain. Subdomains count as internal. */
export function isInternalEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").toLowerCase().trim();
  const at = e.lastIndexOf("@");
  if (at === -1) return false;
  const domain = e.slice(at + 1);
  return INTERNAL_EMAIL_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Google Drive folder holding one subfolder per customer. Structure the meeting-doc
 * filing relies on:
 *
 *   <customer root>/ <Customer> / <Projects> / <Specific project> / …docs
 *
 * Overridable via env so a different Drive can be pointed at without a code change.
 */
export const DRIVE_CUSTOMER_ROOT_FOLDER_ID =
  process.env.GOOGLE_CUSTOMER_ROOT_FOLDER_ID || "1VjTyfM92h5U-elEyi3i4wYBSAk3txlNV";

/**
 * Folder names treated as the "projects" container inside a customer folder,
 * matched case-insensitively. First hit wins; if none match, the customer folder's
 * own subfolders are offered instead.
 */
export const DRIVE_PROJECTS_FOLDER_NAMES = ["projects", "project", "project folder", "projects folder"];

/**
 * Subfolder inside a project folder that meeting transcripts are filed into.
 * Matched case-insensitively; created if absent rather than failing the operation.
 */
export const DRIVE_TRANSCRIPT_FOLDER_NAMES = ["transcripts", "transcript", "meeting transcripts", "meetings", "call transcripts"];

/** Canonical name used when a transcripts subfolder has to be created. */
export const DRIVE_TRANSCRIPT_FOLDER_DEFAULT = "Transcripts";

/** Meeting types offered when filing a transcript; becomes the filename prefix. */
export const MEETING_TYPES = [
  "Project Management",
  "Discovery",
  "UAT",
  "Data Migration",
  "Working Session",
  "Solution Walkthroughs",
] as const;

export type MeetingType = typeof MEETING_TYPES[number];

// ─── Fixed-fee projects ───────────────────────────────────────────────────────
//
// On a fixed-fee engagement the client isn't billed per hour, so consultants log
// their time as NON-billable in NetSuite. Remaining budget is otherwise derived
// as `budget − billable hours`, which means nothing is ever consumed and the
// project reads as fully unspent no matter how much work goes into it.
// For these projects, ALL actual time (timetype='A') counts against budget.

/**
 * NetSuite job IDs treated as fixed fee. Explicit list, deliberately.
 *
 * 18403 = project 413, Salt and Stone "NS Implementation Phase 2".
 *
 * ── Why not drive this off `jobbillingtype`? ──
 * That field exists and is populated across the account (FBI = Fixed Bid,
 * Interval 99 · FBM = Fixed Bid, Milestone 37 · TM = Time & Materials 206, as of
 * August 2026), so it looks like the natural source. Two problems today:
 *
 *  1. **It's wrong where it matters.** Every currently ACTIVE project reads
 *     "TM", including 413, which is fixed fee commercially.
 *  2. **Switching it on has side effects.** Project 268 (Managed Services
 *     Agreement) carries FBI and has 910.3h of actual time against a 0h budget,
 *     so it would swing from 0.0h remaining to −910.3h — a change nobody asked
 *     for, on a project whose budget simply isn't recorded.
 *
 * The right end state is still the field: set `jobbillingtype` correctly in
 * NetSuite, confirm what it does to 268, then switch this to
 * `FIXED_FEE_BILLING_TYPES.has(jobBillingType)` and empty this list.
 */
export const FIXED_FEE_PROJECT_IDS = new Set([18403]);

/** Does this project count all actual time against budget, rather than billable only? */
export function isFixedFeeProject(projectId: number, _jobBillingType?: string | null): boolean {
  return FIXED_FEE_PROJECT_IDS.has(projectId);
}

export const NS_BASE_URL = "https://system.na1.netsuite.com";

export function nsProjectUrl(id: number) {
  return `${NS_BASE_URL}/app/accounting/project/project.nl?id=${id}`;
}
