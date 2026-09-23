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
import { getImpersonatedAuth, ServiceAccountError, serviceAccountConfigured } from "./google-service-account";
import {
  DRIVE_CUSTOMER_ROOT_FOLDER_ID, DRIVE_PROJECTS_FOLDER_NAMES,
  DRIVE_TRANSCRIPT_FOLDER_DEFAULT, DRIVE_TRANSCRIPT_FOLDER_NAMES,
} from "./constants";

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

/**
 * Drive client for acting on `userEmail`'s behalf.
 *
 * Prefers the service account with domain-wide delegation, because `.../auth/drive`
 * is a restricted scope and requesting it via user consent forces Google's
 * verification review. Impersonation keeps ownership and permissions correct.
 *
 * Falls back to the user's own OAuth token when no service account is configured,
 * so the feature still works on a deployment that hasn't been set up yet.
 */
async function driveFor(userEmail: string): Promise<drive_v3.Drive> {
  if (serviceAccountConfigured()) {
    try {
      const auth = await getImpersonatedAuth(userEmail);
      if (auth) return google.drive({ version: "v3", auth });
    } catch (e) {
      // Delegation messages are already actionable — pass them straight through.
      throw new DriveError(
        e instanceof Error ? e.message : "Service account authorisation failed.",
        e instanceof ServiceAccountError ? (e.code ?? "sa_error") : "sa_error",
      );
    }
  }

  const authClient = await getGoogleClient(userEmail);
  if (!authClient) {
    throw new DriveError(
      "Google Drive isn't set up. Configure the service account (GOOGLE_SA_KEY_JSON + domain-wide delegation), or sign out and back in to use your own Google account.",
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

/**
 * Folder id out of whatever is stored in NetSuite's custentity_project_folder.
 * Accepts a full Drive URL or a bare id, since the field is free text and both
 * turn up in practice.
 *
 *   https://drive.google.com/drive/u/2/folders/<id>       → <id>
 *   https://drive.google.com/drive/folders/<id>?usp=...   → <id>
 *   https://drive.google.com/open?id=<id>                 → <id>
 */
export function extractDriveFolderId(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;

  const byPath = v.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (byPath) return byPath[1];

  const byQuery = v.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (byQuery) return byQuery[1];

  // A bare id — no scheme, no slashes.
  if (/^[A-Za-z0-9_-]{10,}$/.test(v)) return v;

  return null;
}

/**
 * The transcripts subfolder inside a project folder, created if it doesn't exist.
 *
 * Creating rather than erroring: a project folder that simply hasn't been set up
 * yet shouldn't block filing, and an empty Transcripts folder is harmless. The
 * caller is told whether it was created so the UI can mention it.
 */
export async function ensureTranscriptFolder(
  userEmail: string,
  projectFolderId: string,
): Promise<{ folder: DriveFolder; created: boolean }> {
  const drive    = await driveFor(userEmail);
  const children = await listSubfolders(drive, projectFolderId, "Looking for the transcripts folder");

  const existing = children.find(c => DRIVE_TRANSCRIPT_FOLDER_NAMES.includes(c.name.trim().toLowerCase()));
  if (existing) return { folder: existing, created: false };

  try {
    const res = await drive.files.create({
      requestBody: {
        name:     DRIVE_TRANSCRIPT_FOLDER_DEFAULT,
        mimeType: FOLDER_MIME,
        parents:  [projectFolderId],
      },
      fields: "id, name",
      supportsAllDrives: true,
    });
    if (!res.data.id) throw new DriveError("Drive created the transcripts folder but returned no id.");
    return { folder: { id: res.data.id, name: res.data.name ?? DRIVE_TRANSCRIPT_FOLDER_DEFAULT }, created: true };
  } catch (e) {
    if (e instanceof DriveError) throw e;
    throw wrapDriveError(e, "Creating the transcripts folder");
  }
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

// ─── Reading, for the research agent ────────────────────────────────────────
//
// Everything above this line lists folders or CREATES documents. The research
// agent has to READ them, which is a different capability and deliberately
// separate: these functions never write, and the agent is given no tool that
// does.

export interface DriveFile {
  id:           string;
  name:         string;
  mimeType:     string;
  modifiedTime: string | null;
  size:         number | null;
  webViewLink:  string | null;
}

/** Google's own formats, which export rather than download. */
const GOOGLE_DOC   = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDE = "application/vnd.google-apps.presentation";

/** Files worth reading. Images and video are listed but never opened. */
export const READABLE_MIME = new Set([
  GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDE,
  "application/pdf", "text/plain", "text/markdown", "text/csv",
]);

/**
 * Every file under `folderId`, walking subfolders breadth-first.
 *
 * `maxDepth` and `maxFiles` are hard stops, not suggestions. A customer folder
 * can contain years of material and an unbounded walk is both slow and a way to
 * blow the model's context — the agent is supposed to choose what to read, so
 * it needs a listing it can survey, not everything that exists.
 */
export async function listFilesRecursive(
  userEmail: string,
  folderId: string,
  { maxDepth = 3, maxFiles = 200 }: { maxDepth?: number; maxFiles?: number } = {},
): Promise<{ files: DriveFile[]; truncated: boolean }> {
  const drive = await driveFor(userEmail);
  const files: DriveFile[] = [];
  let queue: { id: string; depth: number }[] = [{ id: folderId, depth: 0 }];
  let truncated = false;

  while (queue.length && files.length < maxFiles) {
    const next: typeof queue = [];
    for (const { id, depth } of queue) {
      if (files.length >= maxFiles) { truncated = true; break; }
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${q(id)}' in parents and trashed = false`,
          fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)",
          pageSize: 100,
          pageToken,
          // A customer folder routinely lives in a shared drive; without these
          // the listing silently comes back empty.
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }).catch((e: unknown) => {
          throw new DriveError(
            `Listing folder contents failed: ${e instanceof Error ? e.message : String(e)}`);
        });

        for (const f of res.data.files ?? []) {
          if (f.mimeType === FOLDER_MIME) {
            if (depth + 1 < maxDepth) next.push({ id: f.id!, depth: depth + 1 });
            continue;
          }
          if (files.length >= maxFiles) { truncated = true; break; }
          files.push({
            id: f.id!, name: f.name ?? "(untitled)", mimeType: f.mimeType ?? "",
            modifiedTime: f.modifiedTime ?? null,
            size: f.size ? Number(f.size) : null,
            webViewLink: f.webViewLink ?? null,
          });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken && files.length < maxFiles);
    }
    queue = next;
  }

  // Newest first: on a live engagement the recent material is what describes
  // the current state, and the agent reads from the top of the list.
  files.sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
  return { files, truncated };
}

/**
 * Plain text of one Drive file, capped at `maxChars`.
 *
 * Google-native formats are EXPORTED (a Doc has no bytes to download); anything
 * else is downloaded. A format we cannot turn into text returns null rather
 * than throwing — one unreadable file must not end a research run, and the
 * agent is told it was skipped so it can choose something else.
 */
export async function readFileText(
  userEmail: string,
  fileId: string,
  { maxChars = 20_000 }: { maxChars?: number } = {},
): Promise<{ text: string | null; mimeType: string; name: string; truncated: boolean; reason?: string }> {
  const drive = await driveFor(userEmail);

  const meta = await drive.files.get({
    fileId, fields: "id, name, mimeType, size", supportsAllDrives: true,
  }).catch((e: unknown) => {
    throw new DriveError(`Could not open file: ${e instanceof Error ? e.message : String(e)}`);
  });

  const mimeType = meta.data.mimeType ?? "";
  const name     = meta.data.name ?? "(untitled)";
  const out = (text: string | null, reason?: string) => {
    if (text === null) return { text: null, mimeType, name, truncated: false, reason };
    const clipped = text.length > maxChars;
    return { text: clipped ? text.slice(0, maxChars) : text, mimeType, name, truncated: clipped };
  };

  try {
    if (mimeType === GOOGLE_DOC || mimeType === GOOGLE_SLIDE) {
      const r = await drive.files.export({ fileId, mimeType: "text/plain" }, { responseType: "text" });
      return out(String(r.data ?? ""));
    }
    if (mimeType === GOOGLE_SHEET) {
      // CSV keeps the grid legible as text; xlsx would be bytes we cannot read.
      const r = await drive.files.export({ fileId, mimeType: "text/csv" }, { responseType: "text" });
      return out(String(r.data ?? ""));
    }
    if (mimeType.startsWith("text/")) {
      const r = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true },
        { responseType: "text" });
      return out(String(r.data ?? ""));
    }
    if (mimeType === "application/pdf") {
      // Deliberately NOT parsed. Adding a PDF text extractor pulls in a heavy
      // dependency that runs badly on serverless, and a half-extracted PDF
      // produces confident nonsense. The agent gets the name and is told to
      // treat it as a pointer for a person to open.
      return out(null, "PDF text extraction is not enabled — open it in Drive.");
    }
    return out(null, `No text extractor for ${mimeType}.`);
  } catch (e) {
    return out(null, `Could not read: ${e instanceof Error ? e.message : String(e)}`);
  }
}
