import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PROCESSING_COLUMNS, type ProcessingRow } from "@/lib/meeting-processing";

export const revalidate = 0;

/**
 * GET /api/meetings/processing?ids=a,b,c
 *
 * What the Process wizard already did to each of these meetings, keyed by
 * Fireflies id. One request per grid load.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean);

  try {
    const db = getSupabaseAdmin();
    let query = db.from("meeting_processing").select(PROCESSING_COLUMNS);
    if (ids.length > 0) query = query.in("fireflies_id", ids);

    const { data, error } = await query;
    if (error) {
      // A missing table must not break the grid — but unlike the old code it is
      // no longer swallowed, because "everything looks unprocessed forever" with
      // no explanation is exactly the failure this endpoint exists to prevent.
      console.error("[/api/meetings/processing]", error.message);
      return NextResponse.json({
        processing: {},
        warning: /does not exist|schema cache|relation/i.test(error.message)
          ? "Processing history is unavailable: the meeting_processing table is missing. Run supabase/meeting-processing-schema.sql in the Supabase SQL editor — until then every meeting will look unprocessed after a refresh."
          : `Processing history could not be read: ${error.message}`,
      });
    }

    const processing: Record<string, ProcessingRow> = {};
    for (const row of (data ?? []) as unknown as ProcessingRow[]) {
      processing[row.fireflies_id] = row;
    }
    return NextResponse.json({ processing });
  } catch (err) {
    console.error("[/api/meetings/processing]", err);
    return NextResponse.json({
      processing: {},
      warning: `Processing history could not be read: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }
}
