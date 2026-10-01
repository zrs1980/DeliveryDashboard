import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cs-permissions";
import { buildDigests, renderDigest } from "@/lib/digest";
import { dmByEmail, postToChannel, SlackScopeError } from "@/lib/slack";

export const revalidate  = 0;
export const maxDuration = 120;

/**
 * The morning digest — the first thing in this app that reaches a person who
 * is not already looking at it.
 *
 * ⚠ IT SENDS TO NOBODY UNTIL `DIGEST_RECIPIENTS` IS SET, AND THAT DEFAULT IS
 * THE POINT. A daily message that is wrong or noisy gets muted within a week,
 * and a muted channel is worse than no channel — so the safe state is a dry
 * run that reports what it WOULD send. Put one address in the variable, read a
 * few days of your own, then widen it.
 *
 *     DIGEST_RECIPIENTS = zabe@cebasolutions.com
 *     DIGEST_RECIPIENTS = *                        (everyone, once it is trusted)
 *
 * ⚠ DMs NEED THREE SCOPES THE TOKEN DOES NOT HAVE. Verified October 2026:
 * users.lookupByEmail and conversations.list both return missing_scope. Until
 * `users:read`, `users:read.email` and `im:write` are added and the app
 * reinstalled, each digest falls back to `DIGEST_SLACK_CHANNEL` with the
 * person's name on it. The fallback is announced in the response rather than
 * being silently different from what was asked for.
 *
 * Nobody with an empty digest is messaged at all — silence is a valid output,
 * and "nothing today" every day is how people learn to ignore the one that
 * matters.
 */
export async function GET(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const allow = String(process.env.DIGEST_RECIPIENTS ?? "").trim();
  const channel = String(process.env.DIGEST_SLACK_CHANNEL ?? "").trim();
  const wanted = allow === "*"
    ? null                                    // everyone
    : new Set(allow.split(/[,\s]+/).filter(Boolean).map(s => s.toLowerCase()));

  try {
    const digests = await buildDigests();
    const targets = wanted ? digests.filter(d => wanted.has(d.email)) : digests;

    if (!allow) {
      return NextResponse.json({
        ok: true, sent: 0, dryRun: true,
        wouldSend: digests.map(d => ({ email: d.email, items: d.total })),
        note: "DIGEST_RECIPIENTS is not set, so nothing was sent. Set it to one "
            + "address to trial, or * once the content is trusted.",
      });
    }

    const sent: string[] = [];
    const warnings: string[] = [];
    let scopeFallback = false;

    for (const d of targets) {
      const text = renderDigest(d);
      try {
        await dmByEmail(d.email, text);
        sent.push(d.email);
      } catch (e) {
        if (e instanceof SlackScopeError) {
          scopeFallback = true;
          if (!channel) {
            warnings.push(`${d.email}: no DM scope and no DIGEST_SLACK_CHANNEL to fall back to.`);
            continue;
          }
          try {
            await postToChannel(channel, `*Digest for ${d.name ?? d.email}*\n\n${text}`);
            sent.push(`${d.email} (via ${channel})`);
          } catch (e2) {
            warnings.push(`${d.email}: channel fallback failed — ${e2 instanceof Error ? e2.message : "unknown"}`);
          }
        } else {
          warnings.push(`${d.email}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      sent: sent.length,
      recipients: sent,
      skippedEmpty: digests.length - targets.length,
      ...(scopeFallback && {
        scopeNote: "Sent to a channel rather than by DM: the bot token lacks "
                 + "users:read, users:read.email and im:write.",
      }),
      warnings,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
