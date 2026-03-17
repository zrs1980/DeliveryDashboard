import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("wiki_categories")
    .select("id, name, slug, parent_id, icon")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build nested tree
  const map = new Map<number, any>();
  const roots: any[] = [];

  (data ?? []).forEach(c => map.set(c.id, { ...c, children: [] }));
  (data ?? []).forEach(c => {
    if (c.parent_id != null && map.has(c.parent_id)) {
      map.get(c.parent_id).children.push(map.get(c.id));
    } else {
      roots.push(map.get(c.id));
    }
  });

  return NextResponse.json({ categories: roots });
}

export async function POST(req: NextRequest) {
  const sb = getSupabaseAdmin();
  const body = await req.json();
  const { name, slug, parent_id, icon } = body;

  if (!name?.trim() || !slug?.trim()) {
    return NextResponse.json({ error: "name and slug are required" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("wiki_categories")
    .insert({
      name:      name.trim(),
      slug:      slug.trim(),
      parent_id: parent_id ?? null,
      icon:      icon ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data }, { status: 201 });
}
