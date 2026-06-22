import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

// custbody_ceba_sales_pipeline raw list ID → display label
const IDENTIFIED_BY: Record<string, string> = {
  "1": "Active",
  "2": "Nurturing",
};

export interface ServiceRequest {
  id: number;
  tranId: string;
  title: string;
  client: string;
  entityId: number;
  email: string | null;
  probability: number;
  projectedTotal: number;
  weightedTotal: number;
  expectedCloseDate: string | null;
  createdDate: string;
  lastActivityDate: string | null;
  daysOpen: number;
  assignedTo: string | null;
  assignedToId: number | null;
  statusLabel: string | null;
  memo: string | null;
  actionItem: string | null;
  noteCount: number;
  nsUrl: string;
  salesNotes: string | null;
  customerFolder: string | null;
  identifiedBy: string | null;    // custbody_ceba_sales_pipeline via BUILTIN.DF
  srIdentifiedBy: string | null;  // custbody_sr_indentified_by via BUILTIN.DF
  salesPipelineRaw: string | null; // custbody_ceba_sales_pipeline raw integer
  srIdentifiedId: string | null;   // custbody_sr_indentified_by raw integer
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // Accept "Active" or "Nurture" label; map to raw list ID for SQL filter
  const labelFilter = searchParams.get("identifiedBy"); // "Active" | "Nurture"
  const rawIdFilter = Object.entries(IDENTIFIED_BY).find(([, v]) => v === labelFilter)?.[0];

  try {
    const oppsResult = await runSuiteQL(`
      SELECT t.id, t.tranId, t.title, t.entity, t.probability,
             t.projectedTotal, t.expectedCloseDate, t.tranDate,
             t.lastModifiedDate, t.daysOpen, t.memo, t.actionItem,
             t.custbody10, t.custbody9,
             BUILTIN.DF(t.entitystatus) AS entitystatus_label,
             t.custbody_ceba_sales_pipeline AS identified_by_raw,
             t.custbody_sr_indentified_by AS sr_identified_raw,
             t.custbody_ceba_sales_pipeline AS sales_pipeline_raw,
             t.custbody_sr_indentified_by AS sr_identified_id
      FROM transaction t
      WHERE t.type = 'Opprtnty'
      AND t.custbody_sr_indentified_by IS NOT NULL
      AND t.entitystatus <> 14
      ${rawIdFilter ? `AND t.custbody_ceba_sales_pipeline = ${rawIdFilter}` : ""}
      ORDER BY t.expectedCloseDate ASC
    `);

    if (!oppsResult || !Array.isArray(oppsResult)) {
      return NextResponse.json({ requests: [] });
    }

    const oppIds    = oppsResult.map((r: any) => parseInt(r.id));
    const entityIds = [...new Set(oppsResult.map((r: any) => r.entity).filter(Boolean))] as number[];

    // Customer names + emails
    const clientMap: Record<number, { name: string; email: string | null; customerFolder: string | null }> = {};
    if (entityIds.length > 0) {
      const custResult = await runSuiteQL(`
        SELECT id, companyname, email, custentity_customer_folder FROM customer WHERE id IN (${entityIds.join(",")})
      `);
      if (Array.isArray(custResult)) {
        for (const c of custResult as any[]) {
          clientMap[c.id] = { name: c.companyname ?? String(c.id), email: c.email ?? null, customerFolder: c.custentity_customer_folder ?? null };
        }
      }
    }

    // Note counts per opportunity
    const noteCountMap: Record<number, number> = {};
    if (oppIds.length > 0) {
      const noteResult = await runSuiteQL(`
        SELECT n.transaction, COUNT(n.id) AS note_count
        FROM note n
        WHERE n.transaction IN (${oppIds.join(",")})
        GROUP BY n.transaction
      `);
      if (Array.isArray(noteResult)) {
        for (const n of noteResult as any[]) {
          noteCountMap[parseInt(n.transaction)] = parseInt(n.note_count ?? "0");
        }
      }
    }

    const requests: ServiceRequest[] = oppsResult.map((r: any) => {
      const prob      = parseFloat(r.probability ?? "0");
      const projected = parseFloat(r.projectedtotal ?? "0");
      const cust      = clientMap[r.entity];
      const assignedToId = r.custbody10 ? parseInt(r.custbody10) : null;
      return {
        id:                parseInt(r.id),
        tranId:            r.tranid ?? "",
        title:             r.title ?? "(Untitled)",
        client:            cust?.name ?? `Entity ${r.entity}`,
        entityId:          r.entity,
        email:             cust?.email ?? null,
        probability:       prob,
        projectedTotal:    projected,
        weightedTotal:     Math.round(projected * prob),
        expectedCloseDate: r.expectedclosedate ?? null,
        createdDate:       r.trandate ?? "",
        lastActivityDate:  r.lastmodifieddate ?? null,
        daysOpen:          parseInt(r.daysopen ?? "0"),
        assignedTo:        assignedToId ? (EMPLOYEES[assignedToId] ?? null) : null,
        assignedToId:      assignedToId,
        statusLabel:       r.entitystatus_label ?? null,
        memo:              r.memo ?? null,
        actionItem:        r.actionitem ?? null,
        noteCount:         noteCountMap[parseInt(r.id)] ?? 0,
        nsUrl:             `https://3550424.app.netsuite.com/app/accounting/transactions/opprtnty.nl?id=${r.id}`,
        salesNotes:        r.custbody9 ?? null,
        customerFolder:    cust?.customerFolder ?? null,
        identifiedBy:      r.identified_by_raw ?? null,
        srIdentifiedBy:    r.sr_identified_raw ?? null,
        salesPipelineRaw:  r.sales_pipeline_raw ?? null,
        srIdentifiedId:    r.sr_identified_id ?? null,
      };
    });

    return NextResponse.json({ requests, total: requests.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
