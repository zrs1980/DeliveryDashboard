import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    const body = await req.json();

    const { date } = body as { date: string | null };

    // NetSuite REST Record API accepts MM/DD/YYYY for date fields.
    // If date is null/empty, we clear the field.
    let nsDate: string | null = null;
    if (date) {
      const d = new Date(date + "T00:00:00"); // parse as local date
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      nsDate = `${mm}/${dd}/${yyyy}`;
    }

    await patchRecord("job", projectId, {
      custentity_project_golive_date: nsDate,
    });

    return NextResponse.json({ goliveDate: date ?? null });
  } catch (err) {
    console.error("[/api/projects/[id]/golive]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
