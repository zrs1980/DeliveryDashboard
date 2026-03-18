import { NextResponse } from "next/server";
import { EMPLOYEES } from "@/lib/constants";

export interface NsEmployee {
  id: number;
  name: string;
}

export async function GET() {
  const employees: NsEmployee[] = Object.entries(EMPLOYEES)
    .map(([id, name]) => ({ id: parseInt(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ employees });
}
