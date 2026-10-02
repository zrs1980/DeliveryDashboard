// ─── Telling someone work has landed on them ─────────────────────────────────
//
// ⚠ ASSIGNING A TASK TOLD NOBODY. `POST /api/crm/tasks` and `POST /api/pm/tasks`
// contained no notification code at all, so you handed a colleague work and
// they found out by opening the app and filtering to "mine". For a tool whose
// point is coordinating people, that was the central feature missing.
//
// ⚠ NOTIFYING NEVER FAILS THE WRITE. The task is already created by the time
// this runs. Failing the request because a message could not be delivered
// would tell the assigner the assignment did not happen when it did — the
// worse of the two errors, and the same rule every timeline writer follows.
// Failures come back as a `warning` beside the success.
//
// Delivery reuses the digest's path exactly: DM when the Slack token can find
// people, a nominated channel when it cannot. One place to fix, one place to
// upgrade when the scopes land.

import { dmByEmail, postToChannel, SlackScopeError } from "@/lib/slack";

export interface AssignmentNote {
  /** Email of the person the work landed on. */
  to:        string;
  /** Who did it, for the "X assigned you" line. */
  by:        string;
  title:     string;
  customer?: string | null;
  dueDate?:  string | null;
  /** Deep link to where the work lives. */
  href?:     string | null;
}

const base = () => String(process.env.AUTH_URL ?? "").replace(/\/$/, "");

export function taskLink(customerNsId?: string | null): string | null {
  const b = base();
  if (!b) return null;
  return customerNsId
    ? `${b}/?tab=customers&view=accounts&customer=${encodeURIComponent(customerNsId)}`
    : `${b}/?tab=customers&view=tasks`;
}

/**
 * Tell someone a task is theirs.
 *
 * Returns null on success, or a human-readable warning the caller can hand
 * back alongside the created task. Never throws.
 */
export async function notifyAssignment(n: AssignmentNote): Promise<string | null> {
  const to = String(n.to ?? "").trim().toLowerCase();
  if (!to) return null;

  // ⚠ Assigning something to yourself is not news. This fires on every task
  // created with an assignee, and most of those are people writing down their
  // own work.
  if (to === String(n.by ?? "").trim().toLowerCase()) return null;

  const when = n.dueDate ? ` · due ${String(n.dueDate).slice(0, 10)}` : "";
  const who  = n.customer ? ` — ${n.customer}` : "";
  const text = n.href
    ? `*${n.by}* assigned you: <${n.href}|${n.title}>${who}${when}`
    : `*${n.by}* assigned you: ${n.title}${who}${when}`;

  try {
    await dmByEmail(to, text);
    return null;
  } catch (e) {
    if (e instanceof SlackScopeError) {
      const channel = String(process.env.DIGEST_SLACK_CHANNEL ?? "").trim();
      if (!channel) {
        return "Task created. Nobody was notified: Slack cannot DM (missing "
             + "users:read, users:read.email, im:write) and DIGEST_SLACK_CHANNEL is unset.";
      }
      try {
        await postToChannel(channel, `${text}\n_(for ${to} — DM scopes not yet granted)_`);
        return null;
      } catch (e2) {
        return `Task created, but the notification failed: ${e2 instanceof Error ? e2.message : "unknown"}`;
      }
    }
    return `Task created, but ${to} was not notified: ${e instanceof Error ? e.message : "unknown"}`;
  }
}
