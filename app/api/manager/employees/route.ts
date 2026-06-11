import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getActiveJobResources } from "@/lib/netsuite";
import { PTO_APPROVER_EMAILS } from "@/lib/constants";

export const revalidate = 0;

export async function GET() {
  const session = await auth();
  const email   = session?.user?.email?.toLowerCase();
  if (!email || !PTO_APPROVER_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allEmployees = await getActiveJobResources();

  // Debug: return all employees with their raw custentity10 value
  const all = Object.entries(allEmployees)
    .map(([id, emp]) => ({ nsId: parseInt(id), name: emp.name, category: emp.department, employeeType: emp.employeeType }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ employees: all, _debug: true });
}
