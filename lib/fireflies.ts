// ─── Fireflies.ai integration ─────────────────────────────────────────────────
//
// GraphQL, one API key. Set FIREFLIES_API_KEY in Vercel (Fireflies → Settings →
// Developer Settings → API key) and redeploy.
//
// Rate limits: Free 50 req/day · Pro 500 req/day · Business/Enterprise 60 req/min.
// A list load costs one request per page of 50 transcripts, so keep pagination
// bounded and don't auto-refetch.

import { isInternalEmail } from "./constants";

const FIREFLIES_API = "https://api.fireflies.ai/graphql";

export class FirefliesError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FirefliesError";
  }
}

export function firefliesConfigured(): boolean {
  return !!process.env.FIREFLIES_API_KEY;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FirefliesAttendee {
  name:     string;
  email:    string;
  internal: boolean;
}

export interface FirefliesSummary {
  overview?:     string;
  shortSummary?: string;
  actionItems:   string[];
  keywords:      string[];
  bulletGist:    string[];
}

export interface FirefliesMeeting {
  id:              string;
  title:           string;
  date:            string;        // ISO
  durationMinutes: number;        // Fireflies returns SECONDS; converted here
  organizerEmail:  string;
  meetingLink:     string | null;
  transcriptUrl:   string | null;
  attendees:       FirefliesAttendee[];
  external:        FirefliesAttendee[];
  internalCount:   number;
  summary:         FirefliesSummary | null;
  hasSummary:      boolean;
}

export interface FirefliesSentence {
  index:   number;
  text:    string;
  speaker: string;
}

// ─── Request ──────────────────────────────────────────────────────────────────

interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) {
    throw new FirefliesError(
      "Fireflies is not connected. Add FIREFLIES_API_KEY in Vercel (Fireflies → Settings → Developer Settings → API key), then redeploy — Vercel does not pick up new env vars on an existing deployment.",
    );
  }

  const res = await fetch(FIREFLIES_API, {
    method:  "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ query, variables }),
  });

  const body = (await res.json().catch(() => ({}))) as GqlResponse<T>;

  if (res.status === 401 || res.status === 403) {
    throw new FirefliesError("Fireflies rejected the API key. Regenerate it in Fireflies → Settings → Developer Settings and update FIREFLIES_API_KEY in Vercel.", res.status);
  }
  if (res.status === 429) {
    throw new FirefliesError("Fireflies rate limit reached. Free plans allow 50 requests/day and Pro 500/day — try a narrower date range, or wait.", 429);
  }
  if (body.errors?.length) {
    throw new FirefliesError(`Fireflies GraphQL error: ${body.errors.map(e => e.message ?? "unknown").join("; ")}`, res.status);
  }
  if (!res.ok) {
    throw new FirefliesError(`Fireflies request failed (HTTP ${res.status}).`, res.status);
  }
  if (!body.data) {
    throw new FirefliesError("Fireflies returned no data.", res.status);
  }
  return body.data;
}

/** A GraphQL error naming an unknown field, rather than an auth/limit problem. */
function isFieldError(e: unknown): boolean {
  if (!(e instanceof FirefliesError)) return false;
  return /GraphQL error/i.test(e.message) &&
    /(cannot query field|unknown field|unknown argument|did you mean|field .* doesn't exist)/i.test(e.message);
}

// ─── Field tiers ──────────────────────────────────────────────────────────────
//
// Fireflies' schema varies by plan and version, and one unknown field fails the
// whole query. Try richest first and drop the least-essential block on a field
// error, so a schema difference degrades the result instead of breaking the tab.

const CORE_FIELDS = `
  id
  title
  date
  duration
  organizer_email
  participants
`;

const TIERS: Array<{ label: string; fields: string }> = [
  {
    label: "full",
    fields: `${CORE_FIELDS}
      meeting_link
      transcript_url
      summary { overview short_summary action_items keywords bullet_gist }
    `,
  },
  {
    label: "no-bullet-gist",
    fields: `${CORE_FIELDS}
      meeting_link
      transcript_url
      summary { overview action_items keywords }
    `,
  },
  {
    label: "no-summary",
    fields: `${CORE_FIELDS}
      meeting_link
      transcript_url
    `,
  },
  { label: "core", fields: CORE_FIELDS },
];

// ─── Normalising ──────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Fireflies types `date` as a Float — epoch milliseconds — but returns an ISO
 * string on some plans/schema versions. `str()` silently yields "" for the
 * numeric form, which reaches `meetingDocName()` as an invalid Date and files
 * documents named "… - undated" (and blanks the grid's Started column).
 *
 * `duration` already had the number-aware treatment; `date` did not.
 * Accepts: ISO string, epoch-ms number, epoch-seconds number, numeric string.
 */
function isoDate(v: unknown): string {
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return "";
    // A numeric string is an epoch, not something Date can parse meaningfully.
    if (/^\d+$/.test(trimmed)) return isoDate(Number(trimmed));
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (typeof v === "number" && isFinite(v) && v > 0) {
    // Fireflies has used both. Seconds-since-epoch for any plausible meeting
    // date is < 1e11; milliseconds is ~1.7e12.
    const ms = v < 1e11 ? v * 1000 : v;
    const d  = new Date(ms);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(x => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];

/**
 * `participants` is documented as an array; in practice it can be plain email
 * strings or objects. Handle both, and fall back to meeting_attendees if present.
 */
function normalizeAttendees(raw: unknown): FirefliesAttendee[] {
  const out = new Map<string, FirefliesAttendee>();
  for (const p of Array.isArray(raw) ? raw : []) {
    let email = "", name = "";
    if (typeof p === "string") {
      email = p.trim();
    } else if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      email = str(o.email ?? o.email_address).trim();
      name  = str(o.displayName ?? o.name).trim();
    }
    const key = (email || name).toLowerCase();
    if (!key) continue;
    out.set(key, { name: name || email, email: email.toLowerCase(), internal: isInternalEmail(email) });
  }
  return [...out.values()];
}

function normalizeSummary(raw: unknown): FirefliesSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // action_items sometimes arrives as one newline-delimited string rather than a list.
  const actionItems = Array.isArray(o.action_items)
    ? strList(o.action_items)
    : str(o.action_items).split(/\n+/).map(s => s.replace(/^[-*•\s]+/, "").trim()).filter(Boolean);

  const summary: FirefliesSummary = {
    overview:     str(o.overview) || undefined,
    shortSummary: str(o.short_summary) || undefined,
    actionItems,
    keywords:     strList(o.keywords),
    bulletGist:   Array.isArray(o.bullet_gist)
                    ? strList(o.bullet_gist)
                    : str(o.bullet_gist).split(/\n+/).map(s => s.replace(/^[-*•\s]+/, "").trim()).filter(Boolean),
  };
  const empty = !summary.overview && !summary.shortSummary &&
    summary.actionItems.length === 0 && summary.keywords.length === 0 && summary.bulletGist.length === 0;
  return empty ? null : summary;
}

function normalizeMeeting(raw: Record<string, unknown>): FirefliesMeeting {
  const attendees = normalizeAttendees(raw.participants ?? raw.meeting_attendees);
  const external  = attendees.filter(a => !a.internal);
  const summary   = normalizeSummary(raw.summary);

  // Fireflies `duration` is seconds.
  const seconds = typeof raw.duration === "number" ? raw.duration : parseFloat(str(raw.duration)) || 0;

  return {
    id:              str(raw.id),
    title:           str(raw.title).trim() || "(No title)",
    date:            isoDate(raw.date),
    durationMinutes: Math.round((seconds / 60) * 10) / 10,
    organizerEmail:  str(raw.organizer_email).toLowerCase(),
    meetingLink:     str(raw.meeting_link) || null,
    transcriptUrl:   str(raw.transcript_url) || null,
    attendees,
    external,
    internalCount:   attendees.length - external.length,
    summary,
    hasSummary:      summary !== null,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const PAGE_SIZE  = 50;
/** Bounded so a wide range can't quietly burn a day's rate limit. */
const MAX_PAGES  = 10;

export interface FetchFirefliesResult {
  meetings:  FirefliesMeeting[];
  truncated: boolean;
  /** Which field tier actually succeeded — surfaced so schema drops are visible. */
  tier:      string;
  notes:     string[];
}

/**
 * All Fireflies transcripts in [fromDate, toDate], newest first.
 *
 * `fromDate`/`toDate` are ISO 8601 instants, so the caller converts local dates to
 * UTC — no repeat of the Zoom GMT-vs-local range bug.
 */
export async function fetchFirefliesMeetings(fromISO: string, toISO: string): Promise<FetchFirefliesResult> {
  const notes: string[] = [];

  for (let t = 0; t < TIERS.length; t++) {
    const tier = TIERS[t];
    const query = `
      query DashboardTranscripts($fromDate: DateTime, $toDate: DateTime, $limit: Int, $skip: Int) {
        transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip) {
          ${tier.fields}
        }
      }`;

    try {
      const all: FirefliesMeeting[] = [];
      let truncated = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await gql<{ transcripts?: Array<Record<string, unknown>> }>(query, {
          fromDate: fromISO, toDate: toISO, limit: PAGE_SIZE, skip: page * PAGE_SIZE,
        });
        const rows = data.transcripts ?? [];
        all.push(...rows.map(normalizeMeeting));

        if (rows.length < PAGE_SIZE) break;
        if (page === MAX_PAGES - 1) truncated = true;
      }

      if (t > 0) {
        notes.push(`Fireflies rejected some fields, so this used the "${tier.label}" field set — summaries or links may be missing.`);
      }
      if (truncated) {
        notes.push(`Showing the first ${MAX_PAGES * PAGE_SIZE} meetings; narrow the date range to see older ones.`);
      }

      // Dedupe on id and sort newest first.
      const byId = new Map(all.map(m => [m.id, m]));
      const meetings = [...byId.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      return { meetings, truncated, tier: tier.label, notes };
    } catch (e) {
      // Only a schema mismatch is worth retrying with fewer fields.
      if (isFieldError(e) && t < TIERS.length - 1) continue;
      throw e;
    }
  }

  throw new FirefliesError("Could not build a Fireflies query this account accepts.");
}

/** Full transcript text for one meeting. Fetched on demand — sentences are large. */
export async function fetchFirefliesTranscript(id: string): Promise<FirefliesSentence[]> {
  const attempts = [
    `query T($id: String!) { transcript(id: $id) { sentences { index text speaker_name } } }`,
    `query T($id: String!) { transcript(id: $id) { sentences { index text speaker } } }`,
    `query T($id: String!) { transcript(id: $id) { sentences { text speaker_name } } }`,
  ];

  let lastError: unknown;
  for (const query of attempts) {
    try {
      const data = await gql<{ transcript?: { sentences?: Array<Record<string, unknown>> } }>(query, { id });
      const rows = data.transcript?.sentences ?? [];
      return rows.map((s, i) => ({
        index:   typeof s.index === "number" ? s.index : i + 1,
        text:    str(s.text).trim(),
        speaker: (str(s.speaker_name) || str(s.speaker)).trim(),
      })).filter(s => s.text);
    } catch (e) {
      lastError = e;
      if (!isFieldError(e)) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new FirefliesError("Could not read the transcript.");
}
