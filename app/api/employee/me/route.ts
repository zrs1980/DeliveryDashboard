import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchRecord, runSuiteQL } from "@/lib/netsuite";

export interface EmployeeBalance {
  id: number;
  name: string;
  email: string;
  ptoHours: number;
  sickHours: number;
}

export interface TimeEntry {
  id: number;
  date: string;
  projectId: number;
  projectName: string;
  type: "pto" | "sick";
  hours: number;
  memo: string | null;
}

interface NsEmployeeRecord {
  id?: number | string;
  email?: string;
  firstname?: string;
  lastname?: string;
  custentity_ceba_pto_hours?: number | string | null;
  custentity_ceba_sick_hours?: number | string | null;
}

const BASE_URL = `https://${process.env.NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com`;

import crypto from "crypto";

function pct(s: string) {
  return encodeURIComponent(s)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

function buildOAuth(method: string, fullUrl: string) {
  const CONSUMER_KEY    = process.env.NETSUITE_CONSUMER_KEY!;
  const CONSUMER_SECRET = process.env.NETSUITE_CONSUMER_SECRET!;
  const TOKEN_ID        = process.env.NETSUITE_TOKEN_ID!;
  const TOKEN_SECRET    = process.env.NETSUITE_TOKEN_SECRET!;
  const ACCOUNT_ID      = process.env.NETSUITE_ACCOUNT_ID!;

  const ts  = String(Math.floor(Date.now() / 1000));
  const nc  = crypto.randomBytes(16).toString("hex");
  const urlObj  = new URL(fullUrl);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  const params: Array<[string, string]> = [];
  urlObj.searchParams.forEach((v, k) => params.push([k, v]));
  params.push(
    ["oauth_consumer_key",     CONSUMER_KEY],
    ["oauth_nonce",            nc],
    ["oauth_signature_method", "HMAC-SHA256"],
    ["oauth_timestamp",        ts],
    ["oauth_token",            TOKEN_ID],
    ["oauth_version",          "1.0"],
  );
  params.sort((a, b) => pct(a[0]) < pct(b[0]) ? -1 : pct(a[0]) > pct(b[0]) ? 1 : pct(a[1]) < pct(b[1]) ? -1 : 1);
  const normalized = params.map(([k, v]) => `${pct(k)}=${pct(v)}`).join("&");
  const base       = `${method}&${pct(baseUrl)}&${pct(normalized)}`;
  const signingKey = `${pct(CONSUMER_SECRET)}&${pct(TOKEN_SECRET)}`;
  const sig        = pct(crypto.createHmac("sha256", signingKey).update(base).digest("base64"));

  return `OAuth realm="${ACCOUNT_ID}", oauth_consumer_key="${CONSUMER_KEY}", oauth_nonce="${nc}", oauth_signature="${sig}", oauth_signature_method="HMAC-SHA256", oauth_timestamp="${ts}", oauth_token="${TOKEN_ID}", oauth_version="1.0"`;
}

async function fetchEmployeeList(): Promise<{ id: number; email?: string }[]> {
  // Fetch the employee list — items include id and basic fields
  const url = `${BASE_URL}/services/rest/record/v1/employee?limit=200`;
  const res = await fetch(url, {
    headers: { "Authorization": buildOAuth("GET", url), "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NS employee list error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return (data.items ?? []).map((item: any) => ({
    id:    parseInt(String(item.id)),
    email: item.email?.toLowerCase() ?? undefined,
  }));
}

export async function GET() {
  const session = await auth();
  const email   = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Step 1: get employee list and find ID by email
    const list = await fetchEmployeeList();

    let matchedId: number | null = null;

    // Try matching from list response first (email may be included)
    const listMatch = list.find(e => e.email === email);
    if (listMatch) {
      matchedId = listMatch.id;
    } else {
      // List items don't include email — fetch records sequentially to avoid
      // hitting the NS concurrency limit, stopping as soon as we find a match
      for (const emp of list) {
        try {
          const rec = await fetchRecord<NsEmployeeRecord>("employee", emp.id);
          if (rec.email?.toLowerCase() === email) {
            matchedId = emp.id;
            break;
          }
        } catch {
          // Skip records we can't fetch and keep looking
        }
      }
    }

    if (!matchedId) {
      return NextResponse.json({ error: `No NetSuite employee found matching ${email}` }, { status: 404 });
    }

    // Step 2: fetch full employee record for balance fields
    const record = await fetchRecord<NsEmployeeRecord>("employee", matchedId);

    const ptoHours  = parseFloat(String((record as any).custentity_ceba_pto_hours  ?? "0")) || 0;
    const sickHours = parseFloat(String((record as any).custentity_ceba_sick_hours ?? "0")) || 0;

    const balance: EmployeeBalance = {
      id:        matchedId,
      name:      `${(record as any).firstname ?? ""} ${(record as any).lastname ?? ""}`.trim() || email,
      email,
      ptoHours,
      sickHours,
    };

    // Step 3: look up PTO/Sick projects by known entityids
    const PTO_ENTITY_IDS  = ["117", "373"];
    const SICK_ENTITY_IDS = ["118", "371"];
    const allEntityIds    = [...PTO_ENTITY_IDS, ...SICK_ENTITY_IDS];

    const projectRows = await runSuiteQL<{ id: string; entityid: string; companyname: string }>(`
      SELECT id, entityid, companyname
      FROM job
      WHERE entityid IN (${allEntityIds.map(e => `'${e}'`).join(",")})
    `);

    if (!projectRows || projectRows.length === 0) {
      return NextResponse.json({ balance, entries: [] });
    }

    const projectNameMap: Record<number, { name: string; type: "pto" | "sick" }> = {};
    for (const p of projectRows as any[]) {
      const id   = parseInt(p.id);
      const name = p.companyname || p.entityid || String(id);
      const type = SICK_ENTITY_IDS.includes(p.entityid) ? "sick" : "pto";
      projectNameMap[id] = { name, type };
    }

    const allProjectIds = Object.keys(projectNameMap).map(Number);

    // Step 4: fetch timebill entries for this employee on PTO/Sick projects
    const timebillRows = await runSuiteQL<{
      id: string; trandate: string; customer: string; hours: string; memo: string;
    }>(`
      SELECT tb.id, tb.trandate, tb.customer, tb.hours, tb.memo
      FROM timebill tb
      WHERE tb.employee = ${matchedId}
        AND tb.customer IN (${allProjectIds.join(",")})
      ORDER BY tb.trandate DESC
    `);

    const entries: TimeEntry[] = (timebillRows ?? []).map((r: any) => {
      const projId = parseInt(r.customer);
      const proj   = projectNameMap[projId] ?? { name: String(projId), type: "pto" as const };
      return {
        id:          parseInt(r.id),
        date:        r.trandate ?? "",
        projectId:   projId,
        projectName: proj.name,
        type:        proj.type,
        hours:       parseFloat(r.hours ?? "0"),
        memo:        r.memo ?? null,
      };
    });

    return NextResponse.json({ balance, entries, _debug: { recordKeys: Object.keys(record as any) } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
