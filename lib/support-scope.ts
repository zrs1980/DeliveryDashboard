// Support-case scope check for the Projects tab's Support list. CLIENT-SAFE:
// ProjectTable imports the tier mapping and types; the prompt lives in the route.

/** The five support engagement types, from the NetSuite jobtype name. */
export type SupportTier = "msa" | "gc" | "standard" | "premium" | "platinum";

export function supportTier(projectType: string | null | undefined): SupportTier | null {
  const t = (projectType ?? "").toLowerCase();
  if (t.includes("managed service"))   return "msa";
  if (t.includes("general consulting")) return "gc";
  if (t.includes("platinum"))          return "platinum";
  if (t.includes("premium"))           return "premium";
  if (t.includes("standard"))          return "standard";
  return null;
}

/**
 * "billable" — outside the agreement, chargeable as extra work.
 * "sow"      — needs its own Statement of Work / service request.
 */
export type ScopeVerdict = "in_scope" | "billable" | "sow";

export interface CaseScopeResult {
  caseId: string;
  tier:   SupportTier;
  verdict: ScopeVerdict;
  reason: string;
}

/** One case checked against one tier — a customer-level case can sit on two projects. */
export const scopeKey = (caseId: string, tier: SupportTier) => `${caseId}|${tier}`;
