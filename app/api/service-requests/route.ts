import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export interface ServiceRequest {
  id: number;
  tranId: string;
  title: string;
  client: string;
  entityId: number;
  probability: number;
  projectedTotal: number;
  weightedTotal: number;
  expectedCloseDate: string | null;
  createdDate: string;
  daysOpen: number;
  salesRep: string | null;
  memo: string | null;
  actionItem: string | null;
  nsUrl: string;
}

export async function GET() {
  try {
    // Fetch open opportunities (status = 'A')
    const oppsResult = await runSuiteQL(`
      SELECT o.id, o.tranId, o.title, o.entity, o.probability,
             o.projectedTotal, o.expectedCloseDate, o.tranDate,
             o.daysOpen, o.memo, o.actionItem, o.salesRep
      FROM opportunity o
      WHERE o.status = 'A'
      ORDER BY o.expectedCloseDate ASC
    `);

    if (!oppsResult || !Array.isArray(oppsResult)) {
      return NextResponse.json({ requests: [] });
    }

    // Collect unique entity IDs
    const entityIds = [...new Set(oppsResult.map((r: any) => r.entity).filter(Boolean))] as number[];

    // Fetch company names in one query
    const clientMap: Record<number, string> = {};
    if (entityIds.length > 0) {
      const inClause = entityIds.join(",");
      const custResult = await runSuiteQL(`
        SELECT id, companyname FROM customer WHERE id IN (${inClause})
      `);
      if (Array.isArray(custResult)) {
        for (const c of custResult as any[]) {
          clientMap[c.id] = c.companyname ?? String(c.id);
        }
      }
    }

    const requests: ServiceRequest[] = oppsResult.map((r: any) => {
      const prob = parseFloat(r.probability ?? "0");
      const projected = parseFloat(r.projectedtotal ?? "0");
      return {
        id:               parseInt(r.id),
        tranId:           r.tranid ?? "",
        title:            r.title ?? "(Untitled)",
        client:           clientMap[r.entity] ?? `Entity ${r.entity}`,
        entityId:         r.entity,
        probability:      prob,
        projectedTotal:   projected,
        weightedTotal:    Math.round(projected * prob),
        expectedCloseDate: r.expectedclosedate ?? null,
        createdDate:      r.trandate ?? "",
        daysOpen:         parseInt(r.daysopen ?? "0"),
        salesRep:         null,
        memo:             r.memo ?? null,
        actionItem:       r.actionitem ?? null,
        nsUrl:            `https://system.na1.netsuite.com/app/crm/sales/opportunity.nl?id=${r.id}`,
      };
    });

    return NextResponse.json({ requests, total: requests.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
