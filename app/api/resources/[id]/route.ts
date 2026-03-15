import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const { percentOfTime } = await req.json();

    if (typeof percentOfTime !== "number" || percentOfTime < 0 || percentOfTime > 100) {
      return NextResponse.json({ error: "percentOfTime must be a number 0–100" }, { status: 400 });
    }

    await patchRecord("resourceallocation", parseInt(id), {
      allocationUnit:   { id: "P" },
      allocationAmount: percentOfTime,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PATCH /api/resources/[id]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
