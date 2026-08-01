// ─── Google Drive — customer / project folder tree + doc filing ───────────────
//
// Structure this assumes:
//   <customer root>/ <Customer> / <Projects> / <Specific project> / …meeting docs
//
// Uses the signed-in user's OAuth token (NextAuth stores it in google_tokens), so
// docs are created as that person and inherit the folder's sharing. Needs the
// drive scope — see auth.ts.

import { google, type drive_v3 } from "googleapis";
import { getGoogleClient } from "./google-tokens";
import { DRIVE_CUSTOMER_ROOT_FOLDER_ID, DRIVE_PROJECTS_FOLDER_NAMES } from "./constants";

export class DriveError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "DriveError";
  }
}

export interface DriveFolder {
  id:   string;
  name: string;
}

export interface CreatedDoc {
  id:          string;
  name:        string;
  webViewLink: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Escape a value for a Drive query string literal. */
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function driveFor(userEmail: string): Promise<drive_v3.Drive> {
  const authClient = await getGoogleClient(userEmail);
  if (!authClient) {
    throw new DriveError(
      "No Google account is connected for you. Sign out and sign back in to grant Drive access.",
      "no_token",
    );
  }
  return google.drive({ version: "v3", auth: authClient });
}

/** Map Google's errors onto something a PM can act on. */
function wrapDriveError(e: unknown, context: string): DriveError {
  const err = e as { code?: number; message?: string; errors?: Array<{ reason?: string }> };
  const reason = err?.errors?.[0]?.reason ?? "";
  const status = err?.code;

  if (status === 401 || reason === "authError") {
    return new DriveError(
      "Google rejected the access token. Sign out and sign back in — the Drive permission was added recently, and existing sessions carry the older scopes.",
      "reauth",
    );
  }
  if (status === 403 && /insufficient/i.test(err?.message ?? "")) {
    return new DriveError(
      "Your Google session doesn't include Drive permission. Sign out and sign back in to grant it.",
      "reauth",
    );
  }
  if (status === 404) {
    return new DriveError(`${context}: folder not found, or your Google account can't see it.`, "not_found");
  }
  return new DriveError(`${context}: ${err?.message ?? "unknown Drive error"}`, String(status ?? ""));
}

/** Subfolders of a folder, alphabetical. Handles shared drives. */
async function listSubfolders(drive: drive_v3.Drive, parentId: string, context: string): Promise<DriveFolder[]> {
  const out: DriveFolder[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const res = await drive.files.list({
        q: `'${q(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: "nextPageToken, files(id, name)",
        pageSize: 200,
        orderBy: "name",
        // Required for folders living in a shared drive, which a team customer
        // folder almost certainly is.
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      });
      for (const f of res.data.files ?? []) {
        if (f.id && f.name) out.push({ id: f.id, name: f.name });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (e) {
    throw wrapDriveError(e, context);
  }

  return out;
}

/** Customer folders directly under the configured root. */
export async function listCustomerFolders(userEmail: string): Promise<DriveFolder[]> {
  const drive = await driveFor(userEmail);
  return listSubfolders(drive, DRIVE_CUSTOMER_ROOT_FOLDER_ID, "Listing customer folders");
}

export interface ProjectFolders {
  /** The Projects container, when one was found. */
  projectsFolder: DriveFolder | null;
  projects:       DriveFolder[];
  /** True when no Projects container existed and the customer's own subfolders are being offered. */
  fellBackToCustomerFolder: boolean;
}

/**
 * Project folders for a customer: find the "Projects" container inside the customer
 * folder, then list its subfolders.
 *
 * Falls back to the customer folder's own subfolders when there's no Projects
 * container, rather than returning nothing — naming varies and an empty list looks
 * like a bug.
 */
export async function listProjectFolders(userEmail: string, customerFolderId: string): Promise<ProjectFolders> {
  const drive = await driveFor(userEmail);
  const children = await listSubfolders(drive, customerFolderId, "Listing customer subfolders");

  const container = children.find(c => DRIVE_PROJECTS_FOLDER_NAMES.includes(c.name.trim().toLowerCase()));
  if (!container) {
    return { projectsFolder: null, projects: children, fellBackToCustomerFolder: true };
  }

  const projects = await listSubfolders(drive, container.id, "Listing project folders");
  return { projectsFolder: container, projects, fellBackToCustomerFolder: false };
}

/**
 * Create a Google Doc in `folderId` from an HTML body.
 *
 * Uploading text/html and letting Drive convert to application/vnd.google-apps.document
 * yields a properly formatted Doc (headings, lists, tables) without composing Docs
 * API batchUpdate requests by hand.
 */
export async function createGoogleDoc(
  userEmail: string,
  folderId: string,
  name: string,
  html: string,
): Promise<CreatedDoc> {
  const drive = await driveFor(userEmail);

  try {
    const res = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.document",
        parents:  [folderId],
      },
      media: { mimeType: "text/html", body: html },
      fields: "id, name, webViewLink",
      supportsAllDrives: true,
    });

    const { id, name: created, webViewLink } = res.data;
    if (!id) throw new DriveError("Drive created the document but returned no id.");

    return {
      id,
      name: created ?? name,
      // webViewLink is normally present; fall back to the canonical Docs URL.
      webViewLink: webViewLink ?? `https://docs.google.com/document/d/${id}/edit`,
    };
  } catch (e) {
    if (e instanceof DriveError) throw e;
    throw wrapDriveError(e, "Creating the document");
  }
}

/** Breadcrumb for a folder, for confirming where a doc will land. */
export async function folderPath(userEmail: string, folderId: string): Promise<string> {
  const drive = await driveFor(userEmail);
  const names: string[] = [];
  let current: string | undefined = folderId;
  let guard = 0;

  try {
    while (current && guard++ < 8) {
      // Explicitly typed: assigning back into `current` from the response makes TS
      // infer this circularly otherwise.
      const file: drive_v3.Schema$File = (await drive.files.get({
        fileId: current,
        fields: "id, name, parents",
        supportsAllDrives: true,
      })).data;

      if (file.name) names.unshift(file.name);
      if (current === DRIVE_CUSTOMER_ROOT_FOLDER_ID) break;
      current = file.parents?.[0];
    }
  } catch {
    // A breadcrumb is a nicety — never fail the operation over it.
    return names.join(" / ");
  }
  return names.join(" / ");
}
