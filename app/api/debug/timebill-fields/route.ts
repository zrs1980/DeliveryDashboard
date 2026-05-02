import { NextResponse } from "next/server";
import { runSuiteQLAll } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

export const revalidate = 0;

export async function GET() {
  const empList = Object.keys(EMPLOYEES).join(", ");
  const results: Record<string, unknown> = {};

  // Check what values casetaskevent actually holds — NS serializes NULL refs as "0" in JSON
  try {
    const rows = await runSuiteQLAll<Record<string, string>>(`
      SELECT tb.id, tb.casetaskevent, tb.customer
      FROM timebill tb
      WHERE tb.employee IN (${empList}) AND tb.timetype = 'A'
      ORDER BY tb.id DESC
    `);
    const nonZero = rows.filter(r => r.casetaskevent && r.casetaskevent !== "0");
    const zero    = rows.filter(r => !r.casetaskevent || r.casetaskevent === "0");
    results.casetaskevent = {
      ok: true,
      totalRows: rows.length,
      nonZeroCount: nonZero.length,
      zeroOrNullCount: zero.length,
      nonZeroSamples: nonZero.slice(0, 5),
      zeroSamples: zero.slice(0, 3),
    };
  } catch (e) {
    results.casetaskevent = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}
