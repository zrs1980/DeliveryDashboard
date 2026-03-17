import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sb = getSupabaseAdmin();

  const { data, error } = await sb
    .from("wiki_pages")
    .select("id, title, slug, body, category_id, author, is_pinned, created_at, updated_at, wiki_categories(id, name, slug)")
    .eq("slug", slug)
    .single();

  if (error) return NextResponse.json({ error: "Page not found" }, { status: 404 });
  return NextResponse.json({ page: data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sb = getSupabaseAdmin();
  const body = await req.json();

  const { data, error } = await sb
    .from("wiki_pages")
    .update({
      title:       body.title?.trim(),
      body:        body.content ?? "",
      category_id: body.category_id ?? null,
      author:      body.author?.trim() || "CEBA Staff",
      is_pinned:   body.is_pinned ?? false,
    })
    .eq("slug", slug)
    .select("id, title, slug, body, category_id, author, is_pinned, created_at, updated_at, wiki_categories(id, name, slug)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ page: data });
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sb = getSupabaseAdmin();

  const { error } = await sb.from("wiki_pages").delete().eq("slug", slug);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
