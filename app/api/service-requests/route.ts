import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import { EMPLOYEES } from "@/lib/constants";

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
}

export async function GET() {
  try {
    const oppsResult = await runSuiteQL(`
      SELECT o.id, o.tranId, o.title, o.entity, o.probability,
             o.projectedTotal, o.expectedCloseDate, o.tranDate,
             o.lastModifiedDate, o.daysOpen, o.memo, o.actionItem,
             o.custbody10,
             o.entitystatus                            AS entitystatus_id,
             BUILTIN.DF(o.entitystatus)                AS status_label,
             o.status                                  AS status_code
      FROM opportunity o
      WHERE o.status = 'A'
      ORDER BY o.expectedCloseDate ASC
    `);

    if (!oppsResult || !Array.isArray(oppsResult)) {
      return NextResponse.json({ requests: [] });
    }

    const oppIds    = oppsResult.map((r: any) => parseInt(r.id));
    const entityIds = [...new Set(oppsResult.map((r: any) => r.entity).filter(Boolean))] as number[];

    // Customer names + emails
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
        statusLabel:       r.status_label ?? null,
        memo:              r.memo ?? null,
        actionItem:        r.actionitem ?? null,
        noteCount:         noteCountMap[parseInt(r.id)] ?? 0,
        nsUrl:             `https://3550424.app.netsuite.com/app/accounting/transactions/opprtnty.nl?id=${r.id}`,
      };
    });

    // Debug: show first record's raw status fields to help identify correct field
    const _debug = oppsResult[0] ? {
      entitystatus_id: (oppsResult[0] as any).entitystatus_id,
      status_label:    (oppsResult[0] as any).status_label,
      status_code:     (oppsResult[0] as any).status_code,
      allKeys:         Object.keys(oppsResult[0] as any),
    } : null;

    return NextResponse.json({ requests, total: requests.length, _debug });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
