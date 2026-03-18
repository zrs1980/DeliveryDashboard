import { NextRequest, NextResponse } from "next/server";
import { patchRecord } from "@/lib/netsuite";

export async function POST(req: NextRequest) {
  try {
    const { opportunityId, employeeId } = await req.json();
    if (!opportunityId) {
      return NextResponse.json({ error: "opportunityId is required" }, { status: 400 });
    }

    await patchRecord("opportunity", parseInt(opportunityId), {
      custbody10: employeeId ? { id: String(employeeId) } : null,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
