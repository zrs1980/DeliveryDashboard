import { google } from "googleapis";
import { getGoogleCalendarClient } from "@/lib/google-tokens";

// ─── Sending mail as the signed-in user ─────────────────────────────────────
//
// Extracted so the CS draft queue does not become a THIRD hand-rolled copy of
// MIME assembly — app/api/email/send and app/api/pto-requests both build their
// own today, which CLAUDE.md already notes. Those two are left alone on purpose
// (they work, and changing a working send path to tidy it is not worth the
// risk), but new callers come here and the old two should move when someone is
// in them anyway.
//
// ⚠ MAIL GOES OUT AS THE SIGNED-IN USER, from their own mailbox, using their
// OAuth token. There is no service sender, and that is load-bearing rather than
// incidental: it means an unattended job CANNOT send, so "draft, never autosend"
// is enforced by the architecture and not only by discipline. Do not add a
// service-account sender to make cron able to email.
//
// Volume note from docs/04-DRAFT-QUEUE.md: past roughly 50–100 sends a week,
// move to a dedicated domain with SPF/DKIM/DMARC. Personal mailbox reputation
// degrades quickly under automated volume and takes genuine correspondence with
// it.

export interface SendResult {
  ok:        boolean;
  messageId?: string;
  threadId?:  string;
  error?:     string;
  /** True when the fix is for the user to sign out and back in. */
  needsReauth?: boolean;
}

export interface SendInput {
  from:     string;
  to:       string;
  subject:  string;
  body:     string;
  bcc?:     string;
  replyTo?: string;
}

export function buildMime(i: SendInput): string {
  const nl = "\r\n";
  const headers = [
    `From: ${i.from}`,
    `To: ${i.to}`,
    `Subject: ${i.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  if (i.bcc)     headers.push(`Bcc: ${i.bcc}`);
  if (i.replyTo) headers.push(`Reply-To: ${i.replyTo}`);
  return [...headers, "", i.body].join(nl);
}

export async function sendAsUser(userEmail: string, input: Omit<SendInput, "from">): Promise<SendResult> {
  const oauth2 = await getGoogleCalendarClient(userEmail);
  if (!oauth2) {
    return {
      ok: false, needsReauth: true,
      error: "Gmail is not linked for this account — sign out and back in to grant email permission.",
    };
  }

  try {
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const raw   = Buffer.from(buildMime({ from: userEmail, ...input })).toString("base64url");
    const sent  = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return { ok: true, messageId: sent.data.id ?? undefined, threadId: sent.data.threadId ?? undefined };
  } catch (e) {
    const err = e as { message?: string; errors?: Array<{ message?: string }> };
    const detail = err?.errors?.[0]?.message ?? err?.message ?? "Gmail send failed";
    const scopeProblem = /insufficient authentication scopes|insufficient_scope/i.test(detail);
    return {
      ok: false,
      error: scopeProblem
        ? "Your Google session is missing the Gmail permission. Sign out and back in, then try again."
        : detail,
      needsReauth: scopeProblem,
    };
  }
}
