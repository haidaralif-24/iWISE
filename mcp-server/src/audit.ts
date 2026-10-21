import fs from "node:fs";

import { AUDIT_FILE, ensureStateDirs } from "./config.js";

/**
 * Append-only audit log.
 *
 * Every tool call is recorded: what was asked for, whether it was allowed,
 * whether the user approved it. The file is only ever opened in append mode,
 * so a tampered log would need a separate write to hide a line.
 */

export type AuditEntry = {
  timestamp: string;
  tool: string;
  arguments: unknown;
  allowed: boolean;
  approved: boolean | null;
  reason: string | null;
  actor: string;
};

export function audit(entry: Omit<AuditEntry, "timestamp">): AuditEntry {
  const full: AuditEntry = { timestamp: new Date().toISOString(), ...entry };

  try {
    ensureStateDirs();
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(full)}\n`, { mode: 0o600 });
  } catch (error) {
    // A failed audit write must never take the server down, but it should be
    // visible in the console.
    console.error("[pip-mcp] audit write failed:", error);
  }

  return full;
}

export function readAudit(limit = 100): AuditEntry[] {
  try {
    const raw = fs.readFileSync(AUDIT_FILE, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const entries: AuditEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // A truncated last line (server killed mid-write) is skipped, not fatal.
      }
    }
    return entries.reverse();
  } catch {
    return [];
  }
}
