import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOST = "127.0.0.1";
export const PORT = Number(process.env.PIP_MCP_PORT ?? 8787);

export const MIN_TOKEN_LENGTH = 16;

/**
 * The bearer token.
 *
 * Resolution order:
 *   1. `PIP_MCP_TOKEN`, if it is set to something
 *   2. the token saved by a previous run (`<state>/token`)
 *   3. a freshly generated token, saved so later runs reuse it
 *
 * Two failure modes are deliberately avoided. An empty value must never be
 * treated as a token: it compares equal to a missing Authorization header and
 * would authorise every request. And a generated token must be both saved and
 * printed, because a secret nobody can read is not a usable credential — that
 * was the flaw in the original `?? randomBytes(...)` fallback.
 */
export let TOKEN = (process.env.PIP_MCP_TOKEN ?? "").trim();
export let TOKEN_SOURCE: "env" | "file" | "generated" = "env";

/** Called once before the server listens. Throws only if an explicit token is unusable. */
export function resolveToken(): void {
  if (TOKEN.length > 0) {
    if (TOKEN.length < MIN_TOKEN_LENGTH) {
      throw new Error(
        `PIP_MCP_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters. Use a long random value, or unset it to have one generated.`,
      );
    }
    TOKEN_SOURCE = "env";
    return;
  }

  try {
    const saved = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved.length >= MIN_TOKEN_LENGTH) {
      TOKEN = saved;
      TOKEN_SOURCE = "file";
      return;
    }
  } catch {
    // No saved token yet — create one below.
  }

  TOKEN = randomBytes(32).toString("hex");
  TOKEN_SOURCE = "generated";

  try {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(TOKEN_FILE, `${TOKEN}\n`, { mode: 0o600 });
  } catch (error) {
    console.error(
      "[pip-mcp] could not save the generated token; it will change on the next run:",
      error instanceof Error ? error.message : error,
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
export const TOKEN_FILE = path.join(STATE_DIR, "token");
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
 * The folders the user has granted, one at a time, from the Pip window. The app
 * is the only writer; the server reads it on every tool call, so a change takes
 * effect without a restart.
 */
export const ALLOWLIST_FILE = path.join(STATE_DIR, "allowlist.json");

export type AllowlistFile = { folders: string[] };

function readAllowlistFile(): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(ALLOWLIST_FILE, "utf8");
  } catch {
    // No file yet: the user has not granted anything. That is not an error.
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AllowlistFile>;
    if (!Array.isArray(parsed.folders)) throw new Error("`folders` is not an array");
    return parsed.folders.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
  } catch (error) {
    // Fail closed: an unreadable allowlist shares nothing beyond the notes
    // folder, rather than guessing at what the user meant.
    console.error(
      "[pip-mcp] allowlist.json is unreadable; sharing the notes folder only:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

function expandHome(entry: string): string {
  const trimmed = entry.trim();
  const expanded = trimmed.startsWith("~")
    ? path.join(process.env.HOME ?? os.homedir(), trimmed.slice(1))
    : trimmed;
  return path.resolve(expanded);
}

/**
 * The allowlist. Every path a tool touches has to land inside one of these.
 *
 * Order: `PIP_ALLOWED_FOLDERS` (colon separated, for tests and CI) wins;
 * otherwise the folders granted in `allowlist.json` plus the notes folder,
 * which is always shared because `create_note` writes there.
 *
 * Nothing else is implicit. The AI can read exactly what the user added.
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

  const folders = new Set<string>([path.resolve(NOTES_DIR)]);

  for (const entry of readAllowlistFile()) {
    const absolute = expandHome(entry);
    try {
      // A folder can be deleted or unmounted after it was granted; skip it
      // rather than failing every call.
      if (!fs.statSync(absolute).isDirectory()) continue;
    } catch {
      continue;
    }
    folders.add(absolute);
  }

  return [...folders];
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
