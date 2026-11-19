import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

/** PATCH { date: "YYYY-MM-DD" | null } → custentity_loop_kickoff_date on the job. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    const { date } = await req.json() as { date: string | null };

    if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD or null" }, { status: 400 });
    }

    await patchRecord("job", projectId, {
      custentity_loop_kickoff_date: date ?? null,
    });

    return NextResponse.json({ kickoffDate: date ?? null });
  } catch (err) {
    console.error("[/api/projects/[id]/kickoff]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
