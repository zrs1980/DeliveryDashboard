import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST() {
  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from("healthchecks")
    .delete({ count: "exact" })
    .neq("id", "00000000-0000-0000-0000-000000000000"); // match all rows

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: count });
}
