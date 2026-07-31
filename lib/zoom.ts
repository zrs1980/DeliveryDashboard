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
//   user:read:admin     (list account users)
//   report:read:admin   (past meeting reports)
// Granular-scope equivalents, if the app was created after Zoom's scope split:
//   user:read:list_users:admin
//   report:read:list_report_meetings:admin

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

/** Zoom error codes worth translating into an actual remedy. */
function explainZoomError(code: number | undefined, status: number, message: string, path: string): string {
  if (status === 401) {
    return "Zoom rejected the access token. Re-check the Server-to-Server OAuth credentials, then redeploy.";
  }
  if (code === 4711 || code === 4700 || status === 403) {
    const scope = path.startsWith("/report") ? "report:read:admin" : path.startsWith("/users") ? "user:read:admin" : "the relevant admin scope";
    return `Zoom denied access to ${path}. The Server-to-Server OAuth app is missing ${scope} — add it in the Zoom Marketplace app config, then save and retry. (Zoom: ${message})`;
  }
  if (code === 200 && /plan/i.test(message)) {
    return `This Zoom endpoint needs a paid plan. Meeting reports require Pro or above. (Zoom: ${message})`;
  }
  if (status === 429) {
    return "Zoom rate limit reached. Report endpoints are rate limited per day on lower plans — try a shorter date range or wait a few minutes.";
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
    throw new ZoomError(
      explainZoomError(body.code, res.status, body.message ?? `HTTP ${res.status}`, path),
      body.code, res.status,
    );
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
