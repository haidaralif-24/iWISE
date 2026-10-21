import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOST = "127.0.0.1";
export const PORT = Number(process.env.PIP_MCP_PORT ?? 8787);

export const TOKEN = process.env.PIP_MCP_TOKEN ?? randomBytes(24).toString("hex");

/**
 * Where the server keeps its own state: the control file (so the app can find
 * the token), the audit log, and the notes folder the tools may write to.
 */
export const STATE_DIR = process.env.PIP_STATE_DIR ?? path.join(os.homedir(), ".pip");
export const CONTROL_FILE = path.join(STATE_DIR, "control.json");
export const AUDIT_FILE = path.join(STATE_DIR, "audit.log");
export const NOTES_DIR = process.env.PIP_NOTES_DIR ?? path.join(STATE_DIR, "notes");

/**
 * The app and the server talk through two folders: the server drops a request
 * in `pending` and waits for the matching answer in `decisions`. Using files
 * rather than a second HTTP port keeps the bearer token inside the server and
 * means the app needs no network client of its own.
 */
export const PENDING_DIR = path.join(STATE_DIR, "pending");
export const DECISIONS_DIR = path.join(STATE_DIR, "decisions");

/**
 * The allowlist. Every path a tool touches has to land inside one of these.
 *
 * Default is the notes folder plus the two places people actually keep study
 * material. `PIP_ALLOWED_FOLDERS` (colon separated) overrides it entirely.
 */
export function allowedFolders(): string[] {
  const configured = process.env.PIP_ALLOWED_FOLDERS;
  if (configured) {
    return configured
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => path.resolve(entry));
  }

  return [NOTES_DIR, path.join(os.homedir(), "Documents"), path.join(os.homedir(), "Desktop")];
}

/** How many characters of document text a single tool call may return. */
export const MAX_CONTENT_CHARS = Number(process.env.PIP_MAX_CONTENT_CHARS ?? 24_000);

/** How long a destructive tool waits for the user to approve it. */
export const APPROVAL_TIMEOUT_MS = Number(process.env.PIP_APPROVAL_TIMEOUT_MS ?? 120_000);

export function ensureStateDirs(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(NOTES_DIR, { recursive: true, mode: 0o700 });
}

/**
 * The control file tells the app where this server is and how to authenticate.
 * It holds the bearer token, so it is written with owner-only permissions and
 * never committed.
 */
export function writeControlFile(): void {
  ensureStateDirs();
  fs.writeFileSync(
    CONTROL_FILE,
    JSON.stringify(
      {
        token: TOKEN,
        port: PORT,
        pid: process.pid,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
