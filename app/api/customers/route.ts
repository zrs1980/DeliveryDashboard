import { NextResponse } from "next/server";
import { fetchCsCustomers, type CsCustomer } from "@/lib/cs-customers";

export const revalidate = 0;

/**
 * Re-exported so the existing
 * `import type { NSCustomer } from "@/app/api/customers/route"` in
 * CustomersView.tsx keeps working. The shape is defined once, in
 * lib/cs-customers.ts, alongside the query that produces it — the CS layer and
 * this tab must agree on what counts as a customer, and two copies of that
 * filter would eventually disagree.
 */
export type NSCustomer = CsCustomer;

export async function GET() {
  try {
    const customers = await fetchCsCustomers();
    return NextResponse.json({ customers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
