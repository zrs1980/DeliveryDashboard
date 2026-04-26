import { NextRequest, NextResponse } from "next/server";
import { resolvePortalUser } from "@/lib/supabase-portal";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSuiteQL } from "@/lib/netsuite";

export const revalidate = 0;

interface NSJob {
  id: string;
  entityid: string;
  companyname: string;
  entitystatus: string;
  jobtype: string;
  golive_date: string | null;
  budget_hours: string | null;
  remaining_hours: string | null;
}

// GET /api/portal/projects
// Returns NS projects this customer is allowed to access (enforced via project_portal_access)
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await resolvePortalUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();

  // Get project IDs this customer can access
  const { data: access } = await db
    .from("project_portal_access")
    .select("project_ns_id, project_name")
    .eq("customer_ns_id", user.customer_ns_id);

  if (!access?.length) return NextResponse.json({ projects: [] });

  const ids = access.map(a => a.project_ns_id).join(", ");

  const jobs = await runSuiteQL<NSJob>(`
    SELECT
      id,
      entityid,
      companyname,
      entitystatus,
      jobtype,
      custentity_project_golive_date       AS golive_date,
      custentity_ceba_project_budget_hours AS budget_hours,
      custentity_project_remaining_hours   AS remaining_hours
    FROM job
    WHERE id IN (${ids})
    ORDER BY companyname ASC
  `);

  const projects = jobs.map(j => {
    const budgetHours    = parseFloat(j.budget_hours ?? "0") || 0;
    const remainingHours = parseFloat(j.remaining_hours ?? "0") || 0;
    const actualHours    = budgetHours - remainingHours;
    const burnRate       = budgetHours > 0 ? actualHours / budgetHours : 0;
    return {
      id:           parseInt(j.id),
      entityid:     j.entityid,
      companyname:  j.companyname,
      jobtype:      parseInt(j.jobtype),
      goliveDate:   j.golive_date,
      budgetHours,
      actualHours,
      remainingHours,
      burnRate,
    };
  });

  return NextResponse.json({ projects, customerName: user.customer_name });
}
