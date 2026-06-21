import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export async function GET() {
  try {
    const rows = await runSuiteQL(`
      SELECT t.id, t.tranId, t.title,
             t.custbody_ceba_sales_pipeline,
             t.custbody_sr_indentified_by
      FROM transaction t
      WHERE t.type = 'Opprtnty'
      AND t.custbody_sr_indentified_by IS NOT NULL
      ORDER BY t.expectedCloseDate ASC
    `);
    return NextResponse.json({ rows, total: (rows as any[]).length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
