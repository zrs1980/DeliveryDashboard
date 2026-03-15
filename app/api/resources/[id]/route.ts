import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

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
