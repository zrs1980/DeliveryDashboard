import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { DriveError, listProjectFolders } from "@/lib/google-drive";

export const revalidate = 0;
export const maxDuration = 30;

/**
 * GET /api/drive/projects?customerId=<folderId>
 * Project folders inside that customer's Projects container.
 *
 * `fellBackToCustomerFolder` is true when no Projects container was found and the
 * customer folder's own subfolders are being offered instead — surfaced so the UI
 * can say so rather than quietly showing the wrong level of the tree.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId is required" }, { status: 400 });

  try {
    const result = await listProjectFolders(session.user.email, customerId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/drive/projects]", err);
    const isDrive = err instanceof DriveError;
    return NextResponse.json(
      {
        error: isDrive ? err.message : err instanceof Error ? err.message : "Unknown error",
        needsReauth: isDrive && (err.code === "reauth" || err.code === "no_token"),
      },
      { status: isDrive && err.code === "reauth" ? 403 : 500 },
    );
  }
}
