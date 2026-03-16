import { NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/auth";
import { getGoogleCalendarClient } from "@/lib/google-tokens";
import { getSupabaseAdmin } from "@/lib/supabase";

interface ScheduledRow {
  task_id: string;
  event_id: string | null;
}

/**
 * POST /api/calendar/sync
 * Checks every scheduled_tasks row with an event_id against Google Calendar.
 * Deletes rows whose events have been removed or cancelled in Google Calendar.
 * Returns { removed: taskId[] }.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = getSupabaseAdmin();

  // Only rows that actually have a linked Google Calendar event
  const { data: tasks } = await db
    .from("scheduled_tasks")
    .select("task_id, event_id")
    .eq("user_email", session.user.email)
    .not("event_id", "is", null) as { data: ScheduledRow[] | null };

  if (!tasks || tasks.length === 0) return NextResponse.json({ removed: [] });

  const authClient = await getGoogleCalendarClient(session.user.email);
  if (!authClient) return NextResponse.json({ removed: [] });

  const calendar = google.calendar({ version: "v3", auth: authClient });

  // Check each event in parallel — 404 or status=cancelled means deleted
  const removed: string[] = [];
  await Promise.all(
    tasks.map(async (t) => {
      try {
        const ev = await calendar.events.get({
          calendarId: "primary",
          eventId: t.event_id!,
        });
        if (ev.data.status === "cancelled") removed.push(t.task_id);
      } catch {
        // 404 Gone → treat as deleted
        removed.push(t.task_id);
      }
    })
  );

  if (removed.length > 0) {
    await db
      .from("scheduled_tasks")
      .delete()
      .eq("user_email", session.user.email)
      .in("task_id", removed);
  }

  return NextResponse.json({ removed });
}
