import { NextResponse } from "next/server";

const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const TEAM_ID   = process.env.CLICKUP_TEAM_ID!;
const BASE      = "https://api.clickup.com/api/v2";

function h() {
  return { Authorization: API_TOKEN, "Content-Type": "application/json" };
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: h() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function GET() {
  try {
    // 1. Get all spaces in the workspace
    const spacesData = await get(`/team/${TEAM_ID}/space?archived=false`);
    const spaces = spacesData.spaces ?? [];

    const allLists: Array<{ id: string; name: string; space: string; folder: string | null }> = [];

    for (const space of spaces) {
      // 2. Lists directly in space (no folder)
      try {
        const slData = await get(`/space/${space.id}/list?archived=false`);
        for (const list of (slData.lists ?? [])) {
          allLists.push({ id: list.id, name: list.name, space: space.name, folder: null });
        }
      } catch (e) {
        console.warn("space list error", space.id, e);
      }

      // 3. Folders in space
      try {
        const fData = await get(`/space/${space.id}/folder?archived=false`);
        for (const folder of (fData.folders ?? [])) {
          // Lists inside folder
          try {
            const flData = await get(`/folder/${folder.id}/list?archived=false`);
            for (const list of (flData.lists ?? [])) {
              allLists.push({ id: list.id, name: list.name, space: space.name, folder: folder.name });
            }
          } catch (e) {
            console.warn("folder list error", folder.id, e);
          }
        }
      } catch (e) {
        console.warn("folder error", space.id, e);
      }
    }

    return NextResponse.json({ total: allLists.length, lists: allLists });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
