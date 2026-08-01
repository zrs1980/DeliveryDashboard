import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchActiveProjects } from "@/lib/netsuite";
import { extractDriveFolderId } from "@/lib/google-drive";

export const revalidate = 0;
export const maxDuration = 30;

/**
 * GET /api/projects/folders
 *
 * Slim list of active NetSuite projects with their Drive folder, for the transcript
 * filing dropdown. Deliberately not /api/projects — that one also fans out to
 * ClickUp for every project, which is far too heavy to populate a dropdown.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await fetchActiveProjects();

    const projects = rows.map(p => {
      const client      = p.customer_name || p.companyname || "";
      const projectName = p.companyname || p.entityid || "";
      const folderId    = extractDriveFolderId(p.project_folder);

      return {
        id:          p.id,
        entityId:    p.entityid,
        client,
        projectName,
        // The concatenation shown in the dropdown.
        label:       [client, projectName].filter(Boolean).join(" — ") || `Project ${p.entityid}`,
        folderUrl:   p.project_folder ?? null,
        folderId,
        // Lets the UI grey out and explain projects that can't be filed to yet.
        hasFolder:   !!folderId,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

    return NextResponse.json({
      projects,
      withFolder:    projects.filter(p => p.hasFolder).length,
      withoutFolder: projects.filter(p => !p.hasFolder).length,
    });
  } catch (err) {
    console.error("[/api/projects/folders]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
