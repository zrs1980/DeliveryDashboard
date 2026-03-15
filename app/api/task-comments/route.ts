import { NextRequest, NextResponse } from "next/server";

const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const BASE_URL  = "https://api.clickup.com/api/v2";

interface CUComment {
  id: string;
  comment_text: string;
  user: { username: string; profilePicture: string | null };
  date: string; // Unix ms as string
}

export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.get("taskIds");
  if (!ids) return NextResponse.json({ comments: {} });

  const taskIds = ids.split(",").filter(Boolean).slice(0, 20); // cap at 20

  const results = await Promise.allSettled(
    taskIds.map(async taskId => {
      const res = await fetch(
        `${BASE_URL}/task/${taskId}/comment?reverse=true`,
        { headers: { Authorization: API_TOKEN } },
      );
      if (!res.ok) return { taskId, lastComment: null };
      const data = await res.json();
      const comments: CUComment[] = data.comments ?? [];
      if (comments.length === 0) return { taskId, lastComment: null };
      const c = comments[0]; // newest first (reverse=true)
      return {
        taskId,
        lastComment: {
          text:   c.comment_text || "(no text)",
          author: c.user?.username ?? "Unknown",
          date:   c.date ? new Date(parseInt(c.date)).toLocaleDateString("en-AU", {
            day: "numeric", month: "short", year: "numeric",
          }) : "",
        },
      };
    })
  );

  const comments: Record<string, { text: string; author: string; date: string } | null> = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      comments[r.value.taskId] = r.value.lastComment;
    }
  }

  return NextResponse.json({ comments });
}
