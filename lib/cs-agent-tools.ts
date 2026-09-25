import type Anthropic from "@anthropic-ai/sdk";
import { runSuiteQLAll } from "./netsuite";
import { extractDriveFolderId, listFilesRecursive, readFileText, READABLE_MIME } from "./google-drive";
import { resolveClickUpListId, fetchListTasks } from "./clickup";
import type { CustomerResources } from "./cs-resources";
import type { RunState, AgentDispatch } from "./cs-agent-loop";

/**
 * Read tools shared by every CS agent.
 *
 * Lifted verbatim from the research route. They were already motion-agnostic:
 * `ToolCtx` was a plain object rebuilt on every call with nothing closed over,
 * so every dependency already arrived as a field. That is why this extraction
 * is a move rather than a rewrite.
 *
 * ⚠ EVERY TOOL HERE IS READ-ONLY, AND THAT IS THE POINT. No tool in this file
 * writes to Drive, ClickUp, NetSuite or Supabase. An agent is prevented from
 * changing anything by having no tool that can — not by a prompt asking it not
 * to. If you add a tool here, it reads.
 *
 * ⚠ TOOL FAILURES ARE RETURNED TO THE MODEL AS TEXT, NEVER THROWN. One
 * unreadable file must not end a run that has already read six useful things —
 * the model is told what failed and picks something else. `makeDispatch` holds
 * that contract.
 */

export interface ProjectRow {
  id: number; entityid: string; name: string; statusLabel: string;
  golive: string | null; budgetHours: number | null; remainingHours: number | null;
}

export interface SharedToolCtx {
  state: RunState;
  userEmail: string;
  customerNsId: string;
  res: CustomerResources;
  projects: ProjectRow[];
}

export type ToolImpl<TCtx> = (
  input: Record<string, unknown>,
  ctx: TCtx,
) => Promise<string> | string;

// ─── Definitions ────────────────────────────────────────────────────────────

export const SHARED_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "list_documents",
    description:
      "List the Google Drive files for this customer, newest first, across the "
      + "customer's own folder and every linked project folder. Returns id, name, "
      + "type and modified date — not content. Call this before reading anything.",
    input_schema: {
      type: "object",
      properties: {
        folderUrl: {
          type: "string",
          description: "Optional. Restrict to one folder URL from the snapshot. Omit to list them all.",
        },
      },
    },
  },
  {
    name: "read_document",
    description:
      "Read the text of one Drive file by id, from list_documents. Google Docs, "
      + "Sheets, Slides and text files return text; PDFs return a note saying a "
      + "person must open them. Long files are truncated. Read selectively — you "
      + "have a small budget of calls.",
    input_schema: {
      type: "object",
      properties: { fileId: { type: "string", description: "Drive file id from list_documents." } },
      required: ["fileId"],
    },
  },
  {
    name: "list_projects",
    description:
      "The customer's NetSuite projects: number, name, status, go-live date, "
      + "budgeted and actual hours, and which have a ClickUp list.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_clickup_tasks",
    description:
      "Open and recently-closed ClickUp tasks for one project, with status, "
      + "assignees and due dates. Use it to see what is actually blocked or "
      + "waiting on the customer.",
    input_schema: {
      type: "object",
      properties: { projectNsId: { type: "string", description: "NetSuite project id from list_projects." } },
      required: ["projectNsId"],
    },
  },
  {
    name: "search_support_cases",
    description:
      "Search this customer's support cases by keyword, over title and opening "
      + "message. Returns case number, title, status, date and an excerpt.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Keyword or phrase, e.g. \"integration\" or \"EDI\"." } },
      required: ["query"],
    },
  },
];

/** Evidence kinds these tools produce. A validator's enum must match. */
export const SHARED_SOURCE_KINDS = ["document", "project", "clickup", "case"] as const;

// ─── Implementations ────────────────────────────────────────────────────────

async function toolListDocuments(input: Record<string, unknown>, ctx: SharedToolCtx): Promise<string> {
  const only = String(input.folderUrl ?? "").trim();
  const urls = only ? [only] : ctx.res.driveFolders;
  if (urls.length === 0) return "This customer has no Drive folder linked in NetSuite.";

  const lines: string[] = [];
  for (const url of urls.slice(0, 6)) {
    const id = extractDriveFolderId(url);
    if (!id) { lines.push(`- ${url}: not a folder link this can parse.`); continue; }
    try {
      const { files, truncated } = await listFilesRecursive(ctx.userEmail, id, { maxFiles: 60 });
      lines.push(`\nFOLDER ${url}${truncated ? " (listing truncated)" : ""}`);
      if (files.length === 0) { lines.push("  (empty)"); continue; }
      for (const f of files.slice(0, 40)) {
        const readable = READABLE_MIME.has(f.mimeType) ? "" : "  [not readable as text]";
        lines.push(`  ${f.id}  ${f.modifiedTime?.slice(0, 10) ?? "?"}  ${f.name}${readable}`);
      }
    } catch (e) {
      lines.push(`\nFOLDER ${url}: could not be listed — ${e instanceof Error ? e.message : e}`);
    }
  }
  return lines.join("\n") || "No documents found.";
}

async function toolReadDocument(input: Record<string, unknown>, ctx: SharedToolCtx): Promise<string> {
  const fileId = String(input.fileId ?? "").trim();
  if (!fileId) return "fileId is required.";
  const r = await readFileText(ctx.userEmail, fileId, { maxChars: 18_000 });
  if (r.text === null) return `"${r.name}" could not be read as text: ${r.reason ?? "unsupported format"}.`;
  ctx.state.sources.push({ kind: "document", ref: fileId, label: r.name });
  return `DOCUMENT "${r.name}"${r.truncated ? " (truncated)" : ""}\n\n${r.text}`;
}

function toolListProjects(_input: Record<string, unknown>, ctx: SharedToolCtx): string {
  if (ctx.projects.length === 0) return "No NetSuite projects on this customer.";
  const byId = new Map(ctx.res.projects.map(p => [p.projectNsId, p]));
  return ctx.projects.map(p => {
    const r = byId.get(String(p.id));
    // Appends one row per project on every call; runAgentLoop de-dupes, so
    // calling this twice does not double-count the sources read.
    ctx.state.sources.push({ kind: "project", ref: String(p.id), label: `${p.entityid} ${p.name}` });
    return [
      `PROJECT ${p.entityid} — ${p.name}`,
      `  id=${p.id} status=${p.statusLabel} golive=${p.golive ?? "not set"}`,
      `  budget=${p.budgetHours ?? "?"}h remaining=${p.remainingHours ?? "?"}h`,
      r?.clickupUrl ? "  has a ClickUp list" : "  no ClickUp list",
    ].join("\n");
  }).join("\n");
}

async function toolClickUp(input: Record<string, unknown>, ctx: SharedToolCtx): Promise<string> {
  const pid = String(input.projectNsId ?? "").trim();
  const r = ctx.res.projects.find(p => p.projectNsId === pid);
  if (!r?.clickupUrl) return `Project ${pid} has no ClickUp list linked.`;

  const listId = await resolveClickUpListId(r.clickupUrl);
  if (!listId) return `The ClickUp link on project ${pid} could not be resolved to a list.`;

  const tasks = await fetchListTasks(listId);
  if (tasks.length === 0) return "That ClickUp list has no tasks.";
  ctx.state.sources.push({ kind: "clickup", ref: listId, label: `${r.projectNumber ?? pid} ClickUp` });

  const open = tasks.filter(t => (t.status?.status ?? "").toLowerCase() !== "done");
  return [
    `${tasks.length} tasks, ${open.length} not done.`,
    ...tasks.slice(0, 60).map(t => {
      const due = t.due_date ? new Date(Number(t.due_date)).toISOString().slice(0, 10) : "—";
      const who = (t.assignees ?? []).map(a => a.username).join(", ") || "unassigned";
      return `  ${t.id}  [${t.status?.status ?? "?"}]  due ${due}  ${t.name}  (${who})`;
    }),
  ].join("\n");
}

async function toolCases(input: Record<string, unknown>, ctx: SharedToolCtx): Promise<string> {
  const query = String(input.query ?? "").trim();
  if (!query) return "query is required.";

  // supportcase.company is a customer id OR a job id — 596 of 1080 are jobs —
  // so a straight join to customer loses over half the history.
  const ids = [ctx.customerNsId, ...ctx.projects.map(p => String(p.id))]
    .map(n => parseInt(n, 10)).filter(Number.isFinite);
  if (ids.length === 0) return "No case scope for this customer.";

  const esc = query.replace(/'/g, "''").toLowerCase();
  const rows = await runSuiteQLAll<Record<string, string | null>>(`
    SELECT sc.casenumber, sc.title, BUILTIN.DF(sc.status) AS status_label,
           TO_CHAR(sc.createddate, 'YYYY-MM-DD') AS created,
           sc.incomingmessage
    FROM supportcase sc
    WHERE sc.company IN (${ids.join(",")})
      AND (LOWER(sc.title) LIKE '%${esc}%' OR LOWER(sc.incomingmessage) LIKE '%${esc}%')
    ORDER BY sc.createddate DESC
  `);

  if (!rows?.length) return `No cases matching "${query}".`;
  return rows.slice(0, 15).map(c => {
    ctx.state.sources.push({ kind: "case", ref: String(c.casenumber), label: String(c.title ?? "") });
    const body = String(c.incomingmessage ?? "")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
    return `CASE ${c.casenumber} [${c.status_label}] ${c.created}\n  ${c.title}\n  ${body}`;
  }).join("\n\n");
}

export const SHARED_TOOL_IMPLS: Record<string, ToolImpl<SharedToolCtx>> = {
  list_documents:      toolListDocuments,
  read_document:       toolReadDocument,
  list_projects:       toolListProjects,
  list_clickup_tasks:  toolClickUp,
  search_support_cases: toolCases,
};

/**
 * Build the loop's dispatcher from a tool map.
 *
 * Holds the two contracts the loop relies on: an unknown name is answered, not
 * thrown, and a failing tool returns its error to the model as text so the run
 * continues with one fewer option rather than ending.
 */
export function makeDispatch<TCtx>(
  impls: Record<string, ToolImpl<TCtx>>,
): AgentDispatch<TCtx> {
  return async (name, input, ctx) => {
    const impl = impls[name];
    if (!impl) return `Unknown tool "${name}".`;
    try {
      return await impl(input, ctx as TCtx);
    } catch (e) {
      return `That call failed: ${e instanceof Error ? e.message : String(e)}. Try something else.`;
    }
  };
}

// ─── Projects ───────────────────────────────────────────────────────────────

/** A customer's NetSuite projects. Shared: every CS agent needs them. */
export async function fetchProjects(customerNsId: string): Promise<ProjectRow[]> {
  const rows = await runSuiteQLAll<Record<string, string | null>>(`
    SELECT j.id, j.entityid, j.companyname AS name,
           BUILTIN.DF(j.entitystatus) AS status_label,
           TO_CHAR(j.custentity_project_golive_date, 'YYYY-MM-DD') AS golive,
           j.custentity_ceba_project_budget_hours AS budget_hours,
           j.custentity_project_remaining_hours   AS remaining_hours
    FROM job j
    WHERE j.customer = ${parseInt(customerNsId, 10)}
    ORDER BY j.id DESC
  `);
  return (rows ?? []).map(r => ({
    id: parseInt(String(r.id), 10),
    entityid: String(r.entityid ?? ""),
    name: String(r.name ?? ""),
    statusLabel: String(r.status_label ?? ""),
    golive: r.golive ?? null,
    budgetHours: r.budget_hours ? parseFloat(r.budget_hours) : null,
    remainingHours: r.remaining_hours ? parseFloat(r.remaining_hours) : null,
  }));
}
