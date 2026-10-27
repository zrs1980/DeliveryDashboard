import { NextRequest, NextResponse } from "next/server";
import { patchRecord, deleteRecord } from "@/lib/netsuite";

// Setting a week to 0h removes it from the allocation rather than writing a 0%
// record; when the allocation covers only that week, the record itself goes.
export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    await deleteRecord("resourceallocation", parseInt(id));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/resources/[id]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const body = await req.json() as {
      percentOfTime?: number;
      startDate?: string;   // YYYY-MM-DD
      endDate?: string;     // YYYY-MM-DD
    };

    const fields: Record<string, unknown> = {};

    if (body.percentOfTime !== undefined) {
      fields.allocationUnit   = { id: "P" };
      fields.allocationAmount = body.percentOfTime;
    }
    if (body.startDate !== undefined) fields.startDate = body.startDate;
    if (body.endDate   !== undefined) fields.endDate   = body.endDate;

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    await patchRecord("resourceallocation", parseInt(id), fields);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PATCH /api/resources/[id]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
