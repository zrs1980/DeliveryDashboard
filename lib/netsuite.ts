import crypto from "crypto";
import OAuth from "oauth-1.0a";

const ACCOUNT_ID      = process.env.NETSUITE_ACCOUNT_ID!;
const CONSUMER_KEY    = process.env.NETSUITE_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.NETSUITE_CONSUMER_SECRET!;
const TOKEN_ID        = process.env.NETSUITE_TOKEN_ID!;
const TOKEN_SECRET    = process.env.NETSUITE_TOKEN_SECRET!;

const BASE_URL    = `https://${ACCOUNT_ID}.suitetalk.api.netsuite.com`;
const SUITEQL_URL = `${BASE_URL}/services/rest/query/v1/suiteql`;

// ─── OAuth 1.0a client ────────────────────────────────────────────────────────

function makeOAuthClient() {
  return new OAuth({
    consumer: { key: CONSUMER_KEY, secret: CONSUMER_SECRET },
    signature_method: "HMAC-SHA256",
    hash_function(baseString: string, key: string) {
      return crypto.createHmac("sha256", key).update(baseString).digest("base64");
    },
  });
}

function buildOAuthHeader(method: string, url: string): string {
  const oauthClient = makeOAuthClient();
  const token       = { key: TOKEN_ID, secret: TOKEN_SECRET };
  const header      = oauthClient.toHeader(
    oauthClient.authorize({ url, method }, token)
  );
  // Inject realm into the header (NetSuite requires it)
  return header.Authorization.replace("OAuth ", `OAuth realm="${ACCOUNT_ID}", `);
}

// ─── SuiteQL executor ─────────────────────────────────────────────────────────

export async function runSuiteQL<T = Record<string, string>>(
  query: string,
  params: (string | number)[] = []
): Promise<T[]> {
  // SuiteQL REST doesn't support positional params — inline them safely
  let q = query;
  for (const p of params) {
    const safe = typeof p === "number" ? String(p) : `'${String(p).replace(/'/g, "''")}'`;
    q = q.replace("?", safe);
  }

  const method    = "POST";
  const fullUrl   = `${SUITEQL_URL}?limit=1000`;
  const auth      = buildOAuthHeader(method, fullUrl);

  const body = JSON.stringify({ q });

  const res = await fetch(fullUrl, {
    method,
    headers: {
      "Authorization":  auth,
      "Content-Type":   "application/json",
      "Prefer":         "transient",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SuiteQL error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return (data.items ?? []) as T[];
}

// ─── NetSuite REST Record API (for projecttask dates) ─────────────────────────

export async function fetchRecord<T = Record<string, unknown>>(
  recordType: string,
  id: number
): Promise<T> {
  const url    = `${BASE_URL}/services/rest/record/v1/${recordType}/${id}`;
  const method = "GET";
  const auth   = buildOAuthHeader(method, url);

  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": auth,
      "Content-Type":  "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NS REST error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function fetchActiveProjects() {
  return runSuiteQL<{
    id: string;
    entityid: string;
    companyname: string;
    startdate: string | null;
    golive_date: string | null;
    entitystatus: string;
    jobtype: string;
    clickup_url: string | null;
    budget_hours: string;
    remaining_hours: string;
  }>(`
    SELECT
      id,
      entityid,
      companyname,
      startdate,
      custentity_project_golive_date       AS golive_date,
      entitystatus,
      jobtype,
      custentity20                         AS clickup_url,
      custentity_ceba_project_budget_hours AS budget_hours,
      custentity_project_remaining_hours   AS remaining_hours
    FROM job
    WHERE entitystatus = 2
    ORDER BY custentity_project_golive_date ASC
  `);
}

export async function fetchProjectHours(projectId: number) {
  const rows = await runSuiteQL<{
    id: string;
    entityid: string;
    budget_hours: string;
    remaining_hours: string;
    hours_consumed: string;
  }>(`
    SELECT
      id,
      entityid,
      custentity_ceba_project_budget_hours                                      AS budget_hours,
      custentity_project_remaining_hours                                        AS remaining_hours,
      custentity_ceba_project_budget_hours - custentity_project_remaining_hours AS hours_consumed
    FROM job
    WHERE id = ?
  `, [projectId]);
  return rows[0] ?? null;
}

export async function fetchTimebillHours(projectIds: number[]) {
  if (projectIds.length === 0) return [];
  const placeholders = projectIds.map(() => "?").join(", ");
  return runSuiteQL<{ employee: string; project_id: string; total_hours: string }>(`
    SELECT tb.employee, tb.customer AS project_id, SUM(tb.hours) AS total_hours
    FROM timebill tb
    WHERE tb.customer IN (${placeholders})
    GROUP BY tb.customer, tb.employee
    ORDER BY tb.customer, total_hours DESC
  `, projectIds);
}

export async function fetchProjectPhases(projectId: number) {
  return runSuiteQL<{
    phase_id: string;
    project_id: string;
    project_number: string;
    client: string;
    phase_name: string;
    budgeted_hours: string;
    actual_hours: string;
    phase_status: string;
  }>(`
    SELECT
      pt.id            AS phase_id,
      pt.project       AS project_id,
      j.entityid       AS project_number,
      j.companyname    AS client,
      pt.title         AS phase_name,
      pt.estimatedwork AS budgeted_hours,
      pt.actualwork    AS actual_hours,
      pt.status        AS phase_status
    FROM projecttask pt
    JOIN job j ON j.id = pt.project
    WHERE pt.project = ?
    ORDER BY pt.id ASC
  `, [projectId]);
}

export async function fetchAllPhases() {
  return runSuiteQL<{
    phase_id: string;
    project_id: string;
    project_number: string;
    client: string;
    phase_name: string;
    budgeted_hours: string;
    actual_hours: string;
    phase_status: string;
  }>(`
    SELECT
      pt.id            AS phase_id,
      pt.project       AS project_id,
      j.entityid       AS project_number,
      j.companyname    AS client,
      pt.title         AS phase_name,
      pt.estimatedwork AS budgeted_hours,
      pt.actualwork    AS actual_hours,
      pt.status        AS phase_status
    FROM projecttask pt
    JOIN job j ON j.id = pt.project
    WHERE j.entitystatus = 2
    ORDER BY j.id, pt.id ASC
  `);
}
