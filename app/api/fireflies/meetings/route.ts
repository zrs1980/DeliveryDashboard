import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchFirefliesMeetings, firefliesConfigured, FirefliesError } from "@/lib/fireflies";

export const revalidate = 0;
export const maxDuration = 60;

const DEFAULT_FROM = "2026-07-01";

/**
 * GET /api/fireflies/meetings?from=YYYY-MM-DD&to=YYYY-MM-DD&tzOffset=<minutes>
 *
 * Fireflies takes ISO 8601 instants, so local dates are converted here using the
 * browser's offset — the same lesson as the Zoom range bug, applied up front rather
 * than after losing an afternoon's meetings.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!firefliesConfigured()) {
    return NextResponse.json({
      error: "Fireflies is not connected. Add FIREFLIES_API_KEY in Vercel, then redeploy.",
      needsSetup: true,
    }, { status: 503 });
  }

  const sp       = req.nextUrl.searchParams;
  const fromDate = sp.get("from") || DEFAULT_FROM;
  const toDate   = sp.get("to")   || new Date().toISOString().slice(0, 10);

  const rawOffset = Number(sp.get("tzOffset") ?? "0");
  const tzOffset  = Number.isFinite(rawOffset) && Math.abs(rawOffset) <= 900 ? rawOffset : 0;

  const dayMs   = 86_400_000;
  const startMs = Date.parse(`${fromDate}T00:00:00Z`) + tzOffset * 60_000;
  const endMs   = Date.parse(`${toDate}T00:00:00Z`)   + tzOffset * 60_000 + dayMs - 1;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return NextResponse.json({ error: "Invalid from/to date." }, { status: 400 });
  }
  if (startMs > endMs) {
    return NextResponse.json({ error: "`from` is after `to`." }, { status: 400 });
  }

  try {
    const { meetings, truncated, tier, notes } = await fetchFirefliesMeetings(
      new Date(startMs).toISOString(),
      new Date(endMs).toISOString(),
    );

    const totalMinutes = meetings.reduce((s, m) => s + (m.durationMinutes || 0), 0);
    const withSummary  = meetings.filter(m => m.hasSummary).length;
    const withExternal = meetings.filter(m => m.external.length > 0).length;

    // Organisers stand in for "hosts" so the view can offer the same filter.
    const organisers = [...new Set(meetings.map(m => m.organizerEmail).filter(Boolean))]
      .sort()
      .map(email => ({ id: email, name: email.split("@")[0], email }));

    return NextResponse.json({
      meetings,
      organisers,
      summary: {
        count:        meetings.length,
        totalMinutes,
        totalHours:   Math.round((totalMinutes / 60) * 10) / 10,
        avgMinutes:   meetings.length ? Math.round(totalMinutes / meetings.length) : 0,
        withSummary,
        withExternal,
      },
      range: { from: fromDate, to: toDate },
      truncated, tier, notes,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/fireflies/meetings]", err);
    const msg = err instanceof FirefliesError ? err.message
              : err instanceof Error          ? err.message
              : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
