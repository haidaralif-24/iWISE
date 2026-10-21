// Pip MCP server — bare verification build.
//
// One tool: reveal_secret. Its only job is to prove that a cloud chat client
// can reach this machine through a tunnel and get a real answer back.
//
// Transport: Streamable HTTP at POST /mcp (v2 SDK; SSE is gone from this line).
// Bound to 127.0.0.1 — the tunnel is what exposes it, nothing else.
//
// Run:  npm run dev
// Auth: set PIP_MCP_TOKEN, or one is generated and printed on boot.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PIP_MCP_PORT ?? 8787);

const TOKEN = process.env.PIP_MCP_TOKEN ?? randomBytes(24).toString("hex");
const SECRET_MESSAGE = process.env.PIP_SECRET_MESSAGE ?? "The eagle lands at midnight.";

function buildServer(): McpServer {
  const server = new McpServer({ name: "pip-verification", version: "0.1.0" });

  server.registerTool(
    "reveal_secret",
    {
      title: "Reveal secret",
      description:
        "Returns a secret phrase. Call this to confirm the connection to the local server works.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text", text: SECRET_MESSAGE }],
    }),
  );

  return server;
}

// Stateless: the handler builds a fresh server per request from this factory.
const handler = createMcpHandler(() => buildServer());

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// node:http request -> web Request, which is what the v2 handler speaks.
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;

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

function isAuthorised(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

const httpServer = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }

    if (path !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }

    // The token is the real control here: a tunnel makes this reachable from
    // the internet, and the client is a backend, not a browser, so there is no
    // Origin header to check.
    if (!isAuthorised(req)) {
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
  console.log(`[pip-mcp] listening on http://${HOST}:${PORT}/mcp`);
  console.log(`[pip-mcp] health    http://${HOST}:${PORT}/health`);
  console.log(`[pip-mcp] token     ${TOKEN}`);
  console.log(`[pip-mcp] connector URL is the tunnel host + /mcp, with header:`);
  console.log(`          Authorization: Bearer ${TOKEN}`);
});
