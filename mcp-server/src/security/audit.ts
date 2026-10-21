import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type AuditEntry = {
  tool: string;
  requestedPath?: string;
  canonicalPath?: string;
  decision: "allow" | "deny" | "error";
  durationMs: number;
};

export async function audit(entry: AuditEntry): Promise<void> {
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
}
