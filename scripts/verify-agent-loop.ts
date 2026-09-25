/**
 * Behaviour check for the shared agent loop.
 *
 *   npx tsx --env-file=.env.local scripts/verify-agent-loop.ts
 *
 * Exercises `runAgentLoop` against the real Anthropic API with STUB tools, so it
 * needs no Supabase, no NetSuite and no Drive. The point is the loop's control
 * flow, which is the part that had to survive extraction from the research
 * route unchanged:
 *
 *   1. a normal run terminates via the terminal tool, with `stopReason: "done"`
 *   2. a run that exhausts its tool budget still PRODUCES output, marked partial
 *   3. the terminal tool is never dispatched and never counted
 *   4. a failing tool returns its error to the model instead of throwing
 *   5. sources are de-duplicated across repeated calls
 *
 * Written because "the research agent behaves identically" is otherwise only
 * checkable by a live run against a deployed database, and the five behaviours
 * above are exactly the ones that look like tidy-up opportunities.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { runAgentLoop, type RunState } from "../lib/cs-agent-loop";
import { makeDispatch, type ToolImpl } from "../lib/cs-agent-tools";

const MODEL = "claude-sonnet-4-6";

interface Ctx { state: RunState }

let dispatched: string[] = [];

const TOOLS: Anthropic.Tool[] = [
  {
    name: "count_widgets",
    description: "Returns how many widgets a colour has. Call it for each colour you need.",
    input_schema: {
      type: "object",
      properties: { colour: { type: "string" } },
      required: ["colour"],
    },
  },
  {
    name: "broken_tool",
    description: "Returns the weight of a widget.",
    input_schema: {
      type: "object",
      properties: { colour: { type: "string" } },
      required: ["colour"],
    },
  },
  {
    name: "submit_total",
    description: "Finish. Submit the total you worked out.",
    input_schema: {
      type: "object",
      properties: {
        total: { type: "number", description: "The total." },
        note:  { type: "string", description: "One sentence on how you got it." },
      },
      required: ["total"],
    },
  },
];

const IMPLS: Record<string, ToolImpl<Ctx>> = {
  count_widgets: (input, ctx) => {
    dispatched.push("count_widgets");
    const colour = String(input.colour ?? "?");
    // Always the same ref, to prove de-duplication across repeated calls.
    ctx.state.sources.push({ kind: "widget", ref: "bag-1", label: "the widget bag" });
    return `${colour}: 7 widgets`;
  },
  broken_tool: () => {
    dispatched.push("broken_tool");
    throw new Error("the scales are broken");
  },
  submit_total: () => {
    // Must never happen — the loop breaks on the terminal tool before dispatch.
    dispatched.push("submit_total");
    return "THE TERMINAL TOOL WAS DISPATCHED";
  },
};

const dispatch = makeDispatch(IMPLS);

function validate(raw: unknown) {
  const o = (raw ?? {}) as Record<string, unknown>;
  return { total: Number(o.total), note: String(o.note ?? "") };
}

const SYSTEM =
  "You are counting widgets. Use count_widgets for each colour you are asked about, "
  + "then call submit_total with the sum. Do not ask questions; just use the tools.";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }

  const base = {
    apiKey, model: MODEL, system: SYSTEM, tools: TOOLS,
    terminalTool: "submit_total", dispatch, validate,
  };

  // ── 1. Normal completion ────────────────────────────────────────────────
  console.log("\n1. Normal run reaches the terminal tool");
  dispatched = [];
  const ok = await runAgentLoop<Ctx, ReturnType<typeof validate>>({
    ...base,
    bounds: { maxToolCalls: 10, timeBudgetMs: 120_000 },
    firstMessage: "How many widgets are there in red and in blue? Sum them.",
    ctx: {} as Ctx,
  });
  check("output produced", ok.output !== null);
  check("stopReason is 'done'", ok.stopReason === "done", ok.stopReason);
  check("not marked partial", ok.partial === false);
  check("terminal tool NOT dispatched", !dispatched.includes("submit_total"),
        dispatched.join(","));
  check("terminal tool NOT counted", ok.state.toolCalls === dispatched.length,
        `toolCalls=${ok.state.toolCalls} dispatched=${dispatched.length}`);
  check("sources de-duplicated", ok.state.sources.length <= 1,
        `${ok.state.sources.length} source(s)`);
  console.log(`      total=${ok.output?.total} calls=${ok.state.toolCalls}`);

  // ── 2. Tool budget exhausted ────────────────────────────────────────────
  console.log("\n2. Exhausting the tool budget still produces output");
  dispatched = [];
  const tight = await runAgentLoop<Ctx, ReturnType<typeof validate>>({
    ...base,
    bounds: { maxToolCalls: 1, timeBudgetMs: 120_000 },
    firstMessage: "How many widgets are there in red, blue, green, orange and violet? Sum them.",
    ctx: {} as Ctx,
  });
  check("output STILL produced (forced submit, not discarded)", tight.output !== null);
  check("stopReason is 'tool_budget'", tight.stopReason === "tool_budget", tight.stopReason);
  check("marked partial", tight.partial === true);
  console.log(`      calls=${tight.state.toolCalls} (budget 1; overshoot by parallel tools is expected)`);

  // ── 3. A throwing tool does not end the run ─────────────────────────────
  console.log("\n3. A failing tool is reported to the model, not thrown");
  dispatched = [];
  const broken = await runAgentLoop<Ctx, ReturnType<typeof validate>>({
    ...base,
    bounds: { maxToolCalls: 8, timeBudgetMs: 120_000 },
    firstMessage:
      "First call broken_tool for red. Whatever it returns, then use count_widgets "
      + "for red and submit_total with that number.",
    ctx: {} as Ctx,
  });
  check("run survived the throwing tool", broken.output !== null);
  check("broken_tool was actually called", dispatched.includes("broken_tool"));
  check("stopReason is 'done'", broken.stopReason === "done", broken.stopReason);

  console.log(failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
