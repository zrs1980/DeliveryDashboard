import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("pm_projects").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const update: Record<string, unknown> = {};
  if (body.name        !== undefined) update.name         = body.name;
  if (body.clientName  !== undefined) update.client_name  = body.clientName;
  if (body.projectType !== undefined) update.project_type = body.projectType;
  if (body.pmName      !== undefined) update.pm_name      = body.pmName;
  if (body.goLiveDate  !== undefined) update.go_live_date = body.goLiveDate || null;
  if (body.budgetHours !== undefined) update.budget_hours = body.budgetHours ? parseFloat(body.budgetHours) : null;
  if (body.description !== undefined) update.description  = body.description;
  if (body.status      !== undefined) update.status       = body.status;

  const db = getSupabaseAdmin();
  const { data, error } = await db.from("pm_projects").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getSupabaseAdmin();
  // Soft delete — archive rather than destroy
  const { error } = await db.from("pm_projects").update({ status: "archived" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
