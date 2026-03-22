import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSuiteQL } from "@/lib/netsuite";
import { getSupabaseAdmin } from "@/lib/supabase";
import { HIRE_DATES } from "@/lib/constants";

// ─── Supabase migration (run once in dashboard SQL editor) ────────────────────
// CREATE TABLE IF NOT EXISTS employee_hire_dates (
//   email      text PRIMARY KEY,
//   hire_date  text NOT NULL,
//   updated_at timestamptz DEFAULT now()
// );
// ─────────────────────────────────────────────────────────────────────────────

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const results: { email: string; hire_date: string; source: string }[] = [];

  // 1. Try NS SuiteQL — hiredate field (may not be exposed in all accounts)
  try {
    const rows = await runSuiteQL<{ email: string | null; hiredate: string | null }>(
      `SELECT email, hiredate FROM employee WHERE isinactive = 'F' AND hiredate IS NOT NULL`
    );
    for (const row of rows ?? []) {
      if (row.email && row.hiredate) {
        results.push({ email: row.email.toLowerCase(), hire_date: row.hiredate, source: "netsuite" });
      }
    }
  } catch {
    // hiredate not exposed via SuiteQL — fall through to constants
  }

  // 2. Supplement with HIRE_DATES constants (for employees NS doesn't expose)
  for (const [email, hire_date] of Object.entries(HIRE_DATES)) {
    if (!results.find(r => r.email === email)) {
      results.push({ email, hire_date, source: "constants" });
    }
  }

  if (results.length === 0) {
    return NextResponse.json({ synced: 0, results: [] });
  }

  // 3. Upsert to Supabase
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("employee_hire_dates")
    .upsert(
      results.map(r => ({ email: r.email, hire_date: r.hire_date, updated_at: new Date().toISOString() })),
      { onConflict: "email" }
    );

  if (error) {
    return NextResponse.json({ error: `Supabase upsert failed: ${error.message}. Run the migration SQL first.` }, { status: 500 });
  }

  return NextResponse.json({ synced: results.length, results });
}
