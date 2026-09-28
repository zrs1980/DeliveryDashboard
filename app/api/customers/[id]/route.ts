import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasCsLayer } from "@/lib/cs-permissions";
import { resolveCustomerKey, fetchCustomerRecord } from "@/lib/customer-record";

export const revalidate  = 0;
export const maxDuration = 60;

/**
 * Everything this application knows about one customer.
 *
 * `id` may be a NetSuite customer id ("16650"), a local account key
 * ("local:<uuid>") or a `customers.id` uuid — the three things different
 * callers actually hold.
 *
 * ⚠ SESSION-GATED, NOT cs_layer-GATED — and the difference is in the RESPONSE,
 * not in the access check. Identity, people, deals, tasks, timeline, projects
 * and contracts are ordinary commercial work that PMs and consultants do. The
 * `cs` block — health score, band, open flags, profile, drafts — is attached
 * only for a reader who holds cs_layer, and is simply ABSENT otherwise.
 *
 * Absent, not null and not hidden client-side: a component handed a record
 * without `cs` cannot leak a health band, because it was never given one. A
 * risk flag visibly changes how someone behaves toward a client and a false
 * positive becomes self-fulfilling, so this boundary is enforced here, once.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const decoded = decodeURIComponent(id);

  try {
    const resolved = await resolveCustomerKey(decoded);
    if (!resolved) {
      return NextResponse.json({ error: `No customer ${decoded}` }, { status: 404 });
    }

    const record = await fetchCustomerRecord(
      resolved.key,
      resolved.id,
      hasCsLayer(session.user.email),
    );
    if (!record) {
      // Resolved to a key, but neither NetSuite nor pm_crm_accounts has the
      // account. Distinguishable from the 404 above, which means the key itself
      // could not be resolved at all.
      return NextResponse.json(
        { error: `Customer ${resolved.key} is not in NetSuite or the local account table.` },
        { status: 404 },
      );
    }

    return NextResponse.json(record);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
