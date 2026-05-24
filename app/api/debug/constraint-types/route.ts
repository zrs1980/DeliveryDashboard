import { NextResponse } from "next/server";
import { runSuiteQL } from "@/lib/netsuite";
import crypto from "crypto";

const ACCOUNT_ID     = process.env.NETSUITE_ACCOUNT_ID!;
const CONSUMER_KEY   = process.env.NETSUITE_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.NETSUITE_CONSUMER_SECRET!;
const TOKEN_ID       = process.env.NETSUITE_TOKEN_ID!;
const TOKEN_SECRET   = process.env.NETSUITE_TOKEN_SECRET!;
const BASE_URL       = `https://${ACCOUNT_ID}.suitetalk.api.netsuite.com`;

function pct(s: string) {
  return encodeURIComponent(s)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

function buildAuth(method: string, url: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nc = crypto.randomBytes(16).toString("hex");
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  const params: [string, string][] = [];
  urlObj.searchParams.forEach((v, k) => params.push([k, v]));
  params.push(["oauth_consumer_key", CONSUMER_KEY], ["oauth_nonce", nc],
    ["oauth_signature_method", "HMAC-SHA256"], ["oauth_timestamp", ts],
    ["oauth_token", TOKEN_ID], ["oauth_version", "1.0"]);
  const norm = params.map(([k, v]): [string, string] => [pct(k), pct(v)])
    .sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : 1)
    .map(([k, v]) => `${k}=${v}`).join("&");
  const base = `${method}&${pct(baseUrl)}&${pct(norm)}`;
  const key  = `${pct(CONSUMER_SECRET)}&${pct(TOKEN_SECRET)}`;
  const sig  = crypto.createHmac("sha256", key).update(base).digest("base64");
  return [`OAuth realm="${ACCOUNT_ID}"`, `oauth_consumer_key="${pct(CONSUMER_KEY)}"`,
    `oauth_nonce="${nc}"`, `oauth_signature="${pct(sig)}"`,
    `oauth_signature_method="HMAC-SHA256"`, `oauth_timestamp="${ts}"`,
    `oauth_token="${pct(TOKEN_ID)}"`, `oauth_version="1.0"`].join(", ");
}

export const revalidate = 0;

export async function GET() {
  try {
    // 1. Fetch NS REST metadata for projecttask
    const metaUrl = `${BASE_URL}/services/rest/record/v1/metadata-catalog/projecttask`;
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: buildAuth("GET", metaUrl), "Content-Type": "application/json" },
    });
    const meta = metaRes.ok ? await metaRes.json() : { error: await metaRes.text() };

    // Extract constrainttype field definition (try both casings)
    const props = meta?.properties ?? {};
    const ctField = props["constraintType"] ?? props["constrainttype"] ?? null;

    // 2. Try SuiteQL to find a projecttaskconstrainttype list
    let suiteqlResult: unknown = null;
    try {
      suiteqlResult = await runSuiteQL(`SELECT id, name FROM projecttaskconstrainttype ORDER BY id ASC`);
    } catch (e) {
      suiteqlResult = { error: String(e) };
    }

    return NextResponse.json({
      constraintTypeFieldDef: ctField,
      suiteqlConstraintTypes: suiteqlResult,
      // Also return all top-level property keys so we can see what's available
      allPropertyKeys: Object.keys(props).filter(k => k.toLowerCase().includes("constraint")),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
