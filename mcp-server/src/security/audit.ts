import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type AuditEntry = {
  tool: string;
  requestedPath?: string;
  canonicalPath?: string;
  decision: "allow" | "deny" | "error";
  durationMs: number;
};

// Audit must never be able to fail a tool call: a full disk or a bad path would
// otherwise turn a successful conversion into an error response. Failures are
// reported on stderr instead.
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const configured = process.env.PIP_AUDIT_LOG;
    if (!configured) {
      console.error("[pip-mcp] PIP_AUDIT_LOG is unset; audit entry:", JSON.stringify(entry));
      return;
    }
    const file = path.resolve(configured);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await appendFile(file, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n", {
      encoding: "utf8", mode: 0o600, flag: "a",
    });
  } catch (error) {
    console.error(
      "[pip-mcp] audit write failed:",
      error instanceof Error ? error.message : "unknown error",
      JSON.stringify(entry),
    );
  }
}
