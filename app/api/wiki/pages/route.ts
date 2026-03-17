import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sb = getSupabaseAdmin();
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const pinned   = searchParams.get("pinned");

  let query = sb
    .from("wiki_pages")
    .select("id, title, slug, body, category_id, author, is_pinned, created_at, updated_at, wiki_categories(id, name, slug)")
    .order("updated_at", { ascending: false });

  if (category) query = query.eq("category_id", parseInt(category));
  if (pinned === "true") query = query.eq("is_pinned", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ pages: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sb = getSupabaseAdmin();
  const body = await req.json();
  const { title, slug, content, category_id, author, is_pinned } = body;

  if (!title?.trim() || !slug?.trim()) {
    return NextResponse.json({ error: "title and slug are required" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("wiki_pages")
    .insert({
      title:       title.trim(),
      slug:        slug.trim(),
      body:        content ?? "",
      category_id: category_id ?? null,
      author:      author?.trim() || "CEBA Staff",
      is_pinned:   is_pinned ?? false,
    })
    .select("id, title, slug, body, category_id, author, is_pinned, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ page: data }, { status: 201 });
}
