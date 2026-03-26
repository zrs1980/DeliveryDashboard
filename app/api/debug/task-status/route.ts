import { NextResponse } from "next/server";

const BASE_URL = `https://${process.env.NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com`;

import crypto from "crypto";
function pct(s: string) { return encodeURIComponent(s).replace(/!/g,"%21").replace(/'/g,"%27").replace(/\(/g,"%28").replace(/\)/g,"%29").replace(/\*/g,"%2A"); }
function buildAuth(method: string, fullUrl: string) {
  const AID=process.env.NETSUITE_ACCOUNT_ID!,CK=process.env.NETSUITE_CONSUMER_KEY!,CS=process.env.NETSUITE_CONSUMER_SECRET!,TI=process.env.NETSUITE_TOKEN_ID!,TS=process.env.NETSUITE_TOKEN_SECRET!;
  const ts=String(Math.floor(Date.now()/1000)),nc=crypto.randomBytes(16).toString("hex");
  const u=new URL(fullUrl),base=`${u.protocol}//${u.host}${u.pathname}`;
  const p:Array<[string,string]>=[];
  u.searchParams.forEach((v,k)=>p.push([k,v]));
  p.push(["oauth_consumer_key",CK],["oauth_nonce",nc],["oauth_signature_method","HMAC-SHA256"],["oauth_timestamp",ts],["oauth_token",TI],["oauth_version","1.0"]);
  const norm=p.map(([k,v]):[string,string]=>[pct(k),pct(v)]).sort(([ak,av],[bk,bv])=>ak<bk?-1:ak>bk?1:av<bv?-1:1).map(([k,v])=>`${k}=${v}`).join("&");
  const sig=crypto.createHmac("sha256",`${pct(CS)}&${pct(TS)}`).update(`${method.toUpperCase()}&${pct(base)}&${pct(norm)}`).digest("base64");
  return [`OAuth realm="${AID}"`,`oauth_consumer_key="${pct(CK)}"`,`oauth_nonce="${nc}"`,`oauth_signature="${pct(sig)}"`,`oauth_signature_method="HMAC-SHA256"`,`oauth_timestamp="${ts}"`,`oauth_token="${pct(TI)}"`,`oauth_version="1.0"`].join(", ");
}

export async function GET() {
  const url = `${BASE_URL}/services/rest/record/v1/metadata-catalog/projecttask`;
  const res = await fetch(url, { headers: { "Authorization": buildAuth("GET", url), "Content-Type": "application/json" } });
  const raw = await res.json() as Record<string, unknown>;
  // Look for status field in various likely structures
  const props = (raw.properties ?? raw.fields ?? raw.items ?? []) as Record<string, unknown>[];
  const statusField = props.find((f: any) => f.name === "status" || f.id === "status" || f.fieldId === "status");
  return NextResponse.json({
    httpStatus: res.status,
    topLevelKeys: Object.keys(raw),
    propsCount: props.length,
    statusField,
    // Show first 3 props to understand structure
    firstThreeProps: props.slice(0, 3),
  });
}
