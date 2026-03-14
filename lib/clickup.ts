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

export function extractClickUpListId(url: string | null): string | null {
  if (!url) return null;
  // /v/l/{listId}
  const listMatch = url.match(/\/l\/([a-z0-9]+)/i);
  if (listMatch) return listMatch[1];
  // /v/s/{spaceId} or other patterns — fall back to last segment
  const segments = url.replace(/\/$/, "").split("/");
  const last = segments[segments.length - 1];
  return last || null;
}

// ─── Fetch tasks for a list ───────────────────────────────────────────────────

export async function fetchListTasks(listId: string): Promise<CUTask[]> {
  const url = `${BASE_URL}/list/${listId}/task?include_closed=true&subtasks=true&page=0`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return (data.tasks ?? []) as CUTask[];
}

// ─── Task classification helpers ─────────────────────────────────────────────

export function isBlocked(task: CUTask): boolean {
  const st = task.status.status.toLowerCase();
  if (st === "on hold" || st === "blocked") return true;
  return task.tags.some(t => t.name.toLowerCase() === "blocked");
}

export function isClientPending(task: CUTask): boolean {
  const st = task.status.status.toLowerCase();
  if (st === "awaiting confirmation") return true;
  return task.tags.some(t => t.name.toLowerCase() === "client");
}

export function isMilestone(task: CUTask): boolean {
  return task.tags.some(t => t.name.toLowerCase() === "milestone");
}

export function isDone(task: CUTask): boolean {
  const st = task.status.status.toLowerCase();
  return st === "done" || st === "complete" || st === "supplied";
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
  const day  = 86400000;
  const week = 7 * day;

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
