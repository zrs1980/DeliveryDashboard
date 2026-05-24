import { NextResponse } from "next/server";
import { fetchFieldSelectOptions } from "@/lib/netsuite";

export const revalidate = 0;

export async function GET() {
  try {
    const options = await fetchFieldSelectOptions("projecttask", "constrainttype");
    return NextResponse.json({ options });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
