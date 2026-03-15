import { NextResponse } from "next/server";
import crypto from "crypto";

// Temporary debug endpoint — remove after auth is confirmed working
export async function GET() {
  const accountId      = process.env.NETSUITE_ACCOUNT_ID      ?? "";
  const consumerKey    = process.env.NETSUITE_CONSUMER_KEY    ?? "";
  const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET ?? "";
  const tokenId        = process.env.NETSUITE_TOKEN_ID        ?? "";
  const tokenSecret    = process.env.NETSUITE_TOKEN_SECRET    ?? "";

  // Show first 6 / last 4 chars of each value so we can verify without exposing full secrets
  function mask(s: string) {
    if (!s) return "NOT SET";
    if (s.length <= 10) return `[${s.length} chars]`;
    return `${s.slice(0, 6)}...${s.slice(-4)} (${s.length} chars)`;
  }

  // Build a test signature to confirm crypto is working
  const ts  = String(Math.floor(Date.now() / 1000));
  const nc  = crypto.randomBytes(16).toString("hex");
  const testUrl = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000`;

  function pct(s: string) {
    return encodeURIComponent(s)
      .replace(/!/g, "%21").replace(/'/g, "%27")
      .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
  }

  const params: Array<[string, string]> = [
    ["limit",                    "1000"],
    ["oauth_consumer_key",       consumerKey],
    ["oauth_nonce",              nc],
    ["oauth_signature_method",   "HMAC-SHA256"],
    ["oauth_timestamp",          ts],
    ["oauth_token",              tokenId],
    ["oauth_version",            "1.0"],
  ];

  const normalized = params
    .map(([k, v]): [string, string] => [pct(k), pct(v)])
    .sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : 1)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const urlObj  = new URL(testUrl);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  const baseString = `POST&${pct(baseUrl)}&${pct(normalized)}`;
  const signingKey = `${pct(consumerSecret)}&${pct(tokenSecret)}`;
  const signature  = crypto.createHmac("sha256", signingKey).update(baseString).digest("base64");

  return NextResponse.json({
    env: {
      NETSUITE_ACCOUNT_ID:      mask(accountId),
      NETSUITE_CONSUMER_KEY:    mask(consumerKey),
      NETSUITE_CONSUMER_SECRET: mask(consumerSecret),
      NETSUITE_TOKEN_ID:        mask(tokenId),
      NETSUITE_TOKEN_SECRET:    mask(tokenSecret),
    },
    test: {
      targetUrl:   testUrl,
      baseUrl,
      timestamp:   ts,
      signature:   signature.slice(0, 10) + "...",
      signingKeyLen: signingKey.length,
      baseStringLen: baseString.length,
    },
  });
}
