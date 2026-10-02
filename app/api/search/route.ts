import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const revalidate = 0;

/**
 * One search box over customers, contacts and deals.
 *
 * ⚠ 180 CUSTOMERS, 815 CONTACTS, 295 DEALS, AND NO WAY TO JUMP TO ANY OF THEM.
 * Reaching a customer meant Customers → Accounts → filter → scroll. This is the
 * highest ratio of usefulness to effort left in the app.
 *
 * ⚠ SESSION-GATED, NOT cs_layer. Names, job titles and deal titles are ordinary
 * commercial information. Nothing here returns a health score, a band or a
 * flag — if a search result ever carries one, this route has to start thinking
 * about who is asking, and it currently does not have to.
 *
 * Customers come from `cs_customer_index` rather than live NetSuite: a search
 * box is typed into, so it must answer in tens of milliseconds, and the index
 * exists for exactly this. The cost is that a customer created today is not
 * findable until tonight's rebuild — acceptable here, where the alternative is
 * a SuiteQL round trip per keystroke.
 */

export interface SearchHit {
  kind:  "customer" | "contact" | "deal";
  id:    string;
  title: string;
  sub:   string | null;
  /** The account to open. Every hit resolves to one. */
  customerNsId: string;
}

const LIMIT = 6;   // per kind — a long list is a list you read instead of type

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  // PostgREST treats these as pattern syntax inside ilike; a stray % would
  // quietly turn "a%" into "match everything".
  const safe = q.replace(/[%_,()]/g, " ").trim();
  if (!safe) return NextResponse.json({ hits: [] });
  const like = `%${safe}%`;

  const db = getSupabaseAdmin();

  try {
    const [cust, contacts, deals] = await Promise.all([
      db.from("cs_customer_index")
        .select("customer_ns_id, name, entityid, stage")
        .ilike("name", like).limit(LIMIT),
      db.from("pm_crm_contacts")
        .select("id, name, job_title, email, customer_ns_id")
        .eq("is_active", true)
        .or(`name.ilike.${like},email.ilike.${like},job_title.ilike.${like}`)
        .limit(LIMIT),
      db.from("pm_crm_opportunities")
        .select("id, title, stage_name, customer_ns_id")
        .ilike("title", like).limit(LIMIT),
    ]);

    // Customer names, so a contact hit says who they work for — without it
    // "Jennifer McIntosh" is a name with no context to choose by.
    const ids = new Set<string>();
    for (const r of contacts.data ?? []) if (r.customer_ns_id) ids.add(r.customer_ns_id);
    for (const r of deals.data ?? [])    if (r.customer_ns_id) ids.add(r.customer_ns_id);
    const nameOf = new Map<string, string>();
    if (ids.size) {
      const { data } = await db.from("cs_customer_index")
        .select("customer_ns_id, name").in("customer_ns_id", [...ids]);
      for (const r of data ?? []) nameOf.set(r.customer_ns_id, r.name);
    }

    const hits: SearchHit[] = [
      ...(cust.data ?? []).map(r => ({
        kind: "customer" as const,
        id: r.customer_ns_id,
        title: r.name,
        sub: [r.entityid, r.stage].filter(Boolean).join(" · ") || null,
        customerNsId: r.customer_ns_id,
      })),
      ...(contacts.data ?? []).filter(r => r.customer_ns_id).map(r => ({
        kind: "contact" as const,
        id: String(r.id),
        title: r.name,
        sub: [r.job_title, nameOf.get(r.customer_ns_id!)].filter(Boolean).join(" · ") || null,
        customerNsId: r.customer_ns_id!,
      })),
      ...(deals.data ?? []).filter(r => r.customer_ns_id).map(r => ({
        kind: "deal" as const,
        id: String(r.id),
        title: r.title,
        sub: [r.stage_name, nameOf.get(r.customer_ns_id!)].filter(Boolean).join(" · ") || null,
        customerNsId: r.customer_ns_id!,
      })),
    ];

    return NextResponse.json({ hits });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
