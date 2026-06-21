import { NextResponse } from "next/server";
import { fetchRecord } from "@/lib/netsuite";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const record = await fetchRecord("opportunity", parseInt(id));
    return NextResponse.json(record);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
