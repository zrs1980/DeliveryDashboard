/**
 * Slack error codes mapped to what actually has to change. Slack returns bare
 * codes like "restricted_action", which tell a PM nothing about the fix.
 *
 * `restricted_action` is the common one and is NOT a scope problem: the bot must
 * be added as a collaborator on that specific canvas. OAuth scopes alone don't
 * grant per-canvas access, so a token holding canvases:write still fails on a
 * canvas it hasn't been shared with. Confirmed July 2026 after a workspace
 * migration — every recreated canvas needed the app re-added by hand.
 */
const CANVAS_ERROR_HELP: Record<string, string> = {
  restricted_action:
    "The Slack app isn't a collaborator on this canvas. In Slack, open the canvas → ••• → Share / Manage access → add the app, then retry. Canvas access is per-canvas — the bot's OAuth scopes don't cover it.",
  canvas_not_found:
    "Slack doesn't recognise this canvas ID. If the canvas was recreated (e.g. in a new workspace), update custentity_slack_canvas_id on the NetSuite project record.",
  invalid_auth:
    "SLACK_BOT_TOKEN is invalid. Check the token in Vercel — Vercel does not pick up changed env vars without a redeploy.",
  not_authed:
    "No SLACK_BOT_TOKEN was sent. Confirm it is set in Vercel and that the app has been redeployed since it was added.",
  token_revoked:
    "SLACK_BOT_TOKEN has been revoked. Reinstall the app to the workspace, update the token in Vercel, then redeploy.",
  missing_scope:
    "The bot token is missing the canvases:write scope. Add it in the Slack app config, reinstall to the workspace, update the token in Vercel, then redeploy.",
  no_permission:
    "The bot lacks permission to edit this canvas. Add the app as a collaborator on the canvas, and check workspace-level canvas restrictions.",
};

export async function prependToCanvas(markdown: string, canvasId?: string | null): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const id    = canvasId || process.env.SLACK_WEEKLY_CANVAS_ID;
  // Which canvas was targeted matters when diagnosing: a project with no
  // custentity_slack_canvas_id silently falls back to the workspace default, so
  // the failure can concern a canvas the PM didn't expect to be writing to.
  const source = canvasId ? "project canvas" : "default SLACK_WEEKLY_CANVAS_ID canvas";

  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured.");
  if (!id) {
    throw new Error(
      "No Slack canvas ID for this project. Set custentity_slack_canvas_id on the NetSuite project record, or SLACK_WEEKLY_CANVAS_ID as a fallback.",
    );
  }

  const res = await fetch("https://slack.com/api/canvases.edit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      canvas_id: id,
      changes: [
        {
          operation: "insert_at_start",
          document_content: {
            type: "markdown",
            markdown,
          },
        },
      ],
    }),
  });

  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    const code = data.error ?? "unknown";
    const help = CANVAS_ERROR_HELP[code];
    throw new Error(
      help
        ? `${help}\n\nSlack error: ${code} · canvas ${id} (${source})`
        : `Slack canvases.edit error: ${code} · canvas ${id} (${source})`,
    );
  }
}
