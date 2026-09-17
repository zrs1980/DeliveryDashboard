import { NextResponse } from "next/server";
import { getConsultantRoster } from "@/lib/roster";

export const revalidate = 0;

export interface NsEmployee {
  id: number;
  name: string;
}

/** Assignable consultants, live from NetSuite — custentity10 IN (1, 2). */
export async function GET() {
  const roster = await getConsultantRoster();

  const employees: NsEmployee[] = roster.members
    .map(m => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ employees, rosterFallback: roster.fallback });
}
