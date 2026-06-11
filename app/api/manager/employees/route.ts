import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQLAll } from "@/lib/netsuite";
import { PTO_APPROVER_EMAILS } from "@/lib/constants";

export const revalidate = 0;

// custentity10 values that correspond to Consultant roles:
//   "1" = Consultant  (Rodrigo, Sam, Jason Tutanes)
//   "2" = Senior Consultant / PM  (Shai)
const CONSULTANT_CATEGORY_IDS = ["1", "2"];

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
    }>(
      `SELECT id, firstname, lastname FROM employee
       WHERE isinactive = 'F'
         AND custentity10 IN (${CONSULTANT_CATEGORY_IDS.map(v => `'${v}'`).join(", ")})
       ORDER BY lastname, firstname`
    );

    const employees = rows.map(r => ({
      nsId: parseInt(r.id),
      name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(),
    }));

    return NextResponse.json({ employees });
  } catch (e) {
    return NextResponse.json({ error: String(e), employees: [] }, { status: 500 });
  }
}
