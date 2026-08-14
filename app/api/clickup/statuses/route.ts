import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchListStatuses, type CUStatus } from "@/lib/clickup";

export const revalidate = 0;

/**
 * Cap on lists per request. The grid asks for every list its visible tasks
 * belong to, which is one per project (~11 today) — the cap is a backstop
 * against a caller passing an unbounded list, not an expected limit.
 */
const MAX_LISTS = 40;

/** ClickUp rate-limits reads; fan out in small batches rather than all at once. */
const CONCURRENCY = 5;

/**
 * GET /api/clickup/statuses?listIds=123,456
 *
 * → { statuses: { [listId]: CUStatus[] }, failed: { [listId]: string } }
 *
 * Batched deliberately: statuses live on the LIST, so the inline status
 * dropdown needs one lookup per distinct list on screen. As separate requests
 * that is a dozen round trips on every load of the tab; here it is one.
 *
 * A list that fails is reported in `failed` rather than failing the request —
 * one unreadable list must not cost every other list its dropdown.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.CLICKUP_API_TOKEN) {
    return NextResponse.json(
      { error: "CLICKUP_API_TOKEN is not configured. Add it in Vercel and redeploy." },
      { status: 503 },
    );
  }

  const listIds = Array.from(new Set(
    (req.nextUrl.searchParams.get("listIds") ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  )).slice(0, MAX_LISTS);

  if (listIds.length === 0) {
    return NextResponse.json({ error: "listIds query param required" }, { status: 400 });
  }

  const statuses: Record<string, CUStatus[]> = {};
  const failed:   Record<string, string>     = {};

  for (let i = 0; i < listIds.length; i += CONCURRENCY) {
    const batch = listIds.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async listId => {
      try {
        statuses[listId] = await fetchListStatuses(listId);
      } catch (e) {
        failed[listId] = e instanceof Error ? e.message : "Unknown error";
      }
    }));
  }

  return NextResponse.json({ statuses, failed });
}
