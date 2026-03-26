import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getGoogleCalendarClient } from "@/lib/google-tokens";
import { google } from "googleapis";

function buildMime(from: string, to: string, subject: string, body: string): string {
  const nl = "\r\n";
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].join(nl);
}

async function sendEmail(userEmail: string, to: string, subject: string, body: string) {
  try {
    const oauth2 = await getGoogleCalendarClient(userEmail);
    if (!oauth2) return;
    const gmail  = google.gmail({ version: "v1", auth: oauth2 });
    const raw    = Buffer.from(buildMime(userEmail, to, subject, body)).toString("base64url");
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  } catch {
    // Non-fatal
  }
}

function fmtDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── PATCH /api/pto-requests/[id] — approve or reject ────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (session.user.email.toLowerCase() !== "zabe@cebasolutions.com") {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const { id } = await params;
  const { status, reviewer_notes } = await req.json();

  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "status must be 'approved' or 'rejected'" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("pto_requests")
    .update({
      status,
      reviewer_notes: reviewer_notes || null,
      reviewed_at:    new Date().toISOString(),
      reviewed_by:    session.user.name ?? session.user.email,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify the employee
  const typeLabel   = data.type === "pto" ? "PTO" : "Sick Leave";
  const statusLabel = status === "approved" ? "Approved ✅" : "Rejected ❌";

  const emailBody = [
    `Your ${typeLabel} request has been ${status}.`,
    "",
    `Type:     ${typeLabel}`,
    `Dates:    ${fmtDate(data.start_date)} → ${fmtDate(data.end_date)}`,
    `Hours:    ${data.hours}h`,
    ...(reviewer_notes ? [`Notes:    ${reviewer_notes}`] : []),
    "",
    status === "approved"
      ? "Please remember to log this time in NetSuite once it occurs."
      : "Please reach out to Zabe if you have any questions.",
  ].join("\n");

  await sendEmail(
    session.user.email,
    data.employee_email,
    `Time Off Request ${statusLabel} — ${fmtDate(data.start_date)} to ${fmtDate(data.end_date)}`,
    emailBody,
  );

  return NextResponse.json({ request: data });
}
