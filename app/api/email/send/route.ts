import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/auth";
import { getGoogleCalendarClient } from "@/lib/google-tokens";

interface Attachment {
  filename: string;
  mimeType: string;
  data: string; // base64
}

function buildMimeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  attachments: Attachment[] = [],
): string {
  const boundary = `boundary_${Date.now().toString(36)}`;
  const nl = "\r\n";

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
  ];

  if (attachments.length === 0) {
    headers.push(`Content-Type: text/plain; charset="UTF-8"`);
    return [...headers, "", body].join(nl);
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const parts: string[] = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: quoted-printable`,
    "",
    body,
  ];

  for (const att of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "",
      att.data.replace(/(.{76})/g, "$1\r\n"), // wrap at 76 chars
    );
  }

  parts.push(`--${boundary}--`);

  return [...headers, "", ...parts].join(nl);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { to, subject, body, attachments = [] } = await req.json();
  if (!to || !subject || !body) {
    return NextResponse.json({ error: "to, subject, and body are required" }, { status: 400 });
  }

  const oauth2 = await getGoogleCalendarClient(session.user.email);
  if (!oauth2) {
    return NextResponse.json({ error: "Gmail not linked — please sign out and sign in again to grant email permissions." }, { status: 401 });
  }

  try {
    const gmail  = google.gmail({ version: "v1", auth: oauth2 });
    const raw    = buildMimeMessage(session.user.email, to, subject, body, attachments);
    const encoded = Buffer.from(raw).toString("base64url");

    const sent = await gmail.users.messages.send({
      userId:      "me",
      requestBody: { raw: encoded },
    });

    return NextResponse.json({ ok: true, messageId: sent.data.id });
  } catch (e: any) {
    const msg = e?.message ?? "Gmail send failed";
    // Surface the specific Google error if available
    const detail = e?.errors?.[0]?.message ?? msg;
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
