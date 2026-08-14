import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchTaskComments, postTaskComment } from "@/lib/clickup";

export const revalidate = 0;

/** ClickUp accepts far more, but a runaway paste is not a comment. */
const MAX_COMMENT_CHARS = 10_000;

function guardToken() {
  if (process.env.CLICKUP_API_TOKEN) return null;
  return NextResponse.json(
    { error: "CLICKUP_API_TOKEN is not configured. Add it in Vercel and redeploy." },
    { status: 503 },
  );
}

/** GET /api/clickup/comments?taskId=abc → { comments } (oldest first) */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const blocked = guardToken();
  if (blocked) return blocked;

  const taskId = (req.nextUrl.searchParams.get("taskId") ?? "").trim();
  if (!taskId) return NextResponse.json({ error: "taskId query param required" }, { status: 400 });

  try {
    return NextResponse.json({ comments: await fetchTaskComments(taskId) });
  } catch (err) {
    console.error("[/api/clickup/comments GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/clickup/comments
 * { taskId, comment }
 *
 * Returns the reloaded thread so the panel shows the posted comment as ClickUp
 * stored it, rather than a local echo that could differ from what landed.
 *
 * The author is taken from the SESSION, never from the request body — the
 * signed-in user is the one fact the client must not be able to choose, since
 * this name is the only attribution the comment carries (the shared personal
 * token means ClickUp itself records every dashboard comment as one user).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const blocked = guardToken();
  if (blocked) return blocked;

  let body: { taskId?: unknown; comment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const taskId  = String(body?.taskId ?? "").trim();
  const comment = String(body?.comment ?? "").trim();

  if (!taskId)  return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  if (!comment) return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
  if (comment.length > MAX_COMMENT_CHARS) {
    return NextResponse.json(
      { error: `Comment is too long (${comment.length} characters, max ${MAX_COMMENT_CHARS}).` },
      { status: 400 },
    );
  }

  const author = session.user.name ?? session.user.email ?? null;

  try {
    await postTaskComment(taskId, comment, author);
  } catch (err) {
    console.error("[/api/clickup/comments POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }

  // The comment is already posted by this point. A failure to re-read the thread
  // must not be reported as a failure to comment, or the PM posts it twice.
  try {
    return NextResponse.json({ comments: await fetchTaskComments(taskId) });
  } catch {
    return NextResponse.json({
      comments: null,
      warning:  "The comment was posted, but the thread could not be reloaded. Reopen this panel to see it.",
    });
  }
}
