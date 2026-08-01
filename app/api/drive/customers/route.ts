import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { DriveError, listCustomerFolders } from "@/lib/google-drive";
import { DRIVE_CUSTOMER_ROOT_FOLDER_ID } from "@/lib/constants";

export const revalidate = 0;
export const maxDuration = 30;

/** GET /api/drive/customers → customer folders under the configured root. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const customers = await listCustomerFolders(session.user.email);
    return NextResponse.json({ customers, rootFolderId: DRIVE_CUSTOMER_ROOT_FOLDER_ID });
  } catch (err) {
    console.error("[/api/drive/customers]", err);
    const isDrive = err instanceof DriveError;
    return NextResponse.json(
      {
        error: isDrive ? err.message : err instanceof Error ? err.message : "Unknown error",
        // Lets the UI offer a sign-out link rather than just showing a message.
        needsReauth: isDrive && (err.code === "reauth" || err.code === "no_token"),
      },
      { status: isDrive && err.code === "reauth" ? 403 : 500 },
    );
  }
}
