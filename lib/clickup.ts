import type { CUTask } from "./types";

const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const BASE_URL  = "https://api.clickup.com/api/v2";

function headers() {
  return {
    Authorization: API_TOKEN,
    "Content-Type": "application/json",
  };
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

/**
 * Extract a raw ID from a ClickUp URL.
 * - /v/li/{listId}/{viewId}  → returns { type: "list", id }   (first number IS the list)
 * - /v/l/{hash}-{viewId}     → returns { type: "view", id }   (need view API to resolve)
 * - /v/l/{listId}            → returns { type: "list", id }
 */
function parseClickUpUrl(url: string | null): { type: "list" | "view"; id: string } | null {
  if (!url) return null;
  const clean = url.split("?")[0];

  // /v/li/{listId}/{viewId} — first number is the list ID
  const liMatch = clean.match(/\/v\/li\/(\d+)\/\d+/i);
  if (liMatch) return { type: "list", id: liMatch[1] };

  // /v/l/{hash}-{viewId} — this whole segment is the VIEW id, not a list id.
  // The hash is NOT a separable prefix: GET /view/182ddq-334693 resolves, while
  // GET /view/334693 (the numeric tail alone) 404s. Verified against Salt & Stone.
  const lHyphenMatch = clean.match(/\/v\/l\/([a-z0-9]+-\d+)/i);
  if (lHyphenMatch) return { type: "view", id: lHyphenMatch[1] };

  // /v/l/{numericListId} — plain list id
  const lNumericMatch = clean.match(/\/v\/l\/(\d+)/i);
  if (lNumericMatch) return { type: "list", id: lNumericMatch[1] };

  // Fallback: last path segment
  const segments = clean.replace(/\/$/, "").split("/");
  const last = segments[segments.length - 1];
  return last ? { type: "list", id: last } : null;
}

/**
 * Resolve a ClickUp URL to its API list ID.
 * For view-style URLs (/v/l/hash-viewId), calls the view API to get the parent list.
 */
export async function resolveClickUpListId(url: string | null): Promise<string | null> {
  const parsed = parseClickUpUrl(url);
  if (!parsed) return null;

  if (parsed.type === "list") return parsed.id;

  // View URL — resolve via API
  try {
    const res = await fetch(`${BASE_URL}/view/${parsed.id}`, { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    // The view's parent list id is at data.view.list.id or data.view.parent.id
    return data?.view?.list?.id ?? data?.view?.parent?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Synchronous extraction for display purposes (stores the raw parsed ID).
 * Use resolveClickUpListId() for actual API calls.
 */
export function extractClickUpListId(url: string | null): string | null {
  const parsed = parseClickUpUrl(url);
  return parsed?.id ?? null;
}

// ─── Workspace list discovery ────────────────────────────────────────────────

interface CUList { id: string; name: string; folder: string | null; space: string }

// Module-level cache (stays warm between requests on the same serverless instance)
let _listCache: { lists: CUList[]; ts: number } | null = null;
const LIST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function cuGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: headers() });
  if (!res.ok) {
    // ClickUp puts a human-readable reason in the body; the bare status doesn't help.
    const text = await res.text().catch(() => "");
    throw new Error(`ClickUp ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

async function fetchWorkspaceLists(teamId: string): Promise<CUList[]> {
  const spacesData = await cuGet(`/team/${teamId}/space?archived=false`);
  const spaces = spacesData.spaces ?? [];
  const all: CUList[] = [];

  await Promise.all(spaces.map(async (space: { id: string; name: string }) => {
    // Space-level lists
    try {
      const d = await cuGet(`/space/${space.id}/list?archived=false`);
      for (const l of (d.lists ?? [])) all.push({ id: l.id, name: l.name, folder: null, space: space.name });
    } catch { /* ignore */ }

    // Folder lists
    try {
      const fd = await cuGet(`/space/${space.id}/folder?archived=false`);
      await Promise.all((fd.folders ?? []).map(async (folder: { id: string; name: string }) => {
        try {
          const ld = await cuGet(`/folder/${folder.id}/list?archived=false`);
          for (const l of (ld.lists ?? [])) all.push({ id: l.id, name: l.name, folder: folder.name, space: space.name });
        } catch { /* ignore */ }
      }));
    } catch { /* ignore */ }
  }));

  return all;
}

export async function getWorkspaceLists(teamId: string): Promise<CUList[]> {
  if (_listCache && Date.now() - _listCache.ts < LIST_CACHE_TTL) return _listCache.lists;
  const lists = await fetchWorkspaceLists(teamId);
  _listCache = { lists, ts: Date.now() };
  return lists;
}

/** Find the best-matching ClickUp list ID for a given company name. */
export function matchListByCompanyName(companyName: string, lists: CUList[]): string | null {
  const needle = companyName.toLowerCase();
  const score = (l: CUList) => {
    const folder = l.folder?.toLowerCase() ?? "";
    const name   = l.name.toLowerCase();
    if (folder === needle || name === needle)           return 4;
    if (folder.includes(needle) || name.includes(needle)) return 3;
    if (needle.includes(folder) && folder.length > 4)  return 2;
    if (needle.includes(name)   && name.length > 4)    return 1;
    return 0;
  };
  const best = lists.map(l => ({ l, s: score(l) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0];
  return best?.l.id ?? null;
}

// ─── Fetch tasks for a list ───────────────────────────────────────────────────

export async function fetchListTasks(listId: string): Promise<CUTask[]> {
  const all: CUTask[] = [];
  let page = 0;
  while (true) {
    const url = `${BASE_URL}/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ClickUp error ${res.status}: ${text}`);
    }
    const data = await res.json();
    const tasks = (data.tasks ?? []) as CUTask[];
    all.push(...tasks);
    if (tasks.length < 100) break; // last page
    page++;
  }
  return all;
}

// ─── Custom fields & task creation ───────────────────────────────────────────
//
// The only write path to ClickUp in this app. Used by the "Process meeting"
// wizard to file a meeting's action items against the project's own list.

/**
 * Exact name of the phase field. Matched exactly, NOT by substring: Salt & Stone's
 * list also carries a separate "Task Phase;l" dropdown, so /Phase/ matches two
 * different fields there and would pick whichever came back first.
 */
export const PHASE_FIELD_NAME = "Phase (v4)";

/** The option the wizard files action items under. */
export const INTERNAL_ACTION_POINTS = "8. Internal Action Points";

export interface CUFieldOption { id: string; name?: string; label?: string }
export interface CUField {
  id: string;
  name: string;
  type: string;                            // "labels" | "drop_down" | …
  type_config?: { options?: CUFieldOption[] };
}

/** Punctuation/spacing-insensitive compare — "8. Internal Action Points" === "8.Internal action points". */
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function cuPost(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // ClickUp puts a human-readable reason in the body; the bare status doesn't help.
    throw new Error(`ClickUp ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Custom field definitions available on a list. */
export async function fetchListFields(listId: string): Promise<CUField[]> {
  const data = await cuGet(`/list/${listId}/field`);
  return (data.fields ?? []) as CUField[];
}

export interface PhaseFieldTarget {
  fieldId: string;
  optionId: string;
  /** "labels" takes an ARRAY of option ids; "drop_down" takes a single id. */
  isMulti: boolean;
}

/**
 * Locate the phase field and the requested option on a list.
 *
 * Returns null rather than throwing when the list has no such field — JGL's list
 * genuinely doesn't have one, and a missing label is not a good reason to refuse
 * to create the task. Callers surface it as a warning.
 */
export function findPhaseTarget(fields: CUField[], optionLabel = INTERNAL_ACTION_POINTS): PhaseFieldTarget | null {
  const field = fields.find(f => f.name?.trim() === PHASE_FIELD_NAME);
  if (!field) return null;

  const wanted = normalise(optionLabel);
  const option = (field.type_config?.options ?? []).find(
    o => normalise(o.label ?? o.name ?? "") === wanted,
  );
  if (!option) return null;

  return { fieldId: field.id, optionId: option.id, isMulti: field.type === "labels" };
}

export interface CreateTaskInput {
  listId:      string;
  name:        string;
  description: string;
  phase?:      PhaseFieldTarget | null;
}

export interface CreatedTask { id: string; url: string; name: string }

/** Current value of one custom field on a task, always as a list of option ids. */
export async function fetchTaskFieldValue(taskId: string, fieldId: string): Promise<string[]> {
  const data = await cuGet(`/task/${taskId}`);
  const field = (data.custom_fields ?? []).find((f: { id: string }) => f.id === fieldId);
  const value = field?.value;
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

/**
 * Set the phase on an EXISTING task.
 *
 * Needed because list automations that fire on task creation overwrite whatever
 * the create call set — verified July 2026 on the Oxide list, where the phase
 * flipped from "8. Internal Action Points" to "3. Training & UAT" within ~10s.
 * Re-applying after the automation has fired sticks, because the automation is
 * create-triggered and does not re-fire on update.
 */
export async function applyPhase(
  taskId: string,
  phase: PhaseFieldTarget,
  current: string[],
): Promise<void> {
  if (!phase.isMulti) {
    await cuPost(`/task/${taskId}/field/${phase.fieldId}`, { value: phase.optionId });
    return;
  }
  // A labels field is additive — clear whatever the automation put there, or the
  // task ends up carrying both phases.
  const rem = current.filter(id => id !== phase.optionId);
  const value: { add: string[]; rem?: string[] } = { add: [phase.optionId] };
  if (rem.length) value.rem = rem;
  await cuPost(`/task/${taskId}/field/${phase.fieldId}`, { value });
}

export async function createTask(input: CreateTaskInput): Promise<CreatedTask> {
  const body: Record<string, unknown> = {
    name:        input.name,
    description: input.description,
  };

  if (input.phase) {
    body.custom_fields = [{
      id: input.phase.fieldId,
      // A "labels" field rejects a bare string — it must be an array of option ids.
      value: input.phase.isMulti ? [input.phase.optionId] : input.phase.optionId,
    }];
  }

  const data = await cuPost(`/list/${input.listId}/task`, body);
  return {
    id:   String(data.id ?? ""),
    url:  String(data.url ?? (data.id ? `https://app.clickup.com/t/${data.id}` : "")),
    name: String(data.name ?? input.name),
  };
}

// ─── Statuses, status writes and comments ────────────────────────────────────
//
// Write paths behind the Task Command Center's inline status dropdown and its
// comment box. Both go out under CLICKUP_API_TOKEN, which is a PERSONAL token
// (ClickUp Settings → Apps) — see the attribution note on postTaskComment.

async function cuPut(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

export interface CUStatus {
  status:     string;
  color:      string;
  orderindex: number;
  /** "open" | "custom" | "closed" | "done" — ClickUp's own grouping. */
  type:       string;
}

/**
 * The statuses a task on this list can be moved to, in ClickUp's own order.
 *
 * Statuses are a property of the LIST, not the task: a task object carries only
 * the one status it currently holds, so the set of valid targets cannot be
 * derived from the tasks already loaded. Every list in the workspace can define
 * its own, which is why this is keyed by list rather than fetched once.
 */
export async function fetchListStatuses(listId: string): Promise<CUStatus[]> {
  const data = await cuGet(`/list/${listId}`);
  return ((data.statuses ?? []) as CUStatus[])
    .map(s => ({
      status:     String(s.status ?? ""),
      color:      String(s.color ?? ""),
      orderindex: Number(s.orderindex ?? 0),
      type:       String(s.type ?? "custom"),
    }))
    .filter(s => s.status)
    .sort((a, b) => a.orderindex - b.orderindex);
}

/**
 * Move a task to a new status.
 *
 * Returns the status ClickUp reports AFTER the write, which is not always the
 * one requested — lists can carry automations that react to a status change.
 * Callers should render what comes back rather than what they sent, so the grid
 * cannot disagree with ClickUp. Note this still only reflects automations that
 * run synchronously; a create-style deferred automation (see applyPhase) would
 * land after the response and only show on the next refresh.
 */
export async function updateTaskStatus(taskId: string, status: string): Promise<string> {
  const data = await cuPut(`/task/${taskId}`, { status });
  return String(data?.status?.status ?? status);
}

export interface CUComment {
  id:   string;
  text: string;
  user: string;
  /**
   * Unix ms as a STRING — verified against the live API (August 2026), same as
   * `due_date` and every other ClickUp timestamp. Not a number, not ISO.
   */
  date: string | null;
}

/**
 * Note there is no `resolved` field: GET /task/{id}/comment does not return one.
 * Verified on real comments — the keys are id, comment, comment_text, user,
 * assignee, group_assignee, reactions, date, reply_count. Don't add a resolved
 * badge here expecting it to populate.
 */
function normalizeComment(c: {
  id?: unknown; comment_text?: unknown; date?: unknown;
  user?: { username?: unknown; email?: unknown };
}): CUComment {
  return {
    id:   String(c?.id ?? ""),
    text: String(c?.comment_text ?? ""),
    user: String(c?.user?.username ?? c?.user?.email ?? "Unknown"),
    date: c?.date == null ? null : String(c.date),
  };
}

export async function fetchTaskComments(taskId: string): Promise<CUComment[]> {
  const data = await cuGet(`/task/${taskId}/comment`);
  return ((data.comments ?? []) as Parameters<typeof normalizeComment>[0][])
    .map(normalizeComment)
    .filter(c => c.id)
    // Sorted explicitly oldest-first so the panel reads as a conversation.
    // ClickUp's own ordering is documented as newest-first but every thread in
    // this workspace holds a single comment, so it could not be confirmed —
    // sorting outright means the panel is right either way. Undated comments
    // sort last rather than jumping to the top on a NaN compare.
    .sort((a, b) => {
      const av = a.date == null ? Infinity : Number(a.date);
      const bv = b.date == null ? Infinity : Number(b.date);
      return (isNaN(av) ? Infinity : av) - (isNaN(bv) ? Infinity : bv);
    });
}

/**
 * Post a comment to a task.
 *
 * CLICKUP_API_TOKEN is a personal token, so EVERY comment posted from the
 * dashboard appears in ClickUp under whoever generated that token — not the
 * signed-in PM. `author` is therefore stamped into the comment body itself;
 * without it the audit trail silently collapses to one person. Switching to
 * per-user OAuth is the real fix, and would let this prefix go away.
 */
export async function postTaskComment(
  taskId: string,
  text: string,
  author: string | null,
): Promise<void> {
  const body = author ? `**${author}** (via Delivery Dashboard)\n\n${text}` : text;
  await cuPost(`/task/${taskId}/comment`, {
    comment_text: body,
    notify_all:   false,
  });
}

// ─── Task classification helpers ─────────────────────────────────────────────

export function isBlocked(task: CUTask): boolean {
  const st = task.status.status.toLowerCase();
  if (st === "on hold" || st === "blocked" || st === "stuck" || st === "requires ns support") return true;
  return task.tags.some(t => t.name.toLowerCase() === "blocked");
}

export function isClientPending(task: CUTask): boolean {
  const st = task.status.status.toLowerCase();
  if (st === "awaiting confirmation" || st === "input required") return true;
  return task.tags.some(t => t.name.toLowerCase() === "client");
}

export function isMilestone(task: CUTask): boolean {
  return task.tags.some(t => t.name.toLowerCase() === "milestone");
}

export function isDone(task: CUTask): boolean {
  const st = task.status.status.toLowerCase();
  return st === "done" || st === "complete";
}

/**
 * Local midnight this morning — the line between "overdue" and "due today".
 *
 * Overdue is a comparison of DATES, never of instants. ClickUp stores a due date
 * with a time attached, and for a date-only due date that time is an arbitrary
 * fixed hour rather than end of day: every task due 14 Aug 2026 on the Certified
 * Waste list carries 04:00 local. Testing `due < Date.now()` therefore flipped
 * every task due today into Overdue from 04:00 onwards, and the whole tab reads
 * in whole days ("This Week", "14 Aug"), so an hours-precise cutoff was never
 * the intended meaning.
 */
export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Due before today and not finished. Use this everywhere rather than comparing
 * `due_date` inline — the instant-vs-day mistake above was independently
 * repeated in eight call sites across the Tasks tab, My Work and AI insights.
 */
export function isOverdueTask(task: CUTask): boolean {
  if (!task.due_date || isDone(task)) return false;
  return parseInt(task.due_date) < startOfToday();
}

// ─── Compute % complete from task list ───────────────────────────────────────

export function computePct(tasks: CUTask[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter(isDone).length;
  return done / tasks.length;
}

// ─── Task-derived project fields ─────────────────────────────────────────────

/**
 * The four Project fields that are pure functions of its ClickUp task list.
 *
 * Shared between /api/projects and the client so that editing a task in place
 * (the Task Command Center's inline status dropdown) reproduces exactly what a
 * refetch would have returned. Derived in two places, they drift: a task moved
 * out of "On Hold" in the grid stays counted in Portfolio's Blocked KPI, which
 * reads `project.blocked` rather than re-testing the tasks.
 */
export function deriveTaskRollup(tasks: CUTask[]): {
  blocked:       CUTask[];
  clientPending: CUTask[];
  milestones:    CUTask[];
  pct:           number;
} {
  return {
    blocked:       tasks.filter(isBlocked),
    clientPending: tasks.filter(t => isClientPending(t) && !isDone(t)),
    milestones:    tasks.filter(isMilestone),
    pct:           computePct(tasks),
  };
}

// ─── Bucket tasks by due date ─────────────────────────────────────────────────

export type Bucket = "overdue" | "this_week" | "next_week" | "upcoming" | "no_date";

export function taskBucket(task: CUTask): Bucket {
  if (!task.due_date) return "no_date";
  const due  = parseInt(task.due_date);
  const week = 7 * 86400000;

  // Mon of current week
  const todayDate = new Date();
  const mon = new Date(todayDate);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const monMs = mon.getTime();

  // Against midnight, NOT Date.now() — a task due today belongs to This Week all
  // day, not from whatever hour ClickUp stamped on its due date. See startOfToday.
  if (isOverdueTask(task))    return "overdue";
  if (due < monMs + week)     return "this_week";
  if (due < monMs + 2 * week) return "next_week";
  return "upcoming";
}
