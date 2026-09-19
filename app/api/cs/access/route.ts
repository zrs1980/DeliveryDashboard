import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasCsLayer } from "@/lib/cs-permissions";

export const revalidate = 0;

/**
 * Does the signed-in user hold cs_layer?
 *
 * Exists so the client can decide whether to render the CS tab without the
 * allow-list reaching the browser. lib/cs-permissions.ts is server-only and must
 * stay that way — lib/constants.ts is client-imported, which is why
 * PTO_APPROVER_EMAILS already ships in three browser chunks. Survivable for
 * "who approves leave", not for "who can see which customers we think are
 * churning".
 *
 * Answers 200 with `false` rather than 403: this is a capability probe, not
 * protected data, and a 403 here would be noise in the console on every page
 * load for everyone else. The tab it controls is cosmetic — every CS route
 * enforces requireCsLayer() on its own, so hiding the tab is a courtesy, not
 * the boundary.
 */
export async function GET() {
  const session = await auth();
  return NextResponse.json({ csLayer: hasCsLayer(session?.user?.email) });
}
