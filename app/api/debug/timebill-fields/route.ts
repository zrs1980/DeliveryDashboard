import { NextResponse } from "next/server";
import { runSuiteQLAll } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

export const revalidate = 0;

// Diagnostic: fetch one recent timebill row and try potential type fields
export async function GET() {
  const empList = Object.keys(EMPLOYEES).join(", ");

  const results: Record<string, unknown> = {};

  // Try each potential type field independently
  const candidates = [
    { name: "typeofwork",    q: `SELECT tb.id, tb.typeofwork FROM timebill tb WHERE tb.employee IN (${empList}) ORDER BY tb.id DESC` },
    { name: "timetype",      q: `SELECT tb.id, tb.timetype FROM timebill tb WHERE tb.employee IN (${empList}) ORDER BY tb.id DESC` },
    { name: "timeentrytype", q: `SELECT tb.id, tb.timeentrytype FROM timebill tb WHERE tb.employee IN (${empList}) ORDER BY tb.id DESC` },
    { name: "type_display",  q: `SELECT tb.id, BUILTIN.DF(tb.typeofwork) AS type_display FROM timebill tb WHERE tb.employee IN (${empList}) ORDER BY tb.id DESC` },
  ];

  for (const c of candidates) {
    try {
      const rows = await runSuiteQLAll<Record<string, string>>(c.q + ` FETCH FIRST 3 ROWS ONLY`);
      results[c.name] = { ok: true, sample: rows };
    } catch (e) {
      results[c.name] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json(results);
}
