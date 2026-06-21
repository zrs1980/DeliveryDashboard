import { NextResponse } from "next/server";
import { fetchRecord } from "@/lib/netsuite";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const record = await fetchRecord("opportunity", parseInt(params.id));
    return NextResponse.json(record);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
