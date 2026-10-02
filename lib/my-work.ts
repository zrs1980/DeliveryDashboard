// ─── Everything waiting on one person ────────────────────────────────────────
//
// ⚠ WORK FOR ONE PERSON WAS SCATTERED ACROSS FOUR SURFACES KEYED FOUR DIFFERENT
// WAYS, and nothing put them together:
//
//     pm_crm_tasks.assigned_to       an email
//     pm_tasks.assignee_ns_id        a NetSuite employee id
//     healthchecks.consultant_ns_id  a NetSuite employee id
//     cs_commitments                 no owner at all — the ACCOUNT's owner
//
// "My Work" fetched health checks and AI insights and knew about none of the
// rest. Focus answered the same question properly but is cs_layer-only, so
// perhaps three people could see it and every PM and consultant had no
// worklist at all.
//
// ⚠ THIS IS FACTS ONLY, WHICH IS WHY IT NEEDS NO cs_layer. Tasks assigned,
// checks booked, promises made — each is a thing someone recorded, not a
// judgment the system formed. No score, no band, no flag, no quiet-account
// inference. That boundary is what lets it be shown to everyone, and it is
// also the reason this is not simply Focus with the gate removed.
//
// ─── Why it is not the digest ───────────────────────────────────────────────
//
// They share their four sources and answer different questions. The digest is
// "what is urgent today": a two-day horizon, truncated, built for everyone in
// one pass because sending 24 messages cannot mean 24 × 4 queries. This is
// "everything assigned to me", unbounded and grouped, for one person on
// demand. Merging them would mean one of the two answering its question badly.

import { getSupabaseAdmin } from "@/lib/supabase";
import { readCustomerIndex, type CustomerIndexRow } from "@/lib/cs-customer-index";
import { hcStatus } from "@/lib/healthchecks";
import type { Healthcheck } from "@/app/api/healthchecks/route";

export interface WorkItem {
  id:       string;
  title:    string;
  detail:   string | null;
  /** Negative = overdue. Null = no date, which sorts last rather than first. */
  daysUntil: number | null;
  customerNsId: string | null;
  customerName: string | null;
}

export interface WorkSection {
  key:   "tasks" | "pm_tasks" | "checks" | "promises";
  title: string;
  items: WorkItem[];
}

export interface MyWork {
  sections: WorkSection[];
  total:    number;
  warnings: string[];
}

const daysUntil = (d: string | null | undefined): number | null => {
  if (!d) return null;
  const x = new Date(String(d).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(x.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((x.getTime() - t.getTime()) / 86_400_000);
};

/** Overdue first, then soonest; undated last. A task with no date is not urgent. */
const byDue = (a: WorkItem, b: WorkItem) => {
  if (a.daysUntil === null && b.daysUntil === null) return 0;
  if (a.daysUntil === null) return 1;
  if (b.daysUntil === null) return -1;
  return a.daysUntil - b.daysUntil;
};

export async function buildMyWork(email: string, nsId: number | null): Promise<MyWork> {
  const db = getSupabaseAdmin();
  const warnings: string[] = [];
  const addr = email.trim().toLowerCase();

  const [crm, pm, checks, index] = await Promise.all([
    db.from("pm_crm_tasks")
      .select("id, title, due_date, status, customer_ns_id, priority")
      .in("status", ["open", "in_progress"]).ilike("assigned_to", addr),
    nsId === null
      ? Promise.resolve({ data: [], error: null })
      : db.from("pm_tasks")
          .select("id, title, due_date, status, project_ns_id")
          .eq("assignee_ns_id", nsId).not("status", "in", '("done","cancelled")'),
    db.from("healthchecks").select("*"),
    readCustomerIndex().catch(() => [] as CustomerIndexRow[]),
  ]);

  if (crm.error) warnings.push(`Tasks unreadable: ${crm.error.message}`);
  if (pm.error)  warnings.push(`Project tasks unreadable: ${pm.error.message}`);

  const nameOf = new Map(index.map(r => [r.customer_ns_id, r.name]));
  const hcRows = (checks.data ?? []) as Healthcheck[];
  const sections: WorkSection[] = [];

  // ── CRM tasks ─────────────────────────────────────────────────────────────
  const crmItems: WorkItem[] = (crm.data ?? []).map(t => ({
    id: String(t.id),
    title: t.title,
    detail: t.priority && t.priority !== "normal" ? `${t.priority} priority` : null,
    daysUntil: daysUntil(t.due_date),
    customerNsId: t.customer_ns_id ?? null,
    customerName: t.customer_ns_id ? nameOf.get(t.customer_ns_id) ?? null : null,
  })).sort(byDue);
  if (crmItems.length) sections.push({ key: "tasks", title: "Tasks", items: crmItems });

  // ── Delivery tasks ────────────────────────────────────────────────────────
  const pmItems: WorkItem[] = (pm.data ?? []).map(t => ({
    id: String(t.id),
    title: t.title,
    detail: t.project_ns_id ? `Project ${t.project_ns_id}` : null,
    daysUntil: daysUntil(t.due_date),
    customerNsId: null,
    customerName: null,
  })).sort(byDue);
  if (pmItems.length) sections.push({ key: "pm_tasks", title: "Project tasks", items: pmItems });

  // ── Health checks booked to them ──────────────────────────────────────────
  // Theirs by assignment, not by account ownership — someone else's account
  // can have a check with your name on it, and that is still your call to run.
  const mineChecks: WorkItem[] = hcRows
    .filter(h => nsId !== null && h.consultant_ns_id === nsId && h.status !== "completed"
              && h.status !== "cancelled")
    .map(h => ({
      id: h.id,
      title: `${h.quarter} health check — ${h.customer_name}`,
      detail: hcStatus(h.customer_ns_id, h.quarter, hcRows) === "overdue"
        ? "booked and missed" : h.scheduled_date ? "booked" : "no date set",
      daysUntil: daysUntil(h.scheduled_date),
      customerNsId: h.customer_ns_id,
      customerName: h.customer_name,
    })).sort(byDue);
  if (mineChecks.length) sections.push({ key: "checks", title: "Health checks", items: mineChecks });

  // ── Promises on accounts they own ─────────────────────────────────────────
  // ⚠ A read failure here is NOT "no promises". cs_commitments is cs_layer on
  // read, so a consultant legitimately gets nothing back — that is silence by
  // design, not an empty book, and it must not be reported as one.
  if (nsId !== null) {
    const ownedIds = index
      .filter(r => (r.consultant_ns_id ?? r.salesrep_ns_id) === nsId)
      .map(r => r.customer_ns_id);

    if (ownedIds.length) {
      const { data: com, error } = await db.from("cs_commitments")
        .select("id, customer_ns_id, description, due_date, direction, status")
        .eq("status", "open").eq("direction", "we_owe").in("customer_ns_id", ownedIds);

      if (!error && com?.length) {
        sections.push({
          key: "promises",
          title: "You promised",
          items: com.map(c => ({
            id: String(c.id),
            title: c.description,
            detail: null,
            daysUntil: daysUntil(c.due_date),
            customerNsId: c.customer_ns_id,
            customerName: nameOf.get(c.customer_ns_id) ?? null,
          })).sort(byDue),
        });
      }
    }
  }

  return {
    sections,
    total: sections.reduce((n, s) => n + s.items.length, 0),
    warnings,
  };
}
