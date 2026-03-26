import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getGoogleCalendarClient } from "@/lib/google-tokens";
import { google } from "googleapis";

export const revalidate = 0;

export interface PTORequest {
  id: string;
  employee_email: string;
  employee_name: string;
  employee_ns_id: number | null;
  type: "pto" | "sick";
  start_date: string;
  end_date: string;
  hours: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewer_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

function fmtDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

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
    // Non-fatal — request is saved regardless
  }
}

// ─── GET /api/pto-requests — current user's requests ──────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();

  // Zabe sees all pending requests; everyone else sees their own
  const isApprover = session.user.email.toLowerCase() === "zabe@cebasolutions.com";

  const query = isApprover
    ? sb.from("pto_requests").select("*").order("submitted_at", { ascending: false })
    : sb.from("pto_requests").select("*").eq("employee_email", session.user.email).order("submitted_at", { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data ?? [], isApprover });
}

// ─── POST /api/pto-requests — submit a new request ────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { type, start_date, end_date, hours, reason } = body;

  if (!type || !start_date || !end_date || !hours) {
    return NextResponse.json({ error: "type, start_date, end_date, and hours are required" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("pto_requests")
    .insert({
      employee_email: session.user.email,
      employee_name:  session.user.name ?? session.user.email,
      type,
      start_date,
      end_date,
      hours: parseFloat(hours),
      reason: reason || null,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send notification email to approver
  const appUrl  = process.env.NEXTAUTH_URL ?? "https://delivery-dashboard.vercel.app";
  const approveUrl = `${appUrl}/api/pto-requests/${data.id}/review?action=approve&token=${data.approval_token}`;
  const rejectUrl  = `${appUrl}/api/pto-requests/${data.id}/review?action=reject&token=${data.approval_token}`;
  const typeLabel  = type === "pto" ? "PTO" : "Sick Leave";

  const emailBody = [
    `${session.user.name ?? session.user.email} has submitted a time off request.`,
    "",
    `Type:     ${typeLabel}`,
    `Dates:    ${fmtDate(start_date)} → ${fmtDate(end_date)}`,
    `Hours:    ${hours}h`,
    `Reason:   ${reason || "Not provided"}`,
    "",
    `APPROVE: ${approveUrl}`,
    "",
    `REJECT:  ${rejectUrl}`,
    "",
    "Or log in to the dashboard (My Leave tab) to review all pending requests.",
  ].join("\n");

  await sendEmail(
    session.user.email,
    "zabe@cebasolutions.com",
    `PTO Request — ${session.user.name ?? session.user.email} — ${fmtDate(start_date)} to ${fmtDate(end_date)}`,
    emailBody,
  );

  return NextResponse.json({ request: data });
}
