import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

const APP_URL = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// POST /api/portal/auth/invite
// Body: { email, customerNsId, customerName, projectNsIds: string[], projectNames: Record<string, string> }
// Sends a Supabase magic link to the customer and records the invitation
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email, customerNsId, customerName, projectNsIds, projectNames } = await req.json() as {
    email: string;
    customerNsId: string;
    customerName: string;
    projectNsIds: string[];
    projectNames: Record<string, string>;
  };

  if (!email || !customerNsId || !customerName || !projectNsIds?.length) {
    return NextResponse.json({ error: "email, customerNsId, customerName, projectNsIds required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();

  // Upsert project_portal_access rows for each project
  for (const pid of projectNsIds) {
    const { error } = await db.from("project_portal_access").upsert({
      customer_ns_id: customerNsId,
      project_ns_id:  pid,
      project_name:   projectNames?.[pid] ?? pid,
      invited_by:     session.user.name ?? session.user.email ?? "Staff",
    }, { onConflict: "customer_ns_id,project_ns_id" });
    if (error) console.error("[portal/invite] access upsert error:", error.message);
  }

  // Send Supabase magic link invite
  // This creates/invites the user in auth.users and sends the email
  const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
    type:       "magiclink",
    email,
    options: {
      redirectTo: `${APP_URL}/portal/auth/callback`,
      data: {
        customer_ns_id: customerNsId,
        customer_name:  customerName,
      },
    },
  });

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  // Record the invitation
  await db.from("portal_invitations").insert({
    email,
    customer_ns_id:  customerNsId,
    customer_name:   customerName,
    project_ns_ids:  projectNsIds,
    invited_by:      session.user.name ?? session.user.email ?? "Staff",
    status:          "pending",
  });

  return NextResponse.json({ ok: true, email, link: linkData?.properties?.action_link });
}
