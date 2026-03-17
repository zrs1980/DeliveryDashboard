import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q) return NextResponse.json({ results: [] });

  const sb = getSupabaseAdmin();

  // Try FTS first, fall back to ilike if fts column not yet set up
  const { data, error } = await sb
    .from("wiki_pages")
    .select("id, title, slug, body, author, updated_at, wiki_categories(name)")
    .textSearch("fts", q, { type: "websearch", config: "english" })
    .limit(20);

  if (!error) return NextResponse.json({ results: data ?? [] });

  // Fallback: simple ilike search
  const { data: fallback } = await sb
    .from("wiki_pages")
    .select("id, title, slug, body, author, updated_at, wiki_categories(name)")
    .or(`title.ilike.%${q}%,body.ilike.%${q}%,author.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ results: fallback ?? [] });
}
