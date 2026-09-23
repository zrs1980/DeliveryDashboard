import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireCsLayer } from "@/lib/cs-permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runSuiteQLAll } from "@/lib/netsuite";
import { fetchCustomerResources, type CustomerResources } from "@/lib/cs-resources";
import { listFilesRecursive, readFileText, extractDriveFolderId, READABLE_MIME } from "@/lib/google-drive";
import { resolveClickUpListId, fetchListTasks } from "@/lib/clickup";
import {
  RESEARCH_MODEL, RESEARCH_TOOLS, RESEARCH_SYSTEM,
  MAX_TOOL_CALLS, TIME_BUDGET_MS, validateResearch,
} from "@/lib/cs-research";

export const revalidate = 0;
export const maxDuration = 300;

/**
 * POST /api/cs/research/[customerNsId] — run the research agent.
 * GET  — recent runs for this customer.
 *
 * A bounded, READ-ONLY tool-use loop. See lib/cs-research.ts for why this is
 * the one place an agent is warranted and what the bounds are.
 *
 * ⚠ THE LOOP IS BOUNDED IN CODE, NOT IN THE PROMPT. MAX_TOOL_CALLS and
 * TIME_BUDGET_MS are enforced here, and hitting either is recorded as the stop
 * reason so a partial answer is never presented as a considered one.
 *
 * ⚠ A TOOL FAILURE IS RETURNED TO THE MODEL, NOT THROWN. One unreadable file or
 * one ClickUp timeout must not end a run that has already read six useful
 * things — the model is told what failed and picks something else.
 */

interface RunState {
  toolCalls: number;
  started: number;
  sources: { kind: string; ref: string; label: string }[];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ customerNsId: string }> },
) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;
  const { customerNsId } = await params;

  const { data, error } = await getSupabaseAdmin()
    .from("cs_research_runs").select("*")
    .eq("customer_ns_id", customerNsId)
    .order("created_at", { ascending: false }).limit(10);

  if (error) {
    return NextResponse.json({
      error: error.message,
      hint: "Run supabase/cs-research-schema.sql in the Supabase SQL Editor.",
    }, { status: 503 });
  }
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ customerNsId: string }> },
) {
  const gate = await requireCsLayer();
  if (gate.response) return gate.response;

  const { customerNsId } = await params;
  const userEmail = gate.session.email;
  const supabase  = getSupabaseAdmin();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  }

  // ── Snapshot ────────────────────────────────────────────────────────────
  const resourceMap = await fetchCustomerResources([customerNsId]);
  const res: CustomerResources | undefined = resourceMap[customerNsId];
  if (!res) {
    return NextResponse.json({ error: "No active customer with that id." }, { status: 404 });
  }

  const projects = await fetchProjects(customerNsId);

  // Refusing up front beats burning a model call to discover there is nothing
  // to read, and says which of the two problems it is.
  if (!res.hasAny && projects.length === 0) {
    return NextResponse.json({
      error: `${res.customerName} has no Drive folder, ClickUp list, Slack channel or project `
           + "linked in NetSuite, so there is nothing for the agent to read. Link a project "
           + "folder or ClickUp list on the NetSuite record first.",
      nothingToRead: true,
    }, { status: 422 });
  }

  const { data: run, error: runErr } = await supabase.from("cs_research_runs").insert({
    customer_ns_id: customerNsId,
    customer_name:  res.customerName,
    status:         "running",
    model:          RESEARCH_MODEL,
    run_by:         userEmail,
  }).select().single();

  if (runErr) {
    return NextResponse.json({
      error: runErr.message,
      hint: "Run supabase/cs-research-schema.sql in the Supabase SQL Editor.",
    }, { status: 503 });
  }

  const state: RunState = { toolCalls: 0, started: Date.now(), sources: [] };
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: snapshotPrompt(res, projects),
  }];

  let stopReason = "done";
  let output: ReturnType<typeof validateResearch> | null = null;

  try {
    // ── The loop ──────────────────────────────────────────────────────────
    for (;;) {
      if (state.toolCalls >= MAX_TOOL_CALLS) { stopReason = "tool_budget"; }
      if (Date.now() - state.started > TIME_BUDGET_MS) { stopReason = "time_budget"; }

      const exhausted = stopReason !== "done";
      if (exhausted) {
        // Out of budget: make it submit what it has rather than discarding the
        // run. A partial answer that says it is partial beats nothing.
        messages.push({
          role: "user",
          content: "Budget reached. Call submit_findings now with what you have established so far.",
        });
      }

      const reply: Anthropic.Message = await anthropic.messages.create({
        model: RESEARCH_MODEL,
        max_tokens: 8_000,
        system: RESEARCH_SYSTEM,
        tools: RESEARCH_TOOLS,
        tool_choice: exhausted
          ? { type: "tool", name: "submit_findings" }
          : { type: "auto" },
        messages,
      });

      messages.push({ role: "assistant", content: reply.content });

      const toolUses = reply.content.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use");

      const submit = toolUses.find(t => t.name === "submit_findings");
      if (submit) { output = validateResearch(submit.input); break; }

      if (toolUses.length === 0) {
        // It stopped without submitting. One nudge, then give up rather than
        // looping on a model that has decided it is finished.
        if (stopReason === "no_submit") { break; }
        stopReason = "no_submit";
        messages.push({ role: "user", content: "Call submit_findings to finish." });
        continue;
      }
      stopReason = "done";

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const t of toolUses) {
        state.toolCalls++;
        const content = await runTool(t, { res, projects, userEmail, customerNsId, state });
        results.push({ type: "tool_result", tool_use_id: t.id, content });
      }
      messages.push({ role: "user", content: results });
    }

    if (!output) {
      await supabase.from("cs_research_runs").update({
        status: "stopped", stop_reason: stopReason || "no_submit",
        tool_calls: state.toolCalls, sources_read: state.sources,
        duration_ms: Date.now() - state.started, completed_at: new Date().toISOString(),
        error: "The agent stopped without submitting findings.",
      }).eq("id", run.id);
      return NextResponse.json({
        error: "The agent stopped without submitting findings.",
        runId: run.id, toolCalls: state.toolCalls,
      }, { status: 502 });
    }

    await supabase.from("cs_research_runs").update({
      status: "complete",
      stop_reason: stopReason,
      summary:     output.summary,
      findings:    output.findings,
      next_steps:  output.nextSteps,
      sources_read: state.sources,
      tool_calls:  state.toolCalls,
      duration_ms: Date.now() - state.started,
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);

    return NextResponse.json({
      runId: run.id,
      customerName: res.customerName,
      ...output,
      stopReason,
      toolCalls: state.toolCalls,
      sourcesRead: state.sources,
      durationMs: Date.now() - state.started,
      // Surfaced, not buried: a partial run and a complete one must not look
      // the same to whoever reads the findings.
      partial: stopReason === "tool_budget" || stopReason === "time_budget",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await supabase.from("cs_research_runs").update({
      status: "failed", stop_reason: "error", error: msg,
      tool_calls: state.toolCalls, sources_read: state.sources,
      duration_ms: Date.now() - state.started, completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    return NextResponse.json({ error: msg, runId: run.id }, { status: 502 });
  }
}

// ─── Tools ──────────────────────────────────────────────────────────────────

interface ToolCtx {
  res: CustomerResources;
  projects: ProjectRow[];
  userEmail: string;
  customerNsId: string;
  state: RunState;
}

async function runTool(t: Anthropic.ToolUseBlock, ctx: ToolCtx): Promise<string> {
  const input = (t.input ?? {}) as Record<string, unknown>;
  try {
    switch (t.name) {
      case "list_documents":     return await toolListDocuments(input, ctx);
      case "read_document":      return await toolReadDocument(input, ctx);
      case "list_projects":      return toolListProjects(ctx);
      case "list_clickup_tasks": return await toolClickUp(input, ctx);
      case "search_support_cases": return await toolCases(input, ctx);
      default: return `Unknown tool "${t.name}".`;
    }
  } catch (e) {
    // Returned to the model so it can choose differently, not thrown.
    return `That call failed: ${e instanceof Error ? e.message : String(e)}. Try something else.`;
  }
}

async function toolListDocuments(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
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

async function toolReadDocument(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const fileId = String(input.fileId ?? "").trim();
  if (!fileId) return "fileId is required.";
  const r = await readFileText(ctx.userEmail, fileId, { maxChars: 18_000 });
  if (r.text === null) return `"${r.name}" could not be read as text: ${r.reason ?? "unsupported format"}.`;
  ctx.state.sources.push({ kind: "document", ref: fileId, label: r.name });
  return `DOCUMENT "${r.name}"${r.truncated ? " (truncated)" : ""}\n\n${r.text}`;
}

function toolListProjects(ctx: ToolCtx): string {
  if (ctx.projects.length === 0) return "No NetSuite projects on this customer.";
  const byId = new Map(ctx.res.projects.map(p => [p.projectNsId, p]));
  return ctx.projects.map(p => {
    const r = byId.get(String(p.id));
    ctx.state.sources.push({ kind: "project", ref: String(p.id), label: `${p.entityid} ${p.name}` });
    return [
      `PROJECT ${p.entityid} — ${p.name}`,
      `  id=${p.id} status=${p.statusLabel} golive=${p.golive ?? "not set"}`,
      `  budget=${p.budgetHours ?? "?"}h remaining=${p.remainingHours ?? "?"}h`,
      r?.clickupUrl ? "  has a ClickUp list" : "  no ClickUp list",
    ].join("\n");
  }).join("\n");
}

async function toolClickUp(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
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

async function toolCases(input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
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

// ─── Snapshot ───────────────────────────────────────────────────────────────

interface ProjectRow {
  id: number; entityid: string; name: string; statusLabel: string;
  golive: string | null; budgetHours: number | null; remainingHours: number | null;
}

async function fetchProjects(customerNsId: string): Promise<ProjectRow[]> {
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

function snapshotPrompt(res: CustomerResources, projects: ProjectRow[]): string {
  const live = projects.filter(p => /progress/i.test(p.statusLabel));
  return [
    `CUSTOMER: ${res.customerName} (NetSuite id ${res.customerNsId})`,
    "",
    `Projects: ${projects.length} total, ${live.length} in progress.`,
    `Drive folders linked: ${res.driveFolders.length}`,
    `ClickUp lists linked: ${res.clickupUrls.length}`,
    `Slack channels linked: ${res.slackChannels.length}`,
    res.lastSalesActivity.date
      ? `Last sales activity recorded in NetSuite: ${res.lastSalesActivity.date}`
        + `${res.lastSalesActivity.name ? ` — ${res.lastSalesActivity.name}` : ""}`
      : "No last sales activity recorded.",
    "",
    "Research this account and submit what you find. Start by seeing what is there.",
  ].join("\n");
}
