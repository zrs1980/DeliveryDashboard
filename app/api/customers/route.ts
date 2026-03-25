import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export const revalidate = 0;

export interface NSCustomer {
  id: number;
  entityid: string;
  companyname: string;
  email: string | null;
  phone: string | null;
}

export async function GET() {
  try {
    const rows = await runSuiteQL<{
      id: string; entityid: string; companyname: string | null;
      email: string | null; phone: string | null;
    }>(`
      SELECT id, entityid, companyname, email, phone
      FROM customer
      WHERE isinactive = 'F'
        AND entitystatus = 13
      ORDER BY companyname ASC
    `);

    const customers: NSCustomer[] = (rows ?? [])
      .map(r => ({
        id:          parseInt(r.id),
        entityid:    r.entityid ?? "",
        companyname: r.companyname || r.entityid || String(r.id),
        email:       r.email  ?? null,
        phone:       r.phone  ?? null,
      }))
      .filter(c => c.companyname);

    return NextResponse.json({ customers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
