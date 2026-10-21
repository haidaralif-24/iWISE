import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOST = "127.0.0.1";
export const PORT = Number(process.env.PIP_MCP_PORT ?? 8787);

/**
 * The bearer token.
 *
 * It must be set explicitly. `?? randomBytes(...)` looked helpful but was a
 * dead end: the generated value is written to the control file before anyone
 * can copy it into a connector, so the only way to use it was to read it out of
 * a file. Worse, `PIP_MCP_TOKEN=""` is not nullish, so the token became the
 * empty string — and an empty token compares equal to a missing Authorization
 * header, which authorised every request.
 */
const CONFIGURED_TOKEN = (process.env.PIP_MCP_TOKEN ?? "").trim();
export const TOKEN = CONFIGURED_TOKEN;

export const MIN_TOKEN_LENGTH = 16;

/** Called before the server starts listening; throws rather than serving files unauthenticated. */
export function assertUsableToken(): void {
  if (TOKEN.length === 0) {
    throw new Error(
      "PIP_MCP_TOKEN is unset or empty. This server reads files, so it will not run unauthenticated. " +
        "Set it to a long random value, for example: openssl rand -hex 32",
    );
  }
  if (TOKEN.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `PIP_MCP_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters. Use a long random value.`,
    );
  }
}

/**
 * Query-string tokens end up in tunnel and proxy logs, so they are opt-in.
 * Some connector UIs cannot send an Authorization header, which is why the
 * fallback exists at all.
 */
export const ALLOW_QUERY_TOKEN = process.env.PIP_ALLOW_QUERY_TOKEN === "1";

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
