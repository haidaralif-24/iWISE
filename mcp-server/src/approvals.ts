import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { APPROVAL_TIMEOUT_MS, DECISIONS_DIR, PENDING_DIR, ensureStateDirs } from "./config.js";

/**
 * Confirmation for destructive tools.
 *
 * The model can ask for something that writes to disk, but it cannot approve
 * it. The request is written to the `pending` folder and waits there until the
 * app — our own UI, never a web page — drops an answer in `decisions`. If
 * nothing answers in time the request is denied: failing closed is the only
 * safe default.
 */

export type ApprovalRequest = {
  id: string;
  tool: string;
  arguments: unknown;
  reason: string;
  createdAt: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pendingFile(id: string): string {
  return path.join(PENDING_DIR, `${id}.json`);
}

function decisionFile(id: string): string {
  return path.join(DECISIONS_DIR, `${id}.json`);
}

export async function requestApproval(input: {
  tool: string;
  arguments: unknown;
  reason: string;
}): Promise<boolean> {
  ensureStateDirs();
  fs.mkdirSync(PENDING_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(DECISIONS_DIR, { recursive: true, mode: 0o700 });

  const id = randomBytes(8).toString("hex");
  const request: ApprovalRequest = {
    id,
    tool: input.tool,
    arguments: input.arguments,
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(pendingFile(id), JSON.stringify(request, null, 2), { mode: 0o600 });

  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (fs.existsSync(decisionFile(id))) {
      let approved = false;
      try {
        const raw = fs.readFileSync(decisionFile(id), "utf8");
        approved = (JSON.parse(raw) as { approved?: boolean }).approved === true;
      } catch {
        // A decision file we cannot read is treated as "not approved".
        approved = false;
      }

      fs.rmSync(decisionFile(id), { force: true });
      fs.rmSync(pendingFile(id), { force: true });
      return approved;
    }

    await sleep(100);
  }

  // Nobody answered. Deny, and clear the request so the UI stops showing it.
  fs.rmSync(pendingFile(id), { force: true });
  return false;
}

export function listPending(): ApprovalRequest[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(PENDING_DIR);
  } catch {
    return [];
  }

  const requests: ApprovalRequest[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(PENDING_DIR, entry), "utf8");
      const request = JSON.parse(raw) as ApprovalRequest;
      if (request.id) requests.push(request);
    } catch {
      // A half-written file is skipped rather than breaking the whole list.
    }
  }

  return requests.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Records an answer. The waiting tool call picks it up on its next tick. */
export function respond(id: string, approved: boolean): boolean {
  if (!id || !/^[a-f0-9]+$/i.test(id)) return false;

  try {
    fs.mkdirSync(DECISIONS_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      decisionFile(id),
      JSON.stringify({ approved, answeredAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    return true;
  } catch {
    return false;
  }
}
