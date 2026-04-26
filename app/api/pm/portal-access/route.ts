import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

// GET /api/pm/portal-access?projectId=18380
// Returns all customer users with access to a project — staff only
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data: access, error } = await db
    .from("project_portal_access")
    .select("*, customer_portal_users(email, display_name)")
    .eq("project_ns_id", projectId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ access: access ?? [] });
}

// POST /api/pm/portal-access
// Grant a customer user access to a project (after they've been invited)
// Body: { customerNsId, projectNsId, projectName }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { customerNsId, projectNsId, projectName } = await req.json();
  if (!customerNsId || !projectNsId || !projectName) {
    return NextResponse.json({ error: "customerNsId, projectNsId, projectName required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from("project_portal_access").upsert({
    customer_ns_id: customerNsId,
    project_ns_id:  projectNsId,
    project_name:   projectName,
    invited_by:     session.user.name ?? session.user.email ?? "Staff",
  }, { onConflict: "customer_ns_id,project_ns_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/pm/portal-access?customerNsId=xxx&projectNsId=yyy
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customerNsId = req.nextUrl.searchParams.get("customerNsId");
  const projectNsId  = req.nextUrl.searchParams.get("projectNsId");
  if (!customerNsId || !projectNsId) {
    return NextResponse.json({ error: "customerNsId and projectNsId required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from("project_portal_access")
    .delete()
    .eq("customer_ns_id", customerNsId)
    .eq("project_ns_id", projectNsId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
