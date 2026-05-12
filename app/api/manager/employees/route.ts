import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL } from "@/lib/netsuite";

const MANAGER_EMAIL = "zabe@cebasolutions.com";

export interface EmployeeListItem {
  nsId:  number;
  name:  string;
  email: string;
}

export async function GET() {
  const session = await auth();
  const callerEmail = session?.user?.email?.toLowerCase();
  if (!callerEmail || callerEmail !== MANAGER_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await runSuiteQL<{
      id: string;
      firstname: string;
      lastname: string;
      email: string | null;
    }>(`
      SELECT id, firstname, lastname, email
      FROM employee
      WHERE isinactive = 'F'
        AND issupportrep = 'F'
      ORDER BY lastname, firstname
    `);

    const employees: EmployeeListItem[] = (rows ?? [])
      .filter(r => r.firstname || r.lastname)
      .map(r => ({
        nsId:  parseInt(r.id),
        name:  `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(),
        email: (r.email ?? "").toLowerCase(),
      }));

    return NextResponse.json({ employees });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
