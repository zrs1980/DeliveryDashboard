import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getActiveStaff } from "@/lib/roster";

export const revalidate = 0;
export const maxDuration = 30;

/**
 * Who can be assigned work in this tool.
 *
 * GET → { users: [{ email, name, hasSignedIn, source }], ... }
 *
 * TWO SOURCES, MERGED ON EMAIL, because neither alone answers the question:
 *
 *   `pm_app_users`  — people who have actually completed sign-in. Authoritative
 *                     for "has a login", but empty for a new colleague.
 *   NetSuite roster — people who work here and could sign in. Includes anyone
 *                     who has not got round to it yet.
 *
 * Assigning to someone who has not signed in yet is allowed on purpose: the
 * task is waiting for them when they do, and refusing would mean you cannot
 * hand work to a new starter until they happen to log in. They are flagged
 * `hasSignedIn: false` so the picker can say so rather than implying the task
 * has landed somewhere it has not.
 *
 * ⚠ NOT AN AUTHORISATION LIST. This says who can RECEIVE a task. What anyone is
 * allowed to DO still comes from AUTH_ALLOWED_DOMAIN and lib/cs-permissions.ts.
 *
 * ⚠ EMAIL IS THE KEY, LOWER-CASED. `pm_crm_tasks.assigned_to` stores an email
 * and the "my tasks" filter compares it to the session address, so a
 * case mismatch silently splits one person in two.
 */

const ALLOWED_DOMAINS = (process.env.AUTH_ALLOWED_DOMAIN ?? "")
  .split(",").map(d => d.trim().toLowerCase()).filter(Boolean);

/** Can this address sign in at all? With no domains configured, anyone can. */
const canSignIn = (email: string) =>
  ALLOWED_DOMAINS.length === 0 || ALLOWED_DOMAINS.some(d => email.endsWith(`@${d}`));

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const warnings: string[] = [];

  // Both sources are optional. Losing one degrades the list; failing the whole
  // request would leave the picker empty, which reads as "there is nobody to
  // assign to" rather than "one source is down".
  const [appRes, staff] = await Promise.all([
    getSupabaseAdmin().from("pm_app_users")
      .select("email, name, image_url, last_seen_at, is_active")
      .eq("is_active", true)
      .then(r => r, () => ({ data: null, error: { message: "unreachable" } })),
    getActiveStaff().catch(() => null),
  ]);

  if (appRes.error) {
    warnings.push(
      `Signed-in users could not be read (${appRes.error.message}). `
      + "Run supabase/pm-app-users.sql in the Supabase SQL Editor.");
  }
  if (!staff) warnings.push("The NetSuite roster is unreachable, so people who have never signed in are missing.");
  else if (staff.fallback) warnings.push("The NetSuite roster fell back to hardcoded names — treat them with suspicion.");

  type Row = {
    email: string; name: string; hasSignedIn: boolean;
    lastSeenAt: string | null; imageUrl: string | null; source: "app" | "roster";
  };
  const byEmail = new Map<string, Row>();

  // 1. People who have signed in. These are facts.
  for (const u of appRes.data ?? []) {
    const email = String(u.email).toLowerCase();
    byEmail.set(email, {
      email,
      name: u.name?.trim() || email,
      hasSignedIn: true,
      lastSeenAt: u.last_seen_at ?? null,
      imageUrl: u.image_url ?? null,
      source: "app",
    });
  }

  // 2. Active staff who could sign in. Their NetSuite name WINS over the Google
  //    display name, so the assignee reads the same here as everywhere else in
  //    the app — and so a backfilled row, which has no name at all, gets one.
  for (const m of staff?.members ?? []) {
    const email = (m.email ?? "").trim().toLowerCase();
    if (!email || !canSignIn(email)) continue;
    const existing = byEmail.get(email);
    if (existing) {
      if (m.name?.trim()) existing.name = m.name.trim();
    } else {
      byEmail.set(email, {
        email, name: m.name?.trim() || email, hasSignedIn: false,
        lastSeenAt: null, imageUrl: null, source: "roster",
      });
    }
  }

  const users = [...byEmail.values()].sort((a, b) => {
    // Signed-in first — the people most likely to be picked — then by name.
    if (a.hasSignedIn !== b.hasSignedIn) return a.hasSignedIn ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({
    users,
    me: session.user.email.toLowerCase(),
    warnings,
  });
}
