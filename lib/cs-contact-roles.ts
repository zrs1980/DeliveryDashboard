import type Anthropic from "@anthropic-ai/sdk";

/**
 * Suggesting a contact's role from their job title.
 *
 * `role` decides who the CSM agent is allowed to email, and it is `unknown` on
 * almost every contact. It cannot be imported: NetSuite's `contactrole` is set
 * on 22 of 949 contacts and its values are built-in negative ids whose labels
 * SuiteQL cannot resolve (verified September 2026).
 *
 * ⚠ THIS PRODUCES SUGGESTIONS, NEVER ROLES. The output lands in
 * `suggested_role`, and only a human accepting it writes `role`. A guess and a
 * decision must not be the same field when that field is what authorises
 * contacting someone.
 *
 * ⚠ NO TITLE MEANS NO SUGGESTION. A job title is the entire basis here; without
 * one the honest answer is nothing, not `end_user` as a default. Roughly a
 * third of contacts have no title, and inventing roles for them would be the
 * fastest way to make the whole column untrustworthy.
 */

export const ROLE_MODEL = "claude-sonnet-4-6";

export const ROLE_GUIDE = `
economic_buyer  Signs off spend. CFO, COO, owner, VP Finance, budget holder.
champion        Advocates for us internally. Usually the person who drove the
                project: Head of Ops, Programme Manager, Director of Systems.
admin           Runs the system day to day. NetSuite Administrator, Systems
                Administrator, ERP Admin.
technical       Builds and integrates. Developer, IT Manager, Solutions
                Architect, Integration Engineer.
end_user        Uses the system, does not decide about it. Accounts Payable
                Clerk, Warehouse Supervisor, Buyer, Analyst.
`.trim();

export const SUGGEST_TOOL: Anthropic.Tool = {
  name: "suggest_roles",
  description: "Return a role suggestion for each contact you can judge. Omit the rest.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        description:
          "One entry per contact you are reasonably confident about. OMIT a "
          + "contact entirely rather than guessing — a wrong role decides who "
          + "gets emailed.",
        items: {
          type: "object",
          properties: {
            id:   { type: "string", description: "The contact id exactly as given." },
            role: {
              type: "string",
              enum: ["economic_buyer", "champion", "admin", "end_user", "technical"],
            },
            reason: {
              type: "string",
              description: "Short — what in the title led you there. Max 90 characters.",
            },
          },
          required: ["id", "role", "reason"],
        },
      },
    },
    required: ["suggestions"],
  },
};

export const SUGGEST_SYSTEM = `
You are labelling business contacts at customers of a NetSuite implementation
partner, so a customer success manager knows who to talk to about what.

Judge ONLY from the job title. You are not given anything else, and you must not
infer from the person's name, their email address or their employer.

${ROLE_GUIDE}

RULES
- If the title is missing, vague ("Contact", "Info", "Team"), or you genuinely
  cannot tell, OMIT that contact. A shorter list is the right answer. Someone
  will read every suggestion, and a list padded with guesses wastes their
  attention and trains them to click Accept without looking.
- "Manager" alone is not enough. "IT Manager" is technical; "Manager" is not.
- Prefer end_user over champion when the title describes doing the work rather
  than owning the outcome.
- champion is about advocacy, not seniority. A senior person who merely signs
  the cheque is economic_buyer.
- Keep each reason under 90 characters and make it about the title, not the role
  definition: "Runs AP day to day" beats "This is an end user".
`.trim();

export interface ContactForSuggestion {
  id: string;
  name: string;
  jobTitle: string | null;
}

export interface RoleSuggestion {
  id: string;
  role: string;
  reason: string;
}

const ROLES = new Set(["economic_buyer", "champion", "admin", "end_user", "technical"]);

export function suggestionPrompt(contacts: ContactForSuggestion[]): string {
  return [
    "Label these contacts. Omit any you cannot judge from the title alone.",
    "",
    ...contacts.map(c => `${c.id}  ${c.name}  —  ${c.jobTitle ?? "(no job title)"}`),
  ].join("\n");
}

/**
 * Re-validate the model's output.
 *
 * Unknown ids and unknown roles are DROPPED rather than coerced. A suggestion
 * attached to the wrong contact is worse than a missing one, and a coerced role
 * would be a guess about a guess.
 */
export function validateSuggestions(
  raw: unknown,
  known: ContactForSuggestion[],
): { suggestions: RoleSuggestion[]; dropped: number } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const byId = new Map(known.map(c => [c.id, c]));
  const seen = new Set<string>();
  const out: RoleSuggestion[] = [];
  let dropped = 0;

  for (const r of Array.isArray(o.suggestions) ? o.suggestions : []) {
    const s = (r ?? {}) as Record<string, unknown>;
    const id = String(s.id ?? "").trim();
    const role = String(s.role ?? "").trim();

    // A contact without a title was never a candidate, whatever the model says.
    const contact = byId.get(id);
    if (!contact || !contact.jobTitle || !ROLES.has(role) || seen.has(id)) { dropped++; continue; }

    seen.add(id);
    out.push({ id, role, reason: String(s.reason ?? "").trim().slice(0, 90) });
  }
  return { suggestions: out, dropped };
}
