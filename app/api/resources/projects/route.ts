import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";

export const revalidate = 0;

/**
 * GET /api/resources/projects
 *
 * → { projects: AllocatableProject[] }
 *
 * The projects the Resource Allocation tab's "Add project" picker offers: every
 * In Progress job (entitystatus = 2) of ANY type — Implementation, Service,
 * Managed Services Agreement, internal and the 419 capacity placeholder alike,
 * since all of them can carry allocations.
 *
 * Carries the same project-level fields /api/resources puts on each allocation,
 * so a row added from the picker classifies (Bill/Util/Prod) and groups
 * correctly before the next refresh.
 */

export interface AllocatableProject {
  id:            number;
  name:          string;
  companyName:   string;
  projectType:   string;
  budgetHours:   number | null;
  classifyAsBillable:   boolean;
  classifyAsUtilized:   boolean;
  classifyAsProductive: boolean;
}

export async function GET() {
  try {
    const rows = await runSuiteQL<{
      id: string;
      entityid: string | null;
      companyname: string | null;
      customer_name: string | null;
      jobtype: string | null;
      jobtype_name: string | null;
      budget_hours: string | null;
      is_billable: string | null;
      is_utilized_time: string | null;
      is_productive_time: string | null;
    }>(`
      SELECT
        j.id,
        j.entityid,
        j.companyname,
        BUILTIN.DF(j.customer)                 AS customer_name,
        j.jobtype,
        BUILTIN.DF(j.jobtype)                  AS jobtype_name,
        j.custentity_ceba_project_budget_hours AS budget_hours,
        j.custentity_ceba_is_billable          AS is_billable,
        j.isutilizedtime                       AS is_utilized_time,
        j.isproductivetime                     AS is_productive_time
      FROM job j
      WHERE j.entitystatus = 2
      ORDER BY j.companyname
    `);

    const projects: AllocatableProject[] = rows.map(r => {
      // Same fallback as /api/resources: NetSuite's jobtype label, else 1/2/Internal.
      const jt     = parseInt(r.jobtype ?? "0");
      const jtName = (r.jobtype_name ?? "").trim();
      // companyname is the PROJECT name in this account; BUILTIN.DF(customer) is
      // the client — and for internal jobs it's often blank or CEBA itself.
      const name     = (r.companyname ?? "").trim() || (r.entityid ?? "").trim() || `Project ${r.id}`;
      const customer = (r.customer_name ?? "").trim();
      return {
        id:          parseInt(r.id),
        name,
        // BUILTIN.DF(customer) can render "Parent : Child"; keep the last segment,
        // which is what /api/resources shows (customer.companyname).
        companyName: customer.split(" : ").pop() ?? "",
        projectType: jtName !== "" ? jtName : jt === 1 ? "Implementation" : jt === 2 ? "Service" : "Internal",
        budgetHours: r.budget_hours != null ? parseFloat(r.budget_hours) : null,
        // SuiteQL omits a checkbox never set, so absent = not set.
        classifyAsBillable:   r.is_billable        === "T",
        classifyAsUtilized:   r.is_utilized_time   === "T",
        classifyAsProductive: r.is_productive_time === "T",
      };
    });

    return NextResponse.json({ projects });
  } catch (err) {
    console.error("[GET /api/resources/projects]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
