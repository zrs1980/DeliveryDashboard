import { NextResponse } from "next/server";
import { auth } from "@/auth";

// ─── CS agent layer — the `cs_layer` permission ──────────────────────────────
//
// Why this is a boundary and not a UI preference:
//
// Risk flags visibly change how people behave toward a client. A consultant who
// knows an account is flagged at-risk carries that into the next call, and a
// false positive becomes self-fulfilling. So commercial risk data — health
// scores, flags, contracts, outreach drafts — does not reach the delivery team
// at all, and "hidden in the UI" is not sufficient. Every CS route calls
// requireCsLayer() before it reads or writes anything.
//
// Why this does NOT live in lib/constants.ts: constants.ts is imported by client
// components, so PTO_APPROVER_EMAILS already ships inside the browser bundle —
// the approver list is readable by anyone who opens devtools. Survivable for
// "who can approve leave"; not for "who can see which customers we think are
// churning". Keep this module out of every client import chain.
//
// Roles in this app are hardcoded email lists (PTO_APPROVER_EMAILS, ADMIN_EMAIL)
// — there is no role model in the database and no role claim in the session JWT.
// This follows that convention deliberately: a roles table would be the only one
// of its kind here, and Phase 0's requirement is that the boundary is enforced
// server-side, not that it is modelled in Postgres. Revisit when a second
// permission needs to exist.

// Belt and braces. The `server-only` package would fail this at build time, but
// it is not a dependency here and this module does not warrant adding one — the
// imports below are server-side anyway, and the build is checked with
// `grep -r CS_LAYER .next/static` returning nothing.
if (typeof window !== "undefined") {
  throw new Error("lib/cs-permissions.ts is server-only and must not be imported by a client component.");
}

/** Who can see commercial risk data. Changing this needs a deploy. */
export const CS_LAYER_EMAILS = [
  "zabe@cebasolutions.com",
];

export function hasCsLayer(email: string | null | undefined): boolean {
  if (!email) return false;
  return CS_LAYER_EMAILS.includes(email.toLowerCase().trim());
}

export interface CsSession {
  email: string;
  name:  string | null;
}

/**
 * Gate every CS route on this.
 *
 * Returns either `{ session }` or `{ response }` — return the response
 * immediately when present:
 *
 *   const gate = await requireCsLayer();
 *   if (gate.response) return gate.response;
 *   // gate.session.email is a cs_layer holder from here on
 *
 * Answers in JSON, never a redirect. The middleware in proxy.ts bounces
 * unauthenticated requests to /login with a 302, which hands an API caller an
 * HTML page — fine for a browser navigation, useless to fetch(). A CS route
 * reached without permission should say so in a shape the caller can read.
 */
export async function requireCsLayer(): Promise<
  { session: CsSession; response?: never } | { session?: never; response: NextResponse }
> {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    return {
      response: NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      ),
    };
  }

  if (!hasCsLayer(email)) {
    // Deliberately does not say what exists behind the boundary.
    return {
      response: NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      ),
    };
  }

  return { session: { email, name: session?.user?.name ?? null } };
}

/**
 * Gate for the nightly job, which arrives with no session at all.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Note the cron path is
 * also exempted in proxy.ts — without that the middleware redirects the request
 * to /login, the job returns HTML 200, and it looks like it ran. A silently dead
 * health job is worse than none, because an empty flag list reads as "no risk".
 */
export function requireCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("[cs/cron] CRON_SECRET is not set — refusing to run unauthenticated.");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }

  const header = req.headers.get("authorization") ?? "";
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
