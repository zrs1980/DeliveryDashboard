import { NextRequest, NextResponse } from "next/server";
import {
  patchRecord, fetchProjectStatusOptions,
  PROJECT_STATUS_FIELD, PROJECT_STATUS_LIST, PROJECT_STATUS_NAMES,
} from "@/lib/netsuite";
import type { ProjectHealth } from "@/lib/types";

// Manually set project status, written to custentity_loop_internal_status on the
// NetSuite project. "unset" writes the "Not set" list value. See
// fetchProjectStatuses in lib/netsuite.ts.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id);
    const { status } = (await req.json()) as { status: ProjectHealth };

    if (!Number.isFinite(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }
    const name = PROJECT_STATUS_NAMES[status];
    if (!name) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    // Looked up per save rather than cached: saves are rare, and a cached id
    // would go stale silently if someone re-creates a list value.
    const options = await fetchProjectStatusOptions();
    const valueId = options[name];
    if (!valueId) {
      return NextResponse.json(
        { error: `"${name}" is not a value on ${PROJECT_STATUS_LIST} in NetSuite` },
        { status: 500 }
      );
    }

    await patchRecord("job", projectId, { [PROJECT_STATUS_FIELD]: { id: valueId } });

    return NextResponse.json({ health: status });
  } catch (err) {
    console.error("[/api/projects/[id]/status]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
