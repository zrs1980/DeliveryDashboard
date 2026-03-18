import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export interface NsEmployee {
  id: number;
  name: string;
}

export async function GET() {
  try {
    const rows = await runSuiteQL<{ id: string; firstname: string; lastname: string }>(`
      SELECT id, firstname, lastname
      FROM employee
      WHERE isinactive = 'F'
      ORDER BY lastname ASC, firstname ASC
    `);

    const employees: NsEmployee[] = (rows ?? []).map((r: any) => ({
      id:   parseInt(r.id),
      name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(),
    }));

    return NextResponse.json({ employees });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg, employees: [] }, { status: 500 });
  }
}
