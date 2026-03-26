import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ─── GET /api/pto-requests/[id]/review?action=approve|reject&token=... ─────────
// One-click approve/reject from email link — no login required, secured by token

function page(title: string, message: string, color: string) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #EEF1F5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 14px; padding: 40px 48px; box-shadow: 0 8px 32px rgba(0,0,0,0.1); text-align: center; max-width: 480px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 800; color: #0D1117; margin: 0 0 10px; }
    p { font-size: 14px; color: #4A5568; line-height: 1.6; margin: 0 0 24px; }
    a { display: inline-block; background: #1A56DB; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 13px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${color === "green" ? "✅" : color === "red" ? "❌" : "⚠️"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${process.env.NEXTAUTH_URL ?? "/"}">Go to Dashboard</a>
  </div>
</body>
</html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id }   = await params;
  const action   = req.nextUrl.searchParams.get("action");
  const token    = req.nextUrl.searchParams.get("token");

  if (action !== "approve" && action !== "reject") {
    return page("Invalid Action", "The link you followed is not valid.", "warn");
  }

  const sb = getSupabaseAdmin();
  const { data: request, error } = await sb
    .from("pto_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !request) {
    return page("Request Not Found", "This leave request could not be found.", "warn");
  }

  if (request.approval_token !== token) {
    return page("Invalid Token", "The approval link is invalid or has expired.", "warn");
  }

  if (request.status !== "pending") {
    const already = request.status === "approved" ? "already been approved" : "already been rejected";
    return page("Already Reviewed", `This request has ${already}.`, "warn");
  }

  const status = action === "approve" ? "approved" : "rejected";
  const { error: updateError } = await sb
    .from("pto_requests")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: "zabe@cebasolutions.com",
    })
    .eq("id", id);

  if (updateError) {
    return page("Error", "Failed to update the request. Please try from the dashboard.", "warn");
  }

  const typeLabel = request.type === "pto" ? "PTO" : "Sick Leave";
  const name      = request.employee_name;

  if (status === "approved") {
    return page(
      "Request Approved",
      `You have approved ${name}'s ${typeLabel} request (${request.hours}h). They will be notified.`,
      "green"
    );
  } else {
    return page(
      "Request Rejected",
      `You have rejected ${name}'s ${typeLabel} request. They will be notified via the dashboard.`,
      "red"
    );
  }
}
