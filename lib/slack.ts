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

/**
 * Posting to a channel fails for different reasons than editing a canvas, and the
 * remedies aren't interchangeable — a channel the bot was never invited to is the
 * common one, and it looks nothing like a canvas collaborator problem.
 */
const CHANNEL_ERROR_HELP: Record<string, string> = {
  channel_not_found:
    "Slack doesn't recognise that channel. Check custentity_slack_channel on the NetSuite project — it should hold the channel name (e.g. \"oxide\"), not a URL or channel ID.",
  not_in_channel:
    "The Slack app isn't a member of this channel. Either invite it (/invite @<app> in the channel) or add the chat:write.public scope, then reinstall and redeploy.",
  is_archived:
    "That Slack channel is archived, so nothing can be posted to it. Update custentity_slack_channel on the NetSuite project.",
  invalid_auth:
    "SLACK_BOT_TOKEN is invalid. Check the token in Vercel — Vercel does not pick up changed env vars without a redeploy.",
  not_authed:
    "No SLACK_BOT_TOKEN was sent. Confirm it is set in Vercel and that the app has been redeployed since it was added.",
  token_revoked:
    "SLACK_BOT_TOKEN has been revoked. Reinstall the app to the workspace, update the token in Vercel, then redeploy.",
  missing_scope:
    "The bot token is missing the chat:write scope. Add it in the Slack app config, reinstall to the workspace, update the token in Vercel, then redeploy.",
};

export interface PostedMessage { channel: string; ts: string }

/**
 * Post a plain message to a channel.
 *
 * The channel comes from custentity_slack_channel on the NetSuite job, which holds
 * a bare name ("oxide"). chat.postMessage accepts a name or an ID, so both the
 * "#oxide" and "C0123" forms work without translation.
 */
export async function postToChannel(channel: string, text: string): Promise<PostedMessage> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured.");

  const target = channel.trim();
  if (!target) {
    throw new Error(
      "No Slack channel for this project. Set custentity_slack_channel on the NetSuite project record.",
    );
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: target, text, unfurl_links: false }),
  });

  const data = (await res.json()) as { ok: boolean; error?: string; ts?: string; channel?: string };
  if (!data.ok) {
    const code = data.error ?? "unknown";
    const help = CHANNEL_ERROR_HELP[code];
    throw new Error(
      help
        ? `${help}\n\nSlack error: ${code} · channel ${target}`
        : `Slack chat.postMessage error: ${code} · channel ${target}`,
    );
  }

  return { channel: data.channel ?? target, ts: data.ts ?? "" };
}

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

// ─── Direct messages ─────────────────────────────────────────────────────────
//
// ⚠ THE BOT TOKEN CANNOT DO THIS TODAY, AND THE FAILURE IS DELIBERATE RATHER
// THAN HIDDEN. Probed October 2026: `auth.test` succeeds (team Loop), but
// `users.lookupByEmail` and `conversations.list` both return `missing_scope`.
// Posting to a channel works; finding a person does not.
//
// To turn DMs on, add these to the Slack app's Bot Token Scopes and reinstall:
//
//     users:read          read the member list
//     users:read.email    match a member to their email address
//     im:write            open a DM conversation with them
//
// Until then `dmByEmail` throws a message naming those three, and the digest
// falls back to a channel rather than silently sending nothing.

export class SlackScopeError extends Error {}

async function slack(method: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const token = process.env.SLACK_BOT_TOKEN;
  const res = await fetch(`https://slack.com/api/${method}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
  return await res.json() as Record<string, unknown>;
}

/**
 * DM one person, found by their email address.
 *
 * Throws SlackScopeError when the token cannot look people up, so the caller
 * can fall back rather than treating it as a transient failure.
 */
export async function dmByEmail(email: string, text: string): Promise<PostedMessage> {
  if (!process.env.SLACK_BOT_TOKEN) throw new Error("SLACK_BOT_TOKEN is not set.");

  const look = await slack(`users.lookupByEmail?email=${encodeURIComponent(email)}`);
  if (!look.ok) {
    if (look.error === "missing_scope") {
      throw new SlackScopeError(
        "Slack cannot look up people by email. Add users:read, users:read.email and "
        + "im:write to the app's Bot Token Scopes and reinstall it.");
    }
    if (look.error === "users_not_found") {
      throw new Error(`No Slack member has the address ${email}.`);
    }
    throw new Error(`Slack users.lookupByEmail: ${look.error}`);
  }

  const userId = (look.user as { id?: string } | undefined)?.id;
  if (!userId) throw new Error(`Slack returned no user id for ${email}.`);

  const open = await slack("conversations.open", {
    method: "POST", body: JSON.stringify({ users: userId }),
  });
  if (!open.ok) {
    if (open.error === "missing_scope") {
      throw new SlackScopeError("Slack cannot open a DM. Add im:write to the app's Bot Token Scopes.");
    }
    throw new Error(`Slack conversations.open: ${open.error}`);
  }

  const channel = (open.channel as { id?: string } | undefined)?.id;
  if (!channel) throw new Error("Slack opened no DM channel.");
  return postToChannel(channel, text);
}
