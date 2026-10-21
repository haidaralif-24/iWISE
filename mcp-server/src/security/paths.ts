import path from "node:path";
import { realpath, stat, readdir } from "node:fs/promises";

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".html", ".htm",
  ".txt", ".md", ".csv", ".json", ".xml", ".jpg", ".jpeg", ".png",
]);
const MAX_FILE_BYTES = Number(process.env.PIP_MAX_FILE_BYTES ?? 20 * 1024 * 1024);
const MAX_LIST_RESULTS = 200;

export type AllowedRoot = { canonical: string };

export async function getAllowedRoots(): Promise<AllowedRoot[]> {
  const configured = (process.env.PIP_ALLOWED_DIRS ?? "")
    .split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
  if (configured.length === 0) {
    throw new Error("Document tools are disabled: configure PIP_ALLOWED_DIRS first.");
  }
  const roots: AllowedRoot[] = [];
  for (const entry of configured) {
    const canonical = await realpath(path.resolve(entry));
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error("Every PIP_ALLOWED_DIRS entry must be a directory.");
    }
    roots.push({ canonical });
  }
  return roots;
}

export function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) &&
    relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export async function resolveAllowedFile(rootIndex: number, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("Provide a relative file path inside an allowed directory.");
  }
  const roots = await getAllowedRoots();
  const root = roots[rootIndex];
  if (!root) throw new Error("Unknown allowed directory index.");
  const candidate = path.resolve(root.canonical, relativePath);
  if (!isInsideRoot(root.canonical, candidate)) throw new Error("Path is outside the allowed directory.");
  const canonical = await realpath(candidate);
  if (!isInsideRoot(root.canonical, canonical)) throw new Error("Symlink escapes the allowed directory.");
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error("Only regular files can be read.");
  if (!ALLOWED_EXTENSIONS.has(path.extname(canonical).toLowerCase())) {
    throw new Error("This file extension is not supported.");
  }
  if (info.size > MAX_FILE_BYTES) throw new Error(`File exceeds the ${MAX_FILE_BYTES} byte limit.`);
  return { path: canonical, size: info.size, root: root.canonical };
}

export async function listAllowedFiles(rootIndex: number, subdirectory = "") {
  if (path.isAbsolute(subdirectory) || subdirectory.includes("\0")) {
    throw new Error("Directory must be relative to an allowed directory.");
  }
  const roots = await getAllowedRoots();
  const root = roots[rootIndex];
  if (!root) throw new Error("Unknown allowed directory index.");
  const start = path.resolve(root.canonical, subdirectory || ".");
  const canonicalStart = await realpath(start);
  if (!isInsideRoot(root.canonical, canonicalStart)) throw new Error("Directory is outside the allowed root.");
  if (!(await stat(canonicalStart)).isDirectory()) throw new Error("Requested path is not a directory.");
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5 || files.length >= MAX_LIST_RESULTS) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= MAX_LIST_RESULTS) break;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.relative(root.canonical, full));
      }
    }
  }
  await walk(canonicalStart, 0);
  return { files, truncated: files.length >= MAX_LIST_RESULTS };
}
