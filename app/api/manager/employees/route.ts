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

  const consultants = Object.entries(allEmployees)
    .filter(([, emp]) => emp.department.toLowerCase() === "consultant")
    .map(([id, emp]) => ({ nsId: parseInt(id), name: emp.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ employees: consultants });
}
