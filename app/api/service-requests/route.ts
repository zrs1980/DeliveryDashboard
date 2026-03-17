import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

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
  lastModifiedDate: string | null;
  daysOpen: number;
  salesRep: string | null;
  memo: string | null;
  actionItem: string | null;
  noteCount: number;
  nsUrl: string;
}

export async function GET() {
  try {
    // Fetch open opportunities with lastModifiedDate
    const oppsResult = await runSuiteQL(`
      SELECT o.id, o.tranId, o.title, o.entity, o.probability,
             o.projectedTotal, o.expectedCloseDate, o.tranDate,
             o.lastModifiedDate, o.daysOpen, o.memo, o.actionItem
      FROM opportunity o
      WHERE o.status = 'A'
      ORDER BY o.expectedCloseDate ASC
    `);

    if (!oppsResult || !Array.isArray(oppsResult)) {
      return NextResponse.json({ requests: [] });
    }

    const oppIds    = oppsResult.map((r: any) => parseInt(r.id));
    const entityIds = [...new Set(oppsResult.map((r: any) => r.entity).filter(Boolean))] as number[];

    // Fetch customer names + emails in one query
    const clientMap: Record<number, { name: string; email: string | null }> = {};
    if (entityIds.length > 0) {
      const custResult = await runSuiteQL(`
        SELECT id, companyname, email FROM customer WHERE id IN (${entityIds.join(",")})
      `);
      if (Array.isArray(custResult)) {
        for (const c of custResult as any[]) {
          clientMap[c.id] = { name: c.companyname ?? String(c.id), email: c.email ?? null };
        }
      }
    }

    // Fetch note counts per opportunity
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
        lastModifiedDate:  r.lastmodifieddate ?? null,
        daysOpen:          parseInt(r.daysopen ?? "0"),
        salesRep:          null,
        memo:              r.memo ?? null,
        actionItem:        r.actionitem ?? null,
        noteCount:         noteCountMap[parseInt(r.id)] ?? 0,
        nsUrl:             `https://system.na1.netsuite.com/app/crm/sales/opportunity.nl?id=${r.id}`,
      };
    });

    return NextResponse.json({ requests, total: requests.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
