import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

// ─── Supabase migration (run once in dashboard SQL editor) ────────────────────
// CREATE TABLE IF NOT EXISTS healthchecks (
//   id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   customer_ns_id  text NOT NULL,
//   customer_name   text NOT NULL,
//   quarter         text NOT NULL,          -- e.g. "Q2 2026"
//   scheduled_date  text,                   -- ISO date string
//   consultant_ns_id integer,
//   consultant_name text,
//   status          text NOT NULL DEFAULT 'unscheduled',
//                   -- unscheduled | scheduled | completed | overdue | cancelled
//   topics          text,
//   notes           text,
//   created_at      timestamptz DEFAULT now(),
//   updated_at      timestamptz DEFAULT now(),
//   completed_at    timestamptz
// );
// CREATE INDEX IF NOT EXISTS hc_customer_idx ON healthchecks(customer_ns_id);
// CREATE INDEX IF NOT EXISTS hc_quarter_idx  ON healthchecks(quarter);
// ─────────────────────────────────────────────────────────────────────────────

export interface Healthcheck {
  id: string;
  customer_ns_id: string;
  customer_name: string;
  quarter: string;
  scheduled_date: string | null;
  consultant_ns_id: number | null;
  consultant_name: string | null;
  status: "unscheduled" | "scheduled" | "completed" | "overdue" | "cancelled";
  topics: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("healthchecks")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ healthchecks: data ?? [] });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { customer_ns_id, customer_name, quarter, scheduled_date,
          consultant_ns_id, consultant_name, topics, notes } = body;

  if (!customer_ns_id || !customer_name || !quarter) {
    return NextResponse.json({ error: "customer_ns_id, customer_name and quarter are required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("healthchecks")
    .insert({
      customer_ns_id: String(customer_ns_id),
      customer_name,
      quarter,
      scheduled_date: scheduled_date ?? null,
      consultant_ns_id: consultant_ns_id ?? null,
      consultant_name:  consultant_name  ?? null,
      status:  scheduled_date ? "scheduled" : "unscheduled",
      topics:  topics ?? null,
      notes:   notes  ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ healthcheck: data });
}
