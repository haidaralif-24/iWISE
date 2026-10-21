// Pip MCP server — the local tool layer.
//
// Transport: Streamable HTTP at POST /mcp (v2 SDK; SSE is gone from this line).
// Bound to 127.0.0.1 — the tunnel is what exposes it, nothing else.
//
// Run:  npm run dev
// Auth: set PIP_MCP_TOKEN, or one is generated and printed on boot.
//
// Routes:
//   GET  /health   liveness, no token needed (used to check a tunnel)
//   POST /mcp      the MCP endpoint
//   GET  /pending  tool calls waiting for the user's approval
//   POST /approve  the app answers one of those requests

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod";

import { listPending, respond } from "./approvals.js";
import {
  ALLOW_QUERY_TOKEN,
  HOST,
  PORT,
  TOKEN,
  assertUsableToken,
  writeControlFile,
} from "./config.js";
import { registerTools, describeAllowlist } from "./tools.js";

// Refuse to start without a real token. Serving files to an unauthenticated
// caller is worse than not starting.
try {
  assertUsableToken();
} catch (error) {
  console.error(`[pip-mcp] ${error instanceof Error ? error.message : "invalid PIP_MCP_TOKEN"}`);
  process.exit(1);
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "pip-tools", version: "0.2.0" });

  registerTools(server);

  // Kept from the spike build: a trivial tool that proves the chain works
  // without touching the filesystem.
  server.registerTool(
    "reveal_secret",
    {
      title: "Reveal secret",
      description:
        "Returns a secret phrase. Call this to confirm the connection to the local server works.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: process.env.PIP_SECRET_MESSAGE ?? "The eagle lands at midnight.",
        },
      ],
    }),
  );

  return server;
}

// Stateless: the handler builds a fresh server per request from this factory.
const handler = createMcpHandler(() => buildServer());

// A JSON-RPC request has no business being large; without a cap a single POST
// could exhaust memory.
const MAX_REQUEST_BYTES = Number(process.env.PIP_MAX_REQUEST_BYTES ?? 1024 * 1024);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        settled = true;
        reject(new Error(`request body exceeds ${MAX_REQUEST_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

// node:http request -> web Request, which is what the v2 handler speaks.
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || value === null) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const raw = hasBody ? await readBody(req) : undefined;
  // Copy into a plain Uint8Array: Buffer can be backed by a SharedArrayBuffer,
  // which the Request body type does not accept.
  const body = raw ? new Uint8Array(raw) : undefined;

  return new Request(url, { method: req.method ?? "GET", headers, body });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

// Two ways to present the token, because connector UIs differ:
//   1. Authorization: Bearer <token>   — preferred, never appears in logs
//   2. ?token=<token> on the /mcp URL  — opt-in, for clients that cannot send headers
// The model is never told the token; the MCP client attaches it.
function isAuthorised(req: IncomingMessage, url: URL): boolean {
  // The startup check makes this unreachable, but comparing two empty buffers
  // would authorise everything, so keep the guard.
  if (TOKEN.length === 0) return false;

  const header = req.headers.authorization;
  const fromHeader = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const fromQuery = ALLOW_QUERY_TOKEN ? (url.searchParams.get("token") ?? "").trim() : "";
  const presented = fromHeader || fromQuery;

  const given = Buffer.from(presented);
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    // The approval routes live here rather than in a second process so there is
    // only one thing to run, and one token to manage.
    if (url.pathname === "/pending" || url.pathname === "/approve") {
      if (!isAuthorised(req, url)) {
        json(res, 401, { error: "unauthorised" });
        return;
      }

      if (url.pathname === "/pending") {
        json(res, 200, { pending: listPending() });
        return;
      }

      let body: { id?: string; approved?: boolean } = {};
      try {
        body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      } catch {
        json(res, 400, { error: "invalid json" });
        return;
      }

      if (!body.id) {
        json(res, 400, { error: "missing id" });
        return;
      }

      const ok = respond(body.id, body.approved === true);
      json(res, ok ? 200 : 404, { ok });
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }

    // The token is the real control here: a tunnel makes this reachable from
    // the internet, and the client is a backend, not a browser, so there is no
    // Origin header to check.
    if (!isAuthorised(req, url)) {
      res
        .writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" })
        .end(JSON.stringify({ error: "unauthorised" }));
      return;
    }

    await sendWebResponse(res, await handler.fetch(await toWebRequest(req)));
  } catch (error) {
    console.error("[pip-mcp]", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain" }).end("internal error");
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  writeControlFile();

  console.log(`[pip-mcp] listening on http://${HOST}:${PORT}/mcp`);
  console.log(`[pip-mcp] health    http://${HOST}:${PORT}/health`);
  console.log(`[pip-mcp] token     ${TOKEN}`);
  console.log("[pip-mcp] allowed folders:");
  console.log(`  ${describeAllowlist()}`);
  console.log("[pip-mcp] connector URL, pick whichever your client supports:");
  console.log(`          header form:  https://<tunnel-host>/mcp`);
  console.log(`                        Authorization: Bearer ${TOKEN}`);
  if (ALLOW_QUERY_TOKEN) {
    console.log(`          URL form:     https://<tunnel-host>/mcp?token=${TOKEN}`);
    console.warn(
      "[pip-mcp] PIP_ALLOW_QUERY_TOKEN=1: ?token= is accepted. Query strings can appear in tunnel and proxy logs.",
    );
  } else {
    console.log("          (query-string tokens are disabled; set PIP_ALLOW_QUERY_TOKEN=1 to enable)");
  }
});
