import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

export async function PATCH(req: NextRequest) {
  try {
    const { opportunityId, date } = await req.json();

    if (!opportunityId) {
      return NextResponse.json({ error: "opportunityId is required" }, { status: 400 });
    }

    // date must be YYYY-MM-DD or null to clear
    await patchRecord("opportunity", parseInt(opportunityId), {
      expectedclosedate: date ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
