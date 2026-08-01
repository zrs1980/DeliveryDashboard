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
  if (!res.ok) throw new Error(`${res.status}`);
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

export function isOverdueTask(task: CUTask): boolean {
  if (!task.due_date || isDone(task)) return false;
  return parseInt(task.due_date) < Date.now();
}

// ─── Compute % complete from task list ───────────────────────────────────────

export function computePct(tasks: CUTask[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter(isDone).length;
  return done / tasks.length;
}

// ─── Bucket tasks by due date ─────────────────────────────────────────────────

export type Bucket = "overdue" | "this_week" | "next_week" | "upcoming" | "no_date";

export function taskBucket(task: CUTask): Bucket {
  if (!task.due_date) return "no_date";
  const due  = parseInt(task.due_date);
  const now  = Date.now();
  const week = 7 * 86400000;

  // Mon of current week
  const todayDate = new Date();
  const mon = new Date(todayDate);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const monMs = mon.getTime();

  if (due < now && !isDone(task)) return "overdue";
  if (due < monMs + week)         return "this_week";
  if (due < monMs + 2 * week)     return "next_week";
  return "upcoming";
}
