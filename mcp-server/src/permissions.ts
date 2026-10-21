import fs from "node:fs";
import path from "node:path";

import { allowedFolders } from "./config.js";

/**
 * Path permission checks.
 *
 * The rule from the security model: resolve the real path first, then check it
 * sits inside an allowed folder. Resolving first is what makes symlinks safe —
 * a link that points out of the allowlist resolves to its target and is
 * rejected, rather than being allowed because its own location looked fine.
 */

const BLOCKED_PREFIXES = ["http://", "https://", "data:", "file://", "ftp://", "ftps://"];

export type PathCheck =
  | { ok: true; path: string; root: string }
  | { ok: false; reason: string };

function realpathOrNull(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

/** True when `child` is inside `parent`, after both have been resolved. */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/**
 * Resolve a caller-supplied path and confirm it is inside the allowlist.
 * Rejects URI schemes outright so the model cannot steer the server at a URL.
 */
export function checkPath(candidate: string): PathCheck {
  const raw = String(candidate ?? "").trim();

  if (!raw) return { ok: false, reason: "empty path" };

  const lowered = raw.toLowerCase();
  const blocked = BLOCKED_PREFIXES.find((prefix) => lowered.startsWith(prefix));
  if (blocked) {
    return { ok: false, reason: `only local file paths are allowed (rejected "${blocked}")` };
  }

  const expanded = raw.startsWith("~") ? path.join(process.env.HOME ?? "", raw.slice(1)) : raw;
  const absolute = path.resolve(expanded);

  if (!fs.existsSync(absolute)) {
    return { ok: false, reason: `no such file or folder: ${absolute}` };
  }

  const resolved = realpathOrNull(absolute);
  if (!resolved) {
    return { ok: false, reason: `could not resolve path: ${absolute}` };
  }

  for (const root of allowedFolders()) {
    const resolvedRoot = realpathOrNull(root);
    if (!resolvedRoot) continue;
    if (isInside(resolvedRoot, resolved)) {
      return { ok: true, path: resolved, root: resolvedRoot };
    }
  }

  return {
    ok: false,
    reason:
      `path is outside the allowed folders: ${resolved}\n` +
      `allowed: ${allowedFolders().join(", ")}\n` +
      `set PIP_ALLOWED_FOLDERS to change this`,
  };
}

/**
 * Resolve a folder, optionally relative to one of the allowed roots. Used by
 * `list_files`, where the model usually passes a folder name rather than a
 * full path.
 */
export function checkFolder(candidate: string): PathCheck {
  const raw = String(candidate ?? "").trim();
  if (!raw) return { ok: false, reason: "empty folder" };

  const roots = allowedFolders();
  const expanded = raw.startsWith("~") ? path.join(process.env.HOME ?? "", raw.slice(1)) : raw;

  // A relative path is interpreted as "inside one of the allowed folders",
  // which is what makes list_files("Documents") work without leaking the
  // absolute layout of the machine.
  const candidates = path.isAbsolute(expanded)
    ? [expanded]
    : roots.map((root) => path.join(root, expanded));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const resolved = realpathOrNull(candidate);
    if (!resolved) continue;
    if (!fs.statSync(resolved).isDirectory()) {
      return { ok: false, reason: `not a folder: ${resolved}` };
    }
    for (const root of roots) {
      const resolvedRoot = realpathOrNull(root);
      if (resolvedRoot && isInside(resolvedRoot, resolved)) {
        return { ok: true, path: resolved, root: resolvedRoot };
      }
    }
  }

  return {
    ok: false,
    reason: `folder is outside the allowed folders: ${raw}\nallowed: ${roots.join(", ")}`,
  };
}
