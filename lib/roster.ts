// ─── Staff roster ─────────────────────────────────────────────────────────────
//
// One live source of "who works here", replacing the hardcoded EMPLOYEES / PMS
// maps that used to live in constants.ts.
//
// Those maps were read by eleven features, so every hire needed a code change and
// a deploy — and the map drifted: Rodrigo Gerona and Carlos Roman were never added,
// Kathy Bacero was in PMS but not EMPLOYEES, and Alecia Gilmore stayed on months
// after leaving. NetSuite already knows all of this, and four routes were already
// querying it (`custentity10 IN (1,2)`), so the roster is read from there instead.
//
// The constants survive only as an outage net — see `fallback` on the result.

import { runSuiteQLAll } from "./netsuite";
import { FALLBACK_EMPLOYEES, FALLBACK_PMS } from "./constants";

/** `custentity10` — "CEBA Employee Category". Internal ids, verified against the live account. */
export const CATEGORY = {
  CONSULTING:       1,
  PMO:              2,
  MANAGED_SERVICES: 3,
  SALES_MARKETING:  4,
  BACK_OFFICE:      5,
  MANAGEMENT:       6,
  PRODUCT:          7,
} as const;

/** The categories that count as delivery consultants everywhere in the app. */
export const CONSULTANT_CATEGORY_IDS: number[] = [CATEGORY.CONSULTING, CATEGORY.PMO];

export interface StaffMember {
  id:                number;
  name:              string;
  email:             string;
  /** Display text of custentity10, e.g. "Consulting" / "PMO". "" when unset. */
  category:          string;
  /** Internal id of custentity10, or null when unset. */
  categoryId:        number | null;
  /** Display text of employeetype, e.g. "Consultant" / "Project Manager". */
  employeeType:      string;
  /** 0-1 decimal from the NS employee record. Defaults to 0.75 when unset. */
  targetUtilization: number;
  /** Departed staff stay on the roster so historical rows keep their name. */
  isInactive:        boolean;
}

export interface Roster {
  members: StaffMember[];
  byId:    Record<number, StaffMember>;
  /**
   * True when NetSuite could not be reached and this came from the hardcoded
   * fallback. Surface it on API responses — a roster that is quietly three years
   * stale looks identical to a correct one.
   */
  fallback: boolean;
}

// Inactive employees are fetched too, deliberately. The hardcoded map this
// replaced still listed departed staff, and that is what kept their name on the
// cases, service requests and projects they worked on. Filter them out where the
// list is something to PICK from; keep them where it is a name to RESOLVE.
const ROSTER_SQL = `
  SELECT id, firstname, lastname, email, isinactive,
         custentity10                     AS category_id,
         BUILTIN.DF(custentity10)         AS category,
         BUILTIN.DF(employeetype)         AS employee_type,
         targetutilization
  FROM employee
  ORDER BY lastname, firstname
`;

// A page load fans out to half a dozen routes that each want the roster, and
// NetSuite concurrency-limits reads (429). One fetch per 5 minutes per instance.
const TTL_MS          = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 30 * 1000;   // retry soon rather than serving stale names for 5 min

let cache: { at: number; ttl: number; value: Roster } | null = null;
let inFlight: Promise<Roster> | null = null;

function toRoster(members: StaffMember[], fallback: boolean): Roster {
  const byId: Record<number, StaffMember> = {};
  for (const m of members) byId[m.id] = m;
  return { members, byId, fallback };
}

/** Last resort so a NetSuite outage doesn't empty every dropdown in the app. */
function fallbackRoster(): Roster {
  const ids = new Set([
    ...Object.keys(FALLBACK_EMPLOYEES).map(Number),
    ...Object.keys(FALLBACK_PMS).map(Number),
  ]);
  const members = [...ids].map(id => ({
    id,
    name:              FALLBACK_EMPLOYEES[id] ?? FALLBACK_PMS[id] ?? `Employee #${id}`,
    email:             "",
    category:          "",
    categoryId:        null,
    employeeType:      FALLBACK_PMS[id] ? "Project Manager" : "",
    targetUtilization: 0.75,
    isInactive:        false,
  }));
  members.sort((a, b) => a.name.localeCompare(b.name));
  return toRoster(members, true);
}

async function fetchRoster(): Promise<Roster> {
  const rows = await runSuiteQLAll<{
    id: string; firstname: string; lastname: string; email: string | null;
    isinactive: string | null; category_id: string | null; category: string | null;
    employee_type: string | null; targetutilization: string | null;
  }>(ROSTER_SQL);

  const members: StaffMember[] = [];
  for (const r of rows) {
    const name = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
    if (!name) continue;   // company-name-only records are not people

    const raw = r.targetutilization !== null && r.targetutilization !== "" ? parseFloat(r.targetutilization) : NaN;
    members.push({
      id:           parseInt(r.id),
      name,
      email:        (r.email ?? "").trim().toLowerCase(),
      category:     (r.category ?? "").trim(),
      categoryId:   r.category_id ? parseInt(r.category_id) : null,
      employeeType: (r.employee_type ?? "").trim(),
      // NS stores 0-1 (e.g. 0.75); normalise if someone typed 75.
      targetUtilization: !isNaN(raw) ? (raw > 1 ? raw / 100 : raw) : 0.75,
      isInactive:        r.isinactive === "T" || String(r.isinactive) === "true",
    });
  }
  return toRoster(members, false);
}

/**
 * Every NetSuite employee, past and present. Cached 5 minutes per instance.
 * This is the **name resolution** roster — use `getActiveStaff()` for anything
 * a user picks from.
 */
export async function getStaffRoster(): Promise<Roster> {
  const now = Date.now();
  if (cache && now - cache.at < cache.ttl) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const value = await fetchRoster();
      cache = { at: Date.now(), ttl: TTL_MS, value };
      return value;
    } catch (err) {
      console.error("[roster] NetSuite roster query failed — serving the hardcoded fallback:", err);
      const value = fallbackRoster();
      cache = { at: Date.now(), ttl: FALLBACK_TTL_MS, value };
      return value;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function subset(roster: Roster, keep: (m: StaffMember) => boolean): Roster {
  return toRoster(roster.members.filter(keep), roster.fallback);
}

/** Current staff — the roster to offer in a picker. */
export async function getActiveStaff(): Promise<Roster> {
  return subset(await getStaffRoster(), m => !m.isInactive);
}

/**
 * Delivery consultants — `custentity10 IN (1, 2)`, the same rule already used by
 * /api/resources, /api/manager/employees and /api/service-requests/metrics.
 * On the fallback path category is unknown, so everyone in it is returned rather
 * than nobody.
 */
export async function getConsultantRoster(): Promise<Roster> {
  const roster = await getStaffRoster();
  if (roster.fallback) return roster;
  return subset(roster, m =>
    !m.isInactive && m.categoryId !== null && CONSULTANT_CATEGORY_IDS.includes(m.categoryId));
}

/**
 * Project managers — employee type "Project Manager", or anyone in the PMO category.
 * `includeInactive` is for attributing a PM to work they did before leaving; a
 * picker wants the default.
 */
export async function getPmRoster({ includeInactive = false } = {}): Promise<Roster> {
  const roster = await getStaffRoster();
  const active = (m: StaffMember) => includeInactive || !m.isInactive;
  if (roster.fallback) return subset(roster, m => active(m) && m.employeeType === "Project Manager");

  // Kathy Bacero ran projects but was never typed as a PM in NetSuite — she was
  // only ever a line in the PMS constant. Honour that list for attribution so
  // her projects don't lose their PM, without letting it into a live picker.
  const legacy = includeInactive ? new Set(Object.keys(FALLBACK_PMS).map(Number)) : new Set<number>();

  return subset(roster, m => active(m) &&
    (m.employeeType.toLowerCase() === "project manager" ||
     m.categoryId === CATEGORY.PMO ||
     legacy.has(m.id)));
}

/** id → name, for the places that only need to label a NetSuite employee id. */
export function nameMap(roster: Roster): Record<number, string> {
  const out: Record<number, string> = {};
  for (const m of roster.members) out[m.id] = m.name;
  return out;
}

/** The label to show for an employee id that may not be on the roster. */
export function nameFor(roster: Roster, id: number | string): string {
  return roster.byId[typeof id === "string" ? parseInt(id) : id]?.name ?? `Employee #${id}`;
}
