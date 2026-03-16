import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/auth";
import { getGoogleCalendarClient } from "@/lib/google-tokens";

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) {
    return { session: null, error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { session, error: null };
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const start = req.nextUrl.searchParams.get("start");
  const end   = req.nextUrl.searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "Missing start/end" }, { status: 400 });

  const authClient = await getGoogleCalendarClient(session!.user.email!);
  if (!authClient) return NextResponse.json({ error: "Google Calendar not linked — please sign out and sign in again." }, { status: 401 });

  try {
    const calendar = google.calendar({ version: "v3", auth: authClient });
    const res = await calendar.events.list({
      calendarId: "primary", timeMin: start, timeMax: end,
      singleEvents: true, orderBy: "startTime", maxResults: 200,
    });
    return NextResponse.json({ events: res.data.items ?? [] });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { title, description, start, end } = await req.json();
  if (!title || !start || !end) return NextResponse.json({ error: "Missing title/start/end" }, { status: 400 });

  const authClient = await getGoogleCalendarClient(session!.user.email!);
  if (!authClient) return NextResponse.json({ error: "Google Calendar not linked" }, { status: 401 });

  try {
    const calendar = google.calendar({ version: "v3", auth: authClient });
    const event = await calendar.events.insert({
      calendarId: "primary",
      requestBody: { summary: title, description: description ?? "", start: { dateTime: start }, end: { dateTime: end } },
    });
    return NextResponse.json({ event: event.data });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { eventId, start, end } = await req.json();
  if (!eventId || !start || !end) return NextResponse.json({ error: "Missing eventId/start/end" }, { status: 400 });

  const authClient = await getGoogleCalendarClient(session!.user.email!);
  if (!authClient) return NextResponse.json({ error: "Google Calendar not linked" }, { status: 401 });

  try {
    const calendar = google.calendar({ version: "v3", auth: authClient });
    const event = await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: { start: { dateTime: start }, end: { dateTime: end } },
    });
    return NextResponse.json({ event: event.data });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

  const authClient = await getGoogleCalendarClient(session!.user.email!);
  if (!authClient) return NextResponse.json({ error: "Google Calendar not linked" }, { status: 401 });

  try {
    const calendar = google.calendar({ version: "v3", auth: authClient });
    await calendar.events.delete({ calendarId: "primary", eventId });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
