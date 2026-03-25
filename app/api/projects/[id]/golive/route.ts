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

    // NetSuite REST Record API expects ISO 8601 YYYY-MM-DD for LocalDate fields.
    // The date input already provides this format; pass it through directly.
    await patchRecord("job", projectId, {
      custentity_project_golive_date: date ?? null,
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
