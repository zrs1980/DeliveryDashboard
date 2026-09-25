import Anthropic from "@anthropic-ai/sdk";

/**
 * The bounded, read-only tool-use loop shared by every CS agent.
 *
 * Extracted verbatim from the research route (`/api/cs/research/[customerNsId]`)
 * so the CSM agent builds on it rather than growing a second copy. The research
 * agent must behave identically after the extraction — that is the acceptance
 * test, not a nice-to-have.
 *
 * ⚠ BOUNDS ARE ENFORCED HERE, IN CODE, NOT REQUESTED IN THE PROMPT. An
 * unbounded loop is the thing this design exists to prevent. Hitting a bound
 * FORCES a terminal call rather than discarding the run, and the stop reason is
 * returned so a partial answer is never presented as a considered one.
 *
 * ⚠ THERE IS NO WRITE TOOL, AND THIS FILE CANNOT ADD ONE. It executes whatever
 * `dispatch` is handed. Keeping every CS agent read-only is the caller's job —
 * see the tool sets in lib/cs-agent-tools.ts, none of which mutate anything.
 *
 * Persistence deliberately stays with the caller: run tables differ per agent
 * (`cs_research_runs` vs `cs_agent_runs`) and threading a table/column map
 * through here would add more coupling than it removes.
 */

export interface AgentSource { kind: string; ref: string; label: string }

export interface RunState {
  toolCalls: number;
  started: number;
  sources: AgentSource[];
  /**
   * Accumulated across every turn, because a run is many calls and only the
   * total is meaningful. 08 asks for cost per run to be tracked and budgeted
   * BEFORE the nightly job is enabled — without this, turning on a batch of ten
   * a night is spending blind.
   */
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = "done" | "tool_budget" | "time_budget" | "no_submit";

export interface AgentBounds {
  maxToolCalls: number;
  timeBudgetMs: number;
  maxTokens?: number;
}

export type AgentDispatch<TCtx> = (
  name: string,
  input: Record<string, unknown>,
  ctx: TCtx & { state: RunState },
) => Promise<string>;

export interface AgentLoopSpec<TCtx, TOut> {
  apiKey: string;
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  /**
   * The tool(s) that end the run. Never dispatched, never counted.
   *
   * More than one is allowed because a decision agent has more than one way to
   * finish: the CSM agent ends on `propose_outreach` OR `skip_account`, and a
   * skip is a real outcome rather than a failure.
   */
  terminalTool: string | string[];
  /**
   * Which terminal tool to FORCE when a budget runs out. Defaults to the first.
   * For a decision agent this must be the one that commits to nothing — being
   * out of budget is not a reason to propose contacting a customer.
   */
  forcedTerminal?: string;
  /**
   * Lets a terminal tool refuse to be terminal.
   *
   * 08-CSM-AGENT.md requires `propose_outreach` to run its server-side checks
   * (contact valid? motion's trigger holding? facts cited real?) and, on
   * failure, hand the reason BACK to the model so it can choose again — at the
   * cost of a tool call. Without this the only options are ending the run on a
   * proposal that failed its checks, or silently accepting it.
   *
   * Returning `{ ok: false }` makes the call behave like an ordinary tool
   * result: the reason goes back as text and the loop continues.
   */
  isTerminal?: (
    name: string,
    input: Record<string, unknown>,
    ctx: TCtx & { state: RunState },
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  bounds: AgentBounds;
  firstMessage: string;
  ctx: TCtx;
  dispatch: AgentDispatch<TCtx>;
  /**
   * Turn the terminal tool'''s input into the run'''s output.
   *
   * Receives the tool NAME because an agent with several terminal tools has
   * several output shapes — the CSM agent'''s propose_outreach and skip_account
   * are different records. Passing it here rather than having the caller stash
   * it keeps the loop re-entrant: two runs in the same serverless instance must
   * not be able to read each other'''s last terminal.
   */
  validate: (raw: unknown, terminalName: string) => TOut;
  /**
   * Called after each batch of tool results. Lets the caller heartbeat a run
   * row — without it a killed process leaves a run stuck at "running" forever,
   * which is how the research runs behaved before this extraction.
   */
  onProgress?: (state: RunState) => void | Promise<void>;
}

export interface AgentLoopResult<TOut> {
  /** Null when the agent never called a terminal tool. */
  output: TOut | null;
  /** Which terminal tool ended the run. Null when none did. */
  terminalUsed: string | null;
  stopReason: StopReason;
  state: RunState;
  durationMs: number;
  /** Ran out of budget — the answer is a first pass, not a conclusion. */
  partial: boolean;
}

export async function runAgentLoop<TCtx, TOut>(
  spec: AgentLoopSpec<TCtx, TOut>,
): Promise<AgentLoopResult<TOut>> {
  const state: RunState = {
    toolCalls: 0, started: Date.now(), sources: [],
    inputTokens: 0, outputTokens: 0,
  };
  const anthropic = new Anthropic({ apiKey: spec.apiKey });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: spec.firstMessage },
  ];

  const terminals = Array.isArray(spec.terminalTool) ? spec.terminalTool : [spec.terminalTool];
  const forced = spec.forcedTerminal ?? terminals[0];
  const terminalList = terminals.length > 1
    ? `${terminals.slice(0, -1).join(", ")} or ${terminals[terminals.length - 1]}`
    : terminals[0];

  let stopReason: StopReason = "done";
  let output: TOut | null = null;
  /** Which terminal tool actually ended the run. */
  let terminalUsed: string | null = null;

  for (;;) {
    if (state.toolCalls >= spec.bounds.maxToolCalls) stopReason = "tool_budget";
    if (Date.now() - state.started > spec.bounds.timeBudgetMs) stopReason = "time_budget";

    // ⚠ `exhausted` is ANY non-"done" reason, which deliberately folds
    // `no_submit` in with the two budget stops: a reply that called no tool also
    // gets a FORCED terminal call on the next turn. Narrowing this to the two
    // budget reasons looks tidier and silently removes that forcing.
    const exhausted = stopReason !== "done";
    if (exhausted) {
      // Out of budget: make it submit what it has rather than discarding the
      // run. A partial answer that says it is partial beats nothing.
      messages.push({
        role: "user",
        content: `Budget reached. Call ${forced} now with what you have established so far.`,
      });
    }

    const reply: Anthropic.Message = await anthropic.messages.create({
      model: spec.model,
      max_tokens: spec.bounds.maxTokens ?? 8_000,
      system: spec.system,
      tools: spec.tools,
      tool_choice: exhausted
        ? { type: "tool", name: forced }
        : { type: "auto" },
      messages,
    });

    state.inputTokens  += reply.usage?.input_tokens  ?? 0;
    state.outputTokens += reply.usage?.output_tokens ?? 0;

    messages.push({ role: "assistant", content: reply.content });

    const toolUses = reply.content.filter(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use");

    // A terminal tool bypasses both the dispatcher and the call counter — but
    // only once it has agreed to be terminal.
    const terminal = toolUses.find(t => terminals.includes(t.name));
    if (terminal) {
      const input = (terminal.input ?? {}) as Record<string, unknown>;
      const verdict = spec.isTerminal
        ? await spec.isTerminal(terminal.name, input, { ...spec.ctx, state })
        : { ok: true as const };

      if (verdict.ok) {
        output = spec.validate(input, terminal.name);
        terminalUsed = terminal.name;
        break;
      }

      // Refused. It costs a tool call, deliberately: a model that keeps
      // proposing invalid outreach must run out of budget rather than looping.
      state.toolCalls++;
      messages.push({
        role: "user",
        content: [{
          type: "tool_result" as const, tool_use_id: terminal.id,
          content: verdict.reason,
        }],
      });
      continue;
    }

    if (toolUses.length === 0) {
      // It stopped without finishing. One nudge, then give up rather than
      // looping on a model that has decided it is done.
      if (stopReason === "no_submit") break;
      stopReason = "no_submit";
      messages.push({ role: "user", content: `Call ${terminalList} to finish.` });
      continue;
    }

    // ⚠ Resets a prior `no_submit`, and must stay between the zero-tool block
    // above and the execution below. A budget stop re-fires at the top of the
    // next iteration, so this cannot un-stick one of those.
    stopReason = "done";

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      // ⚠ PER TOOL-USE BLOCK, not per model turn — a parallel three-tool reply
      // costs three. The budget is checked at the top of the iteration, so it
      // can overshoot by (tools-in-turn − 1). Counting per turn would silently
      // widen the effective budget.
      state.toolCalls++;
      const content = await spec.dispatch(
        t.name, (t.input ?? {}) as Record<string, unknown>,
        { ...spec.ctx, state });
      results.push({ type: "tool_result", tool_use_id: t.id, content });
    }
    messages.push({ role: "user", content: results });

    // De-duped here rather than in the tools: some tools append a source row per
    // item on every call, so calling one twice would double-count.
    state.sources = dedupeSources(state.sources);

    if (spec.onProgress) await spec.onProgress(state);
  }

  return {
    output,
    terminalUsed,
    stopReason,
    state,
    durationMs: Date.now() - state.started,
    partial: stopReason === "tool_budget" || stopReason === "time_budget",
  };
}

function dedupeSources(sources: AgentSource[]): AgentSource[] {
  const seen = new Set<string>();
  const out: AgentSource[] = [];
  for (const s of sources) {
    const key = `${s.kind} ${s.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
