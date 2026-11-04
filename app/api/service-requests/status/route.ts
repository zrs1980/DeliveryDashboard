import { NextRequest, NextResponse } from "next/server";
import { runSuiteQL, runSuiteQLAll, patchRecord } from "@/lib/netsuite";

export const revalidate = 0;

/**
 * Status of a service request — which IS the opportunity's `entitystatus`.
 *
 *   GET   → the statuses an opportunity can take, for the dropdown
 *   PATCH { opportunityId, statusId } → set it in NetSuite
 *
 * Opportunities take PROSPECT and CUSTOMER statuses ("Closed Won" is a customer
 * status). The same table the retired CRM sync read; see git history (cfc6498).
 */

interface StatusRow {
  key:         string;
  name:        string | null;
  entitytype:  string | null;
  inactive:    string | null;
}

/** NetSuite names stages "10 - Coordinate Discovery"; the leading number is the order. */
function leadNumber(name: string): number {
  const m = name.match(/^\s*(\d+)\s*-/);
  return m ? parseInt(m[1]) : Number.MAX_SAFE_INTEGER;
}

export async function GET() {
  try {
    const rows = await runSuiteQLAll<StatusRow>(`
      SELECT key, name, entitytype, inactive FROM entitystatus
    `);
    const statuses = rows
      .filter(r => ["PROSPECT", "CUSTOMER"].includes(String(r.entitytype ?? "").toUpperCase()))
      .filter(r => r.inactive !== "T")
      .map(r => ({ id: String(r.key), label: (r.name ?? "").trim() || `Status ${r.key}` }))
      .sort((a, b) => leadNumber(a.label) - leadNumber(b.label) || a.label.localeCompare(b.label));
    return NextResponse.json({ statuses });
  } catch (e) {
    console.error("[GET /api/service-requests/status]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { opportunityId, statusId } = await req.json() as { opportunityId?: unknown; statusId?: unknown };
    const oppId = Number(opportunityId);
    const sid   = String(statusId ?? "");
    if (!Number.isInteger(oppId) || oppId <= 0) {
      return NextResponse.json({ error: "opportunityId is required" }, { status: 400 });
    }
    if (!/^\d+$/.test(sid)) {
      return NextResponse.json({ error: "statusId must be a NetSuite status id" }, { status: 400 });
    }

    await patchRecord("opportunity", oppId, { entityStatus: { id: sid } });

    // Read back what NetSuite now holds rather than echoing the request: the label
    // the list shows comes from BUILTIN.DF, and NetSuite may move probability with
    // the status. Non-fatal — the write already happened.
    let after: { statusLabel: string | null; probability: number | null } = { statusLabel: null, probability: null };
    try {
      const rows = await runSuiteQL<{ label: string | null; probability: string | null }>(`
        SELECT BUILTIN.DF(t.entitystatus) AS label, t.probability
        FROM transaction t WHERE t.id = ?
      `, [oppId]);
      if (rows[0]) {
        after = {
          statusLabel: rows[0].label ?? null,
          probability: rows[0].probability != null ? parseFloat(rows[0].probability) : null,
        };
      }
    } catch (e) {
      console.error("[PATCH /api/service-requests/status] read-back failed:", e);
    }

    return NextResponse.json({ ok: true, statusId: sid, ...after });
  } catch (e) {
    console.error("[PATCH /api/service-requests/status]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
