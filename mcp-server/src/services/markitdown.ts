import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = Number(process.env.PIP_MAX_OUTPUT_BYTES ?? 2 * 1024 * 1024);
// A cold first conversion of an image-heavy PDF measured 22s, so 30s left too
// little headroom on a slower machine.
const TIMEOUT_MS = Number(process.env.PIP_CONVERSION_TIMEOUT_MS ?? 60_000);

// Resolve against this module, not process.cwd(): the server must work whether
// it is started from mcp-server/ or from the repository root.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const DEFAULT_SCRIPT = path.join(REPO_ROOT, "sidecars/markitdown/convert.py");
const DEFAULT_VENV_PYTHON = path.join(REPO_ROOT, "sidecars/markitdown/.venv/bin/python");

export async function convertToMarkdown(filePath: string): Promise<{ markdown: string; truncated: boolean }> {
  const script = path.resolve(process.env.PIP_MARKITDOWN_SCRIPT ?? DEFAULT_SCRIPT);

  // The converter's dependency lives in the sidecar venv. Falling back to the
  // system python3 fails with ModuleNotFoundError on a stock machine.
  const python =
    process.env.PIP_PYTHON ?? (existsSync(DEFAULT_VENV_PYTHON) ? DEFAULT_VENV_PYTHON : "python3");

  if (!existsSync(script)) {
    throw new Error(
      `MarkItDown script not found at ${script}. Set PIP_MARKITDOWN_SCRIPT to its path.`,
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, filePath], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let settled = false;
    const finish = (error?: Error, value?: { markdown: string; truncated: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Document conversion timed out."));
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, MAX_OUTPUT_BYTES - outputBytes);
      const keep = chunk.subarray(0, remaining);
      if (keep.length) stdout.push(keep);
      outputBytes += keep.length;
      if (keep.length < chunk.length || outputBytes >= MAX_OUTPUT_BYTES) {
        truncated = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, 4096 - stderrBytes);
      const keep = chunk.subarray(0, remaining);
      if (keep.length) stderr.push(keep);
      stderrBytes += keep.length;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0 && !truncated) {
        finish(new Error(`Document conversion failed (exit ${code}). ${Buffer.concat(stderr).toString("utf8").slice(0, 1000)}`));
        return;
      }
      const markdown = Buffer.concat(stdout).toString("utf8") +
        (truncated ? "\n\n[Output truncated at configured safety limit.]" : "");
      finish(undefined, { markdown, truncated });
    });
  });
}
