import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Calls the Python MarkItDown sidecar.
 *
 * The script is the only thing that touches document contents, and it only
 * ever reads local files: it uses MarkItDown's convert_local(), never
 * convert()/convert_url(), so a URI can never be fetched.
 */

export type ConvertStats = {
  markdownChars: number;
  rawChars: number;
  markdownTokens: number;
  rawTokens: number;
};

export type ConvertResult = {
  ok: boolean;
  source: string;
  name: string;
  extension: string;
  bytes: number;
  pages: number;
  selectedPages: number[];
  markdown: string;
  rawText: string;
  truncated: boolean;
  stats: ConvertStats;
};

const CONVERT_TIMEOUT_MS = 180_000;

/** Walk up from the current directory until we find the repo's sidecar. */
export function findRepoRoot(start = process.cwd()): string | null {
  let current = path.resolve(start);

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, "sidecars", "markitdown", "convert.py");
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

export function sidecarScript(): string | null {
  const configured = process.env.PIP_CONVERT_SCRIPT;
  if (configured && fs.existsSync(configured)) return configured;

  const root = findRepoRoot();
  if (!root) return null;
  return path.join(root, "sidecars", "markitdown", "convert.py");
}

/**
 * The venv Python if it exists, otherwise whatever is on PATH. `PIP_PYTHON`
 * overrides both.
 */
export function pythonExecutable(): string {
  const configured = process.env.PIP_PYTHON;
  if (configured) return configured;

  const root = findRepoRoot();
  if (root) {
    const venv = path.join(root, "sidecars", "markitdown", ".venv", "bin", "python");
    if (fs.existsSync(venv)) return venv;

    const venvWindows = path.join(root, "sidecars", "markitdown", ".venv", "Scripts", "python.exe");
    if (fs.existsSync(venvWindows)) return venvWindows;
  }

  return process.platform === "win32" ? "python" : "python3";
}

export function convertToMarkdown(
  target: string,
  pages?: string,
): Promise<ConvertResult> {
  return new Promise((resolve, reject) => {
    const script = sidecarScript();
    if (!script) {
      reject(new Error("convert.py not found — set PIP_CONVERT_SCRIPT"));
      return;
    }

    const args = [script, target, "--json"];
    if (pages) args.push("--pages", pages);

    const child = spawn(pythonExecutable(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`conversion timed out after ${CONVERT_TIMEOUT_MS / 1000}s`));
    }, CONVERT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `convert.py exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as ConvertResult);
      } catch (error) {
        reject(new Error(`could not parse converter output: ${String(error)}`));
      }
    });
  });
}
