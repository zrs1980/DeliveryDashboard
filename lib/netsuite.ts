import crypto from "crypto";

const ACCOUNT_ID      = process.env.NETSUITE_ACCOUNT_ID!;
const CONSUMER_KEY    = process.env.NETSUITE_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.NETSUITE_CONSUMER_SECRET!;
const TOKEN_ID        = process.env.NETSUITE_TOKEN_ID!;
const TOKEN_SECRET    = process.env.NETSUITE_TOKEN_SECRET!;

const BASE_URL    = `https://${ACCOUNT_ID}.suitetalk.api.netsuite.com`;
const SUITEQL_URL = `${BASE_URL}/services/rest/query/v1/suiteql`;

// ─── OAuth 1.0a (manual — NetSuite TBA, HMAC-SHA256) ─────────────────────────

function pct(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

function buildOAuthHeader(method: string, fullUrl: string): string {
  const ts  = String(Math.floor(Date.now() / 1000));
  const nc  = crypto.randomBytes(16).toString("hex");

  // Separate base URL from query params — both go into the signature
  const urlObj  = new URL(fullUrl);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  // Collect params: URL query params + OAuth params (NO realm, NO oauth_signature)
  const params: Array<[string, string]> = [];
  urlObj.searchParams.forEach((v, k) => params.push([k, v]));
  params.push(["oauth_consumer_key",     CONSUMER_KEY]);
  params.push(["oauth_nonce",            nc]);
  params.push(["oauth_signature_method", "HMAC-SHA256"]);
  params.push(["oauth_timestamp",        ts]);
  params.push(["oauth_token",            TOKEN_ID]);
  params.push(["oauth_version",          "1.0"]);

  // Sort by encoded key, then encoded value
  const normalized = params
    .map(([k, v]): [string, string] => [pct(k), pct(v)])
    .sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : 1)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseString   = `${method.toUpperCase()}&${pct(baseUrl)}&${pct(normalized)}`;
  const signingKey   = `${pct(CONSUMER_SECRET)}&${pct(TOKEN_SECRET)}`;
  const signature    = crypto.createHmac("sha256", signingKey).update(baseString).digest("base64");

  return [
    `OAuth realm="${ACCOUNT_ID}"`,
    `oauth_consumer_key="${pct(CONSUMER_KEY)}"`,
    `oauth_nonce="${nc}"`,
    `oauth_signature="${pct(signature)}"`,
    `oauth_signature_method="HMAC-SHA256"`,
    `oauth_timestamp="${ts}"`,
    `oauth_token="${pct(TOKEN_ID)}"`,
    `oauth_version="1.0"`,
  ].join(", ");
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

  const method  = "POST";
  const fullUrl = `${SUITEQL_URL}?limit=1000`;
  const auth    = buildOAuthHeader(method, fullUrl);
  const body    = JSON.stringify({ q });

  let res: Response;
  try {
    res = await fetch(fullUrl, {
      method,
      headers: {
        "Authorization": auth,
        "Content-Type":  "application/json",
        "Prefer":        "transient",
      },
      body,
    });
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.cause : err;
    throw new Error(`SuiteQL fetch failed (network): ${String(err)} | cause: ${JSON.stringify(cause)}`);
  }

  if (!res.ok) {
    const text = await res.text();
    // Log the auth header (redact signature) to help debug
    const redacted = auth.replace(/oauth_signature="[^"]*"/, 'oauth_signature="[redacted]"');
    console.error("[SuiteQL] 401 debug — URL:", fullUrl);
    console.error("[SuiteQL] 401 debug — Auth header:", redacted);
    throw new Error(`SuiteQL error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return (data.items ?? []) as T[];
}

// Paginating variant — fetches all pages (use for queries that may exceed 1000 rows)
export async function runSuiteQLAll<T = Record<string, string>>(
  query: string,
  params: (string | number)[] = []
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let offset = 0;

  while (true) {
    let q = query;
    for (const p of params) {
      const safe = typeof p === "number" ? String(p) : `'${String(p).replace(/'/g, "''")}'`;
      q = q.replace("?", safe);
    }

    const method  = "POST";
    const fullUrl = `${SUITEQL_URL}?limit=${PAGE}&offset=${offset}`;
    const auth    = buildOAuthHeader(method, fullUrl);

    let res: Response;
    try {
      res = await fetch(fullUrl, {
        method,
        headers: {
          "Authorization": auth,
          "Content-Type":  "application/json",
          "Prefer":        "transient",
        },
        body: JSON.stringify({ q }),
      });
    } catch (err: unknown) {
      const cause = err instanceof Error ? err.cause : err;
      throw new Error(`SuiteQL fetch failed (network): ${String(err)} | cause: ${JSON.stringify(cause)}`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SuiteQL error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const items = (data.items ?? []) as T[];
    all.push(...items);

    if (items.length < PAGE) break;
    offset += PAGE;
  }

  return all;
}

// ─── NetSuite REST metadata catalog ───────────────────────────────────────────

export async function fetchFieldSelectOptions(
  recordType: string,
  fieldId: string,
): Promise<{ id: string; label: string }[]> {
  const url    = `${BASE_URL}/services/rest/record/v1/metadata-catalog/${recordType}`;
  const method = "GET";
  const auth   = buildOAuthHeader(method, url);

  const res = await fetch(url, {
    method,
    headers: { "Authorization": auth, "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NS metadata error ${res.status}: ${text}`);
  }

  const meta = await res.json();
  const fields: Record<string, unknown>[] = meta?.properties ?? [];
  const field = fields.find((f: any) => f.name === fieldId || f.id === fieldId) as any;
  if (!field?.enum) return [];

  return (field.enum as string[]).map((val: string, i: number) => ({
    id:    val,
    label: (field.enumNames?.[i] as string) ?? val,
  }));
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

export async function searchRecords<T = Record<string, unknown>>(
  recordType: string,
  query: string,
  limit = 5,
): Promise<T[]> {
  const url    = `${BASE_URL}/services/rest/record/v1/${recordType}?q=${encodeURIComponent(query)}&limit=${limit}`;
  const method = "GET";
  const auth   = buildOAuthHeader(method, url);

  const res = await fetch(url, {
    method,
    headers: { "Authorization": auth, "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NS search error ${res.status}: ${text}`);
  }

  const data = await res.json();
  // REST list responses wrap items in { items: [...] }
  return (data.items ?? []) as T[];
}

export async function postRecord(
  recordType: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const url    = `${BASE_URL}/services/rest/record/v1/${recordType}`;
  const method = "POST";
  const auth   = buildOAuthHeader(method, url);

  const res = await fetch(url, {
    method,
    headers: { "Authorization": auth, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NS POST error ${res.status}: ${text}`);
  }

  const location = res.headers.get("Location") ?? "";
  const idMatch  = location.match(/\/(\d+)$/);
  if (!idMatch) throw new Error("Could not extract new record ID from NetSuite response");
  return idMatch[1];
}

export async function patchRecord(
  recordType: string,
  id: number,
  fields: Record<string, unknown>
): Promise<void> {
  const url    = `${BASE_URL}/services/rest/record/v1/${recordType}/${id}`;
  const method = "PATCH";
  const auth   = buildOAuthHeader(method, url);

  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": auth,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(fields),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NS PATCH error ${res.status}: ${text}`);
  }
}


// ─── Queries ─────────────────────────────────────────────────────────────────

export async function fetchActiveProjects() {
  return runSuiteQL<{
    id: string;
    entityid: string;
    companyname: string;
    customer_name: string | null;
    startdate: string | null;
    golive_date: string | null;
    entitystatus: string;
    jobtype: string;
    clickup_url: string | null;
    budget_hours: string;
    remaining_hours: string;
    user_notes: string | null;
  }>(`
    SELECT
      id,
      entityid,
      companyname,
      BUILTIN.DF(customer)                 AS customer_name,
      startdate,
      custentity_project_golive_date       AS golive_date,
      entitystatus,
      jobtype,
      custentity20                         AS clickup_url,
      custentity_ceba_project_budget_hours AS budget_hours,
      custentity_project_remaining_hours   AS remaining_hours,
      custentity_user_notes                AS user_notes
    FROM job
    WHERE entitystatus = 2
      AND jobtype IN (1, 2)
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
      AND j.jobtype IN (1, 2)
    ORDER BY j.id, pt.id ASC
  `);
}

/** Returns all active employees in the Consulting department (custentity10 = 'Consulting'): { id → "First Last" } */
export async function getActiveJobResources(): Promise<Record<number, string>> {
  const rows = await runSuiteQLAll<{ id: string; firstname: string; lastname: string }>(
    `SELECT id, firstname, lastname FROM employee WHERE BUILTIN.DF(custentity10) = 'Consulting' AND isinactive = 'F' ORDER BY lastname, firstname`
  );
  const map: Record<number, string> = {};
  for (const r of rows) {
    const name = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
    if (name) map[parseInt(r.id)] = name;
  }
  return map;
}
