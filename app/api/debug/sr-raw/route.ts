import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export async function GET() {
  try {
    const rows = await runSuiteQL(`
      SELECT t.id, t.tranId, t.title, t.entity, t.probability,
             t.projectedTotal, t.expectedCloseDate, t.tranDate,
             t.lastModifiedDate, t.daysOpen, t.memo, t.actionItem,
             t.custbody10, t.custbody9,
             t.entitystatus AS entitystatus_label,
             t.custbody_ceba_sales_pipeline AS identified_by_raw,
             t.custbody_sr_indentified_by AS sr_identified_raw,
             t.custbody_ceba_sales_pipeline AS sales_pipeline_raw,
             t.custbody_sr_indentified_by AS sr_identified_id
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
