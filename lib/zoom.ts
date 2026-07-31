// ─── Zoom integration ─────────────────────────────────────────────────────────
//
// Server-to-Server OAuth. Zoom retired JWT apps in September 2023, and the
// user-authorized OAuth flow would need every host to consent individually —
// S2S gives account-level access from three env vars with no user interaction.
//
// Required env vars (create the app at marketplace.zoom.us → Develop → Build App
// → Server-to-Server OAuth):
//   ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
//
// Required scopes on that app:
//   user:read:admin            (list account users)
//   report:read:admin          (past meeting reports)
//   recording:read:admin       (cloud recordings + transcripts)
//   meeting_summary:read:admin (AI Companion meeting summaries / "Zoom Notes")
// Granular-scope equivalents, if the app was created after Zoom's scope split:
//   user:read:list_users:admin
//   report:read:list_user_meetings:admin
//   cloud_recording:read:list_recording_files:admin
//   meeting_summary:read:summary:admin

const ZOOM_OAUTH = "https://zoom.us/oauth/token";
const ZOOM_API   = "https://api.zoom.us/v2";

export interface ZoomMeeting {
  uuid:             string;
  meetingId:        number;
  topic:            string;
  hostId:           string;
  hostName:         string;
  hostEmail:        string;
  startTime:        string;        // ISO
  endTime:          string | null; // ISO
  durationMinutes:  number;
  participantCount: number;
}

export interface ZoomUser {
  id:        string;
  email:     string;
  firstName: string;
  lastName:  string;
  name:      string;
}

/** Thrown with a message that says what to fix, not just Zoom's raw code. */
export class ZoomError extends Error {
  constructor(message: string, readonly code?: string | number, readonly status?: number) {
    super(message);
    this.name = "ZoomError";
  }
}

// ─── Token ────────────────────────────────────────────────────────────────────

// Module-level cache. Tokens last an hour, so a warm serverless instance reuses
// one rather than re-authenticating on every request.
let cachedToken: { token: string; expiresAt: number } | null = null;

export function zoomConfigured(): boolean {
  return !!(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}

async function getZoomToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const accountId    = process.env.ZOOM_ACCOUNT_ID;
  const clientId     = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new ZoomError(
      "Zoom is not configured. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET in Vercel (and redeploy — Vercel does not pick up new env vars on an existing deployment).",
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${ZOOM_OAUTH}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method:  "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const reason = body.reason ?? body.error ?? `HTTP ${res.status}`;
    throw new ZoomError(
      res.status === 401 || res.status === 400
        ? `Zoom rejected the credentials (${reason}). Check ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET match the Server-to-Server OAuth app, and that the app is activated.`
        : `Zoom token request failed: ${reason}`,
      body.error, res.status,
    );
  }

  cachedToken = {
    token:     body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

// ─── Request helper ───────────────────────────────────────────────────────────

/**
 * Zoom names the exact scopes it wanted in the error text, e.g.
 *   "Invalid access token, does not contain scopes:[report:read:user:admin]"
 * Always prefer those over a guess: classic and granular scope names differ per
 * app, so hardcoding one ("report:read:admin") can tell the reader to add a scope
 * their app doesn't even use.
 */
function missingScopesFrom(message: string): string[] {
  const m = message.match(/scopes\s*:\s*\[([^\]]+)\]/i);
  if (!m) return [];
  return m[1].split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

const isScopeProblem = (message: string) => /scopes\s*:\s*\[/i.test(message) || /does not contain scope/i.test(message);

/** Zoom error codes worth translating into an actual remedy. */
function explainZoomError(code: number | undefined, status: number, message: string, path: string): string {
  const scopes = missingScopesFrom(message);

  if (scopes.length > 0 || isScopeProblem(message)) {
    const want = scopes.length
      ? scopes.map(s => `\`${s}\``).join(" and ")
      : path.startsWith("/report") ? "a report read scope" : "the relevant admin scope";
    return (
      `The Zoom app is missing ${want}. In the Zoom Marketplace open your Server-to-Server OAuth app → Scopes → Add Scopes, ` +
      `add ${scopes.length ? "it" : "the scope"}, then Save/Continue. Reports also need a Pro plan or above. ` +
      `You do not need to redeploy — retry here and a fresh token with the new scope is requested automatically. (Zoom: ${message})`
    );
  }
  if (status === 401) {
    return `Zoom rejected the access token. Re-check ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET, and that the app is activated. (Zoom: ${message})`;
  }
  if (status === 403) {
    return `Zoom denied access to ${path}. Check the app's scopes and that the account plan includes this endpoint. (Zoom: ${message})`;
  }
  if (/plan|subscription/i.test(message)) {
    return `This Zoom endpoint isn't available on the account's plan. Meeting reports require Pro or above. (Zoom: ${message})`;
  }
  if (status === 429) {
    return "Zoom rate limit reached. Report endpoints are rate limited, and daily-capped on lower plans — try a shorter date range or wait a few minutes.";
  }
  return `Zoom API error on ${path}: ${message}${code ? ` (code ${code})` : ""}`;
}

async function zoomGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const token = await getZoomToken();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `${ZOOM_API}${path}${qs.toString() ? `?${qs}` : ""}`;

  const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = body.message ?? `HTTP ${res.status}`;
    // Scopes are baked into the token at issue time. After scopes are added in the
    // Zoom Marketplace the cached token still lacks them, so without dropping it a
    // correct fix would appear not to work for up to an hour.
    if (res.status === 401 || res.status === 403 || isScopeProblem(message)) {
      cachedToken = null;
    }
    throw new ZoomError(explainZoomError(body.code, res.status, message, path), body.code, res.status);
  }
  return body as T;
}

// ─── Users ────────────────────────────────────────────────────────────────────

interface ZoomUsersPage {
  users: Array<{ id: string; email: string; first_name?: string; last_name?: string; display_name?: string }>;
  next_page_token?: string;
}

export async function listZoomUsers(): Promise<ZoomUser[]> {
  const out: ZoomUser[] = [];
  let token: string | undefined;
  let guard = 0;

  do {
    const page = await zoomGet<ZoomUsersPage>("/users", {
      status: "active", page_size: 300, next_page_token: token,
    });
    for (const u of page.users ?? []) {
      const name = u.display_name?.trim() || `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email;
      out.push({ id: u.id, email: u.email, firstName: u.first_name ?? "", lastName: u.last_name ?? "", name });
    }
    token = page.next_page_token || undefined;
  } while (token && ++guard < 20);

  return out;
}

// ─── Past meetings ────────────────────────────────────────────────────────────

interface ZoomReportPage {
  meetings: Array<{
    uuid: string; id: number; topic?: string; host_id?: string;
    user_name?: string; user_email?: string;
    start_time?: string; end_time?: string;
    duration?: number; participants_count?: number;
  }>;
  next_page_token?: string;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Zoom's report endpoints reject ranges longer than one month, so split the
 * requested window into month-sized chunks.
 */
export function monthChunks(from: Date, to: Date): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  let guard = 0;

  while (cursor <= end && guard++ < 120) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + 29);   // 30-day window, inside Zoom's limit
    chunks.push({ from: iso(cursor), to: iso(chunkEnd < end ? chunkEnd : end) });
    cursor.setDate(cursor.getDate() + 30);
  }
  return chunks;
}

async function listPastMeetingsForUser(user: ZoomUser, from: string, to: string): Promise<ZoomMeeting[]> {
  const out: ZoomMeeting[] = [];
  let token: string | undefined;
  let guard = 0;

  do {
    const page = await zoomGet<ZoomReportPage>(`/report/users/${encodeURIComponent(user.id)}/meetings`, {
      from, to, page_size: 300, type: "past", next_page_token: token,
    });
    for (const m of page.meetings ?? []) {
      out.push({
        uuid:             m.uuid,
        meetingId:        m.id,
        topic:            m.topic?.trim() || "(No topic)",
        hostId:           m.host_id ?? user.id,
        hostName:         m.user_name?.trim() || user.name,
        hostEmail:        m.user_email || user.email,
        startTime:        m.start_time ?? "",
        endTime:          m.end_time ?? null,
        durationMinutes:  m.duration ?? 0,
        participantCount: m.participants_count ?? 0,
      });
    }
    token = page.next_page_token || undefined;
  } while (token && ++guard < 20);

  return out;
}

/** Run tasks with bounded concurrency — Zoom report endpoints are heavily rate limited. */
async function pooled<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<Array<R | Error>> {
  const results: Array<R | Error> = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i]); }
      catch (e) { results[i] = e instanceof Error ? e : new Error(String(e)); }
    }
  });
  await Promise.all(workers);
  return results;
}

export interface FetchMeetingsResult {
  meetings: ZoomMeeting[];
  hosts:    ZoomUser[];
  /** Non-fatal per-host failures — one host erroring shouldn't blank the whole tab. */
  warnings: string[];
}

/**
 * All past meetings hosted by any active account user in [from, to].
 *
 * Zoom has no account-wide past-meeting report, so this fans out per host. The
 * Dashboard API (/metrics/meetings) would do it in one call but requires a
 * Business plan, whereas the report endpoint works on Pro.
 */
export async function fetchPastMeetings(from: Date, to: Date): Promise<FetchMeetingsResult> {
  const hosts  = await listZoomUsers();
  const chunks = monthChunks(from, to);
  const warnings: string[] = [];

  const jobs = hosts.flatMap(h => chunks.map(c => ({ host: h, ...c })));
  const results = await pooled(jobs, 4, j => listPastMeetingsForUser(j.host, j.from, j.to));

  const byUuid = new Map<string, ZoomMeeting>();
  results.forEach((r, i) => {
    if (r instanceof Error) {
      const j = jobs[i];
      warnings.push(`${j.host.name} (${j.from} → ${j.to}): ${r.message}`);
      return;
    }
    // A recurring meeting can appear in overlapping chunks — uuid is the instance key.
    for (const m of r) byUuid.set(m.uuid, m);
  });

  const meetings = [...byUuid.values()].sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""));
  return { meetings, hosts, warnings: [...new Set(warnings)] };
}

// ─── Transcripts ──────────────────────────────────────────────────────────────

export interface ZoomRecordingFile {
  id:            string;
  fileType:      string;   // "TRANSCRIPT" | "CC" | "MP4" | "M4A" | "CHAT" | "TIMELINE" | …
  fileExtension: string;
  downloadUrl:   string;
  recordingStart: string;
  recordingEnd:   string;
  fileSize:      number;
  status:         string;
}

export interface ZoomTranscriptCue {
  index:   number;
  start:   string;   // "00:01:23.456"
  end:     string;
  seconds: number;   // start, in seconds — for sorting/seek links
  speaker: string;   // "" when the line has no speaker prefix
  text:    string;
}

/**
 * Zoom meeting UUIDs are base64 and can contain `/` and `+`. Zoom's own rule: if a
 * UUID starts with `/` or contains `//`, it must be DOUBLE url-encoded in a path.
 * Getting this wrong is the classic Zoom 404 — the request silently addresses a
 * different (or no) meeting.
 */
export function encodeMeetingUuid(uuid: string): string {
  const once = encodeURIComponent(uuid);
  return uuid.startsWith("/") || uuid.includes("//") ? encodeURIComponent(once) : once;
}

/** Both candidate encodings, most-likely first, deduped. */
export function meetingUuidCandidates(uuid: string): string[] {
  const once = encodeURIComponent(uuid);
  const twice = encodeURIComponent(once);
  const preferred = encodeMeetingUuid(uuid);
  const other = preferred === once ? twice : once;
  return preferred === other ? [preferred] : [preferred, other];
}

/**
 * GET a meeting-scoped endpoint, trying both UUID encodings.
 *
 * Zoom documents double-encoding only for UUIDs starting with `/` or containing
 * `//`, but that rule doesn't hold universally — a UUID with a single `/` or a `+`
 * can 404 under one encoding and resolve under the other. Trying both removes a
 * whole class of "the meeting exists in the portal but the API says 404".
 *
 * Throws the LAST error if every encoding fails, so the caller still sees a real
 * Zoom message rather than a synthesised one.
 */
async function zoomGetByMeeting<T>(buildPath: (encoded: string) => string, uuid: string): Promise<T> {
  const candidates = meetingUuidCandidates(uuid);
  let lastError: unknown;

  for (const encoded of candidates) {
    try {
      return await zoomGet<T>(buildPath(encoded));
    } catch (e) {
      lastError = e;
      // Only an addressing failure is worth retrying under a different encoding.
      const retryable = e instanceof ZoomError && (e.status === 404 || e.status === 400);
      if (!retryable) throw e;
    }
  }
  throw lastError;
}

interface ZoomRecordingsResponse {
  uuid?: string;
  id?: number;
  topic?: string;
  start_time?: string;
  duration?: number;
  share_url?: string;
  recording_files?: Array<{
    id?: string; file_type?: string; file_extension?: string; download_url?: string;
    recording_start?: string; recording_end?: string; file_size?: number; status?: string;
  }>;
}

/** "00:01:23.456" → 83.456 */
function vttTimeToSeconds(t: string): number {
  const parts = t.trim().split(":");
  if (parts.length < 2) return 0;
  const secs = parseFloat(parts.pop() ?? "0") || 0;
  const mins = parseInt(parts.pop() ?? "0") || 0;
  const hrs  = parseInt(parts.pop() ?? "0") || 0;
  return hrs * 3600 + mins * 60 + secs;
}

// A speaker prefix looks like "Jane Smith: text". Bounded and newline-free so a
// sentence that merely contains a colon isn't mistaken for an attribution.
const SPEAKER_RE = /^([^:\n]{1,60}?):\s+(.*)$/;

/** Parse a Zoom transcript VTT into speaker-attributed cues. */
export function parseVtt(vtt: string): ZoomTranscriptCue[] {
  const cues: ZoomTranscriptCue[] = [];
  // Strip BOMs and normalise every line-ending form to \n before splitting on blank
  // lines. `\r\n?` matters: handling only CRLF leaves a lone \r embedded mid-block,
  // which swallows that cue's text and silently drops the cue.
  const blocks = vtt
    .replace(/﻿/g, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (/^WEBVTT/i.test(lines[0]) || /^NOTE\b/i.test(lines[0])) continue;

    const timingIdx = lines.findIndex(l => l.includes("-->"));
    if (timingIdx === -1) continue;

    const [rawStart, rawEnd] = lines[timingIdx].split("-->").map(s => s.trim());
    if (!rawStart || !rawEnd) continue;
    // Trailing cue settings (e.g. "align:start position:0%") aren't part of the time.
    const end = rawEnd.split(/\s+/)[0];

    const body = lines.slice(timingIdx + 1).join(" ").trim();
    if (!body) continue;

    const m = body.match(SPEAKER_RE);
    cues.push({
      index:   cues.length + 1,
      start:   rawStart,
      end,
      seconds: vttTimeToSeconds(rawStart),
      speaker: m ? m[1].trim() : "",
      text:    m ? m[2].trim() : body,
    });
  }
  return cues;
}

/** Cloud recording files for a specific meeting instance. */
export async function listMeetingRecordings(uuid: string): Promise<ZoomRecordingsResponse> {
  return zoomGetByMeeting<ZoomRecordingsResponse>(e => `/meetings/${e}/recordings`, uuid);
}

/**
 * Download a recording file. `download_url` needs the same bearer token — it is
 * fetched server-side so the token is never handed to the browser.
 */
async function downloadRecordingFile(downloadUrl: string): Promise<string> {
  const token = await getZoomToken();
  const res = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new ZoomError(`Could not download the transcript from Zoom (HTTP ${res.status}).`, undefined, res.status);
  }
  return res.text();
}

export interface TranscriptResult {
  available: boolean;
  reason?:   string;
  topic?:    string;
  startTime?: string;
  duration?:  number;
  shareUrl?:  string;
  cues:      ZoomTranscriptCue[];
  /** Raw VTT, so the UI can offer the original file as a download. */
  vtt?:      string;
  /** Other recording assets present, useful context when there's no transcript. */
  otherFiles: ZoomRecordingFile[];
}

/**
 * Transcript for one meeting instance.
 *
 * Returns `available: false` with a reason rather than throwing when the meeting
 * simply wasn't recorded — that's an ordinary outcome, not an error. Genuine auth
 * and scope failures still throw so they surface as such.
 */
export async function fetchMeetingTranscript(uuid: string): Promise<TranscriptResult> {
  let rec: ZoomRecordingsResponse;
  try {
    rec = await listMeetingRecordings(uuid);
  } catch (e) {
    // 3301 / 404 = nothing recorded for this meeting.
    if (e instanceof ZoomError && (e.code === 3301 || e.status === 404)) {
      return { available: false, reason: "This meeting has no cloud recording, so Zoom has no transcript for it.", cues: [], otherFiles: [] };
    }
    throw e;
  }

  const files: ZoomRecordingFile[] = (rec.recording_files ?? []).map(f => ({
    id:             f.id ?? "",
    fileType:       (f.file_type ?? "").toUpperCase(),
    fileExtension:  (f.file_extension ?? "").toUpperCase(),
    downloadUrl:    f.download_url ?? "",
    recordingStart: f.recording_start ?? "",
    recordingEnd:   f.recording_end ?? "",
    fileSize:       f.file_size ?? 0,
    status:         f.status ?? "",
  }));

  // Zoom exposes the audio transcript as TRANSCRIPT; CC is the live closed-caption
  // file and is a reasonable fallback when audio transcription wasn't enabled.
  const transcriptFile =
    files.find(f => f.fileType === "TRANSCRIPT" && f.downloadUrl) ??
    files.find(f => f.fileType === "CC" && f.downloadUrl);

  const meta = {
    topic:     rec.topic,
    startTime: rec.start_time,
    duration:  rec.duration,
    shareUrl:  rec.share_url,
    otherFiles: files.filter(f => f !== transcriptFile),
  };

  if (!transcriptFile) {
    return {
      available: false,
      reason: files.length
        ? "This meeting was recorded but has no transcript file. Turn on Settings → Recording → Cloud recording → “Create audio transcript” in Zoom; it only applies to recordings made after it's enabled."
        : "This meeting has no cloud recording, so Zoom has no transcript for it.",
      cues: [], ...meta,
    };
  }

  const vtt  = await downloadRecordingFile(transcriptFile.downloadUrl);
  const cues = parseVtt(vtt);

  return {
    available: cues.length > 0,
    reason: cues.length === 0 ? "Zoom returned a transcript file, but it contained no readable cues." : undefined,
    cues, vtt, ...meta,
  };
}

// ─── AI Companion meeting summary ("Zoom Notes") ──────────────────────────────

export interface SummarySection { label: string; summary: string }

export interface MeetingSummary {
  available:       boolean;
  reason?:         string;
  title?:          string;
  overview?:       string;
  sections:        SummarySection[];
  nextSteps:       string[];
  /** True when someone edited Zoom's generated summary — we then show theirs. */
  edited:          boolean;
  createdAt?:      string;
  lastModifiedAt?: string;
  topic?:          string;
  startTime?:      string;
  endTime?:        string;
  hostEmail?:      string;
}

interface ZoomSummaryResponse {
  meeting_topic?: string;
  meeting_start_time?: string;
  meeting_end_time?: string;
  meeting_host_email?: string;
  summary_title?: string;
  summary_overview?: string;
  summary_details?: Array<{ label?: string; summary?: string }> | string;
  next_steps?: string[];
  summary_created_time?: string;
  summary_last_modified_time?: string;
  /** Present when a human edited the summary. Zoom returns details as a STRING here. */
  edited_summary?: { summary_details?: string; next_steps?: string[] };
}

/** Zoom returns summary_details as an array of sections, or a plain string when edited. */
export function normalizeSections(details: ZoomSummaryResponse["summary_details"]): SummarySection[] {
  if (!details) return [];
  if (typeof details === "string") {
    return details.trim() ? [{ label: "", summary: details.trim() }] : [];
  }
  return details
    .map(d => ({ label: (d.label ?? "").trim(), summary: (d.summary ?? "").trim() }))
    .filter(d => d.summary || d.label);
}

export interface SummaryListEntry {
  meetingUuid: string;
  meetingId:   number;
  topic:       string;
  startTime:   string;
  hostEmail:   string;
}

/**
 * All AI Companion summaries for a host in a date range.
 *
 * Doesn't need a UUID, so it sidesteps meeting-addressing problems entirely and is
 * the reliable way to answer "which meetings actually have notes". Granular scope:
 * meeting_summary:read:list_summaries:admin (classic: meeting_summary:read:admin).
 */
export async function listUserMeetingSummaries(userId: string, from: string, to: string): Promise<SummaryListEntry[]> {
  interface Page {
    summaries?: Array<{ meeting_uuid?: string; meeting_id?: number; meeting_topic?: string; meeting_start_time?: string; meeting_host_email?: string }>;
    next_page_token?: string;
  }
  const out: SummaryListEntry[] = [];
  let token: string | undefined;
  let guard = 0;

  do {
    const page = await zoomGet<Page>(`/users/${encodeURIComponent(userId)}/meeting_summaries`, {
      from, to, page_size: 300, next_page_token: token,
    });
    for (const s of page.summaries ?? []) {
      out.push({
        meetingUuid: s.meeting_uuid ?? "",
        meetingId:   s.meeting_id ?? 0,
        topic:       s.meeting_topic ?? "",
        startTime:   s.meeting_start_time ?? "",
        hostEmail:   s.meeting_host_email ?? "",
      });
    }
    token = page.next_page_token || undefined;
  } while (token && ++guard < 20);

  return out;
}

/**
 * AI Companion summary for one meeting instance.
 *
 * Returns `available: false` with a reason when the meeting has no summary — the
 * ordinary case when AI Companion wasn't on. Only auth/scope/plan errors throw.
 */
export async function fetchMeetingSummary(uuid: string): Promise<MeetingSummary> {
  let raw: ZoomSummaryResponse;
  try {
    raw = await zoomGetByMeeting<ZoomSummaryResponse>(e => `/meetings/${e}/meeting_summary`, uuid);
  } catch (e) {
    if (e instanceof ZoomError && (e.status === 404 || e.code === 3001)) {
      // 404 here is ambiguous: no summary for this meeting, OR Zoom couldn't resolve
      // the meeting at all. Say so rather than asserting "no notes exist" — that
      // wording sent a real addressing bug looking like a Zoom settings problem.
      return {
        available: false,
        reason:
          "Zoom returned no summary for this meeting (404). That usually means AI Companion's Meeting Summary wasn't on for it — but it is also what Zoom returns when it can't resolve the meeting, so if you can see notes for this meeting in the Zoom portal, run /api/debug/zoom-meeting?uuid=… to see the raw lookup.",
        sections: [], nextSteps: [], edited: false,
      };
    }
    throw e;
  }

  const edited = !!(raw.edited_summary && (raw.edited_summary.summary_details || raw.edited_summary.next_steps?.length));

  // Prefer a human-edited summary over Zoom's original — someone corrected it for a reason.
  const sections  = edited ? normalizeSections(raw.edited_summary!.summary_details) : normalizeSections(raw.summary_details);
  const nextSteps = ((edited ? raw.edited_summary!.next_steps : raw.next_steps) ?? [])
    .map(s => (s ?? "").trim())
    .filter(Boolean);

  const overview = (raw.summary_overview ?? "").trim();
  const hasBody  = !!overview || sections.length > 0 || nextSteps.length > 0;

  return {
    available: hasBody,
    reason: hasBody ? undefined : "Zoom returned a summary record for this meeting, but it had no content.",
    title:          (raw.summary_title ?? "").trim() || undefined,
    overview:       overview || undefined,
    sections,
    nextSteps,
    edited,
    createdAt:      raw.summary_created_time,
    lastModifiedAt: raw.summary_last_modified_time,
    topic:          raw.meeting_topic,
    startTime:      raw.meeting_start_time,
    endTime:        raw.meeting_end_time,
    hostEmail:      raw.meeting_host_email,
  };
}
