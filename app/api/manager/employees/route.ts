import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQLAll } from "@/lib/netsuite";
import { PTO_APPROVER_EMAILS } from "@/lib/constants";

export const revalidate = 0;

export async function GET() {
  const session = await auth();
  const email   = session?.user?.email?.toLowerCase();
  if (!email || !PTO_APPROVER_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await runSuiteQLAll<{
      id: string;
      firstname: string;
      lastname: string;
      custentity10: string | null;
    }>(
      `SELECT id, firstname, lastname, custentity10 FROM employee WHERE isinactive = 'F' ORDER BY lastname, firstname`
    );

    return NextResponse.json({
      employees: rows.map(r => ({
        nsId: parseInt(r.id),
        name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(),
        custentity10_raw: r.custentity10,
      })),
      count: rows.length,
      _debug: true,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), employees: [], _debug: true }, { status: 500 });
  }
}
