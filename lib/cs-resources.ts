import { runSuiteQLAll } from "./netsuite";

/**
 * Every linked resource for a customer, unioned from the customer record AND
 * its projects.
 *
 * ⚠ THE RESOURCES LIVE ON THE PROJECT, NOT THE CUSTOMER — and this is the whole
 * reason this module exists. Measured September 2026 against live NetSuite:
 *
 *   customer.custentity_customer_folder ....  8 of 180 customers
 *   job.custentity_project_folder .......... 13 jobs →  6 customers
 *   job.custentity20 (ClickUp) ............. 19 jobs → 11 customers
 *   job.custentity_slack_channel ........... 13 jobs →  6 customers
 *   union, either source ...................          17 customers
 *
 * Reading only the customer record finds a Drive folder for 8 accounts and
 * misses Salt and Stone (5 project folders, 5 ClickUp lists) and Oxide (2 and
 * 2) entirely — the two with the most material of anyone. Reading only projects
 * misses HDMI, Liquidpulse, Martin Water, Quora, Sabbel and Samara, which have
 * a customer folder and no project links at all. Neither side alone is
 * sufficient, so both are read and merged.
 *
 * ⚠ COVERAGE IS NARROW AND THAT IS A FACT ABOUT THE DATA, NOT A BUG. 17 of 180
 * active customers have any linked resource, and all 17 are entitystatus 13.
 * Anything built on this must degrade honestly for the other 163 rather than
 * implying a thin answer came from thin analysis.
 */

export interface ProjectResource {
  projectNsId:    string;
  projectNumber:  string | null;
  projectName:    string | null;
  /** 2 = In Progress. Kept so callers can prefer live projects. */
  entitystatus:   number | null;
  driveFolderUrl: string | null;
  clickupUrl:     string | null;
  slackChannel:   string | null;
  slackCanvasId:  string | null;
  /** ClickUp *space* link for internal PM work. Rare — 2 of 15 active. */
  internalPmLink: string | null;
}

export interface CustomerResources {
  customerNsId: string;
  customerName: string;
  /** The customer's own Drive folder. 8 of 180. */
  driveFolderUrl: string | null;
  /**
   * NetSuite's own last-sales-activity trio, populated on 132 of 180 — by far
   * the best-covered signal on the customer record, and previously unused.
   * `link` is a NetSuite-relative path (`/app/crm/common/crmmessage.nl?...`),
   * NOT an absolute URL — prefix the account base before rendering it.
   */
  lastSalesActivity: { date: string | null; name: string | null; link: string | null };
  projects: ProjectResource[];
  /** Deduped union across the customer and every project. */
  driveFolders:  string[];
  clickupUrls:   string[];
  slackChannels: string[];
  /** True when there is anything at all to read. */
  hasAny: boolean;
}

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" || s === "null" ? null : s;
};
const num = (v: unknown): number | null => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : null;
};

/** Absolute URL for the NetSuite-relative links stored on the customer. */
export function nsAbsolute(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `https://system.na1.netsuite.com${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Resources for every active customer, or just the ones asked for.
 *
 * Two queries rather than a join: a customer with no project must still come
 * back with its own folder and its last-sales-activity link, and an inner join
 * would drop it. `custentity_user_notes` and `custentity16` are deliberately
 * absent — both return NOT_EXPOSED in SuiteQL.
 */
export async function fetchCustomerResources(
  customerNsIds?: string[],
): Promise<Record<string, CustomerResources>> {
  const filter = customerNsIds?.length
    ? `AND c.id IN (${customerNsIds.map(id => parseInt(id, 10)).filter(Number.isFinite).join(",")})`
    : "";

  const [custRows, jobRows] = await Promise.all([
    runSuiteQLAll<Record<string, string | null>>(`
      SELECT
        c.id                                AS customer_ns_id,
        c.companyname                       AS customer_name,
        c.custentity_customer_folder        AS drive_folder_url,
        TO_CHAR(c.custentity_date_lsa, 'YYYY-MM-DD') AS lsa_date,
        c.custentity_link_name_lsa          AS lsa_name,
        c.custentity_link_lsa               AS lsa_link
      FROM customer c
      WHERE c.isinactive = 'F' ${filter}
    `),
    runSuiteQLAll<Record<string, string | null>>(`
      SELECT
        j.id                              AS project_ns_id,
        j.customer                        AS customer_ns_id,
        j.entityid                        AS project_number,
        j.companyname                     AS project_name,
        j.entitystatus                    AS entitystatus,
        j.custentity_project_folder       AS drive_folder_url,
        j.custentity20                    AS clickup_url,
        j.custentity_slack_channel        AS slack_channel,
        j.custentity_slack_canvas_id      AS slack_canvas_id,
        j.custentity_internal_pm_link     AS internal_pm_link
      FROM job j
      WHERE j.customer IS NOT NULL
        AND (j.custentity_project_folder IS NOT NULL
          OR j.custentity20 IS NOT NULL
          OR j.custentity_slack_channel IS NOT NULL
          OR j.custentity_slack_canvas_id IS NOT NULL
          OR j.custentity_internal_pm_link IS NOT NULL)
    `),
  ]);

  const out: Record<string, CustomerResources> = {};

  for (const r of custRows ?? []) {
    const id = String(r.customer_ns_id);
    out[id] = {
      customerNsId: id,
      customerName: str(r.customer_name) ?? id,
      driveFolderUrl: str(r.drive_folder_url),
      lastSalesActivity: {
        date: str(r.lsa_date), name: str(r.lsa_name), link: str(r.lsa_link),
      },
      projects: [],
      driveFolders: [], clickupUrls: [], slackChannels: [],
      hasAny: false,
    };
  }

  for (const r of jobRows ?? []) {
    const id = String(r.customer_ns_id);
    // A project whose customer is outside the requested set is skipped rather
    // than conjuring a customer row with no name.
    const c = out[id];
    if (!c) continue;
    c.projects.push({
      projectNsId:    String(r.project_ns_id),
      projectNumber:  str(r.project_number),
      projectName:    str(r.project_name),
      entitystatus:   num(r.entitystatus),
      driveFolderUrl: str(r.drive_folder_url),
      clickupUrl:     str(r.clickup_url),
      slackChannel:   str(r.slack_channel),
      slackCanvasId:  str(r.slack_canvas_id),
      internalPmLink: str(r.internal_pm_link),
    });
  }

  for (const c of Object.values(out)) {
    // Live projects first: when an agent has to pick one folder to read, the
    // in-progress engagement is the one that matters.
    c.projects.sort((a, b) => {
      if ((a.entitystatus === 2) !== (b.entitystatus === 2)) return a.entitystatus === 2 ? -1 : 1;
      return (b.projectNumber ?? "").localeCompare(a.projectNumber ?? "");
    });

    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
    c.driveFolders  = uniq([c.driveFolderUrl, ...c.projects.map(p => p.driveFolderUrl)]);
    c.clickupUrls   = uniq(c.projects.map(p => p.clickupUrl));
    c.slackChannels = uniq(c.projects.map(p => p.slackChannel));
    c.hasAny = c.driveFolders.length > 0 || c.clickupUrls.length > 0
            || c.slackChannels.length > 0 || Boolean(c.lastSalesActivity.link);
  }

  return out;
}
