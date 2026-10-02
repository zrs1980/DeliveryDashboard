import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildMyWork } from "@/lib/my-work";
import { resolveOwner } from "@/lib/cs-ownership";

export const revalidate  = 0;
export const maxDuration = 60;

/**
 * Everything waiting on the signed-in person.
 *
 * ⚠ SESSION-GATED, NOT cs_layer, AND THAT IS THE POINT. Focus answers this
 * question well and is cs_layer-only, so perhaps three people could see it
 * while every PM and consultant had no worklist at all. This returns facts —
 * tasks assigned, checks booked, promises made — and no score, band, flag or
 * quiet-account inference, which is exactly what lets it be shown to everyone.
 *
 * ⚠ IT IS ALWAYS THE CALLER'S OWN WORK. There is no `?email=` parameter and
 * there should not be: "show me what Sam has on" is a different feature with a
 * different permission question, and adding it here as a query string is how
 * one gets built by accident.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // The NetSuite employee id, for the two sources keyed on it. Null for
    // someone with no employee record — their CRM tasks still resolve by
    // email, so they get a partial answer rather than an error.
    const me = await resolveOwner(session.user.email);
    const work = await buildMyWork(session.user.email, me.nsId);

    return NextResponse.json({
      ...work,
      me: { email: me.email, name: me.name, nsId: me.nsId },
      ...(me.nsId === null && {
        note: "No NetSuite employee record matches this login, so project tasks "
            + "and health checks assigned to you cannot be found. Tasks assigned "
            + "by email still appear.",
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
