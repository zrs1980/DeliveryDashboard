import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getActiveStaff, getConsultantRoster, getPmRoster } from "@/lib/roster";

export const revalidate = 0;
export const maxDuration = 30;

/**
 * The roster, for client components that used to import the hardcoded EMPLOYEES
 * map. `?category=consultants` (custentity10 IN 1,2) · `pms` · `all` (default).
 *
 * `rosterFallback: true` means NetSuite could not be reached and these names came
 * from the constants in lib/constants.ts — show them, but do not trust them.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const category = (req.nextUrl.searchParams.get("category") ?? "all").toLowerCase();

  const roster =
    category === "consultants" ? await getConsultantRoster() :
    category === "pms"         ? await getPmRoster() :
                                 await getActiveStaff();

  return NextResponse.json({
    employees: roster.members.map(m => ({
      id:                m.id,
      name:              m.name,
      email:             m.email,
      category:          m.category,
      employeeType:      m.employeeType,
      targetUtilization: m.targetUtilization,
    })),
    rosterFallback: roster.fallback,
  });
}
