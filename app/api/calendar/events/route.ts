import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

function makeClient(tokensJson: string) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth2.setCredentials(JSON.parse(tokensJson));

  // Persist refreshed tokens back to cookie by catching the token refresh event.
  // We can't update cookies in a streaming context, but setting credentials is enough
  // for single-request use — next request will still use the stored tokens (googleapis
  // refreshes transparently per-call using the stored refresh_token).
  return oauth2;
}

export async function GET(req: NextRequest) {
  const tokensJson = req.cookies.get("gcal_tokens")?.value;
  if (!tokensJson) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const start = req.nextUrl.searchParams.get("start");
  const end   = req.nextUrl.searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "Missing start/end" }, { status: 400 });

  try {
    const auth     = makeClient(tokensJson);
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.list({
      calendarId:   "primary",
      timeMin:      start,
      timeMax:      end,
      singleEvents: true,
      orderBy:      "startTime",
      maxResults:   200,
    });
    return NextResponse.json({ events: res.data.items ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("invalid_grant") || msg.includes("Token has been expired")) {
      return NextResponse.json({ error: "Token expired — please reconnect Google Calendar." }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tokensJson = req.cookies.get("gcal_tokens")?.value;
  if (!tokensJson) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { title, description, start, end } = await req.json();
  if (!title || !start || !end) {
    return NextResponse.json({ error: "Missing title/start/end" }, { status: 400 });
  }

  try {
    const auth     = makeClient(tokensJson);
    const calendar = google.calendar({ version: "v3", auth });
    const event = await calendar.events.insert({
      calendarId:  "primary",
      requestBody: {
        summary:     title,
        description: description ?? "",
        start:       { dateTime: start },
        end:         { dateTime: end },
      },
    });
    return NextResponse.json({ event: event.data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const tokensJson = req.cookies.get("gcal_tokens")?.value;
  if (!tokensJson) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

  try {
    const auth     = makeClient(tokensJson);
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId: "primary", eventId });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
