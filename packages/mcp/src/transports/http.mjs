import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAuth } from "../auth.mjs";
import { buildCircuitMcpServer } from "../server.mjs";

export async function handleHttpRequest(req, res, options = {}) {
  const auth = options.auth ?? createAuth();
  const serverFactory = options.serverFactory ?? (() => buildCircuitMcpServer(options));

  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("access-control-expose-headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const healthPaths = options.healthPaths ?? ["/health", "/mcp/health"];
  if (healthPaths.includes(url.pathname)) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, product: "circuit-mcp", transport: "streamable-http", tools: 8 }));
  }
  if (url.pathname !== (options.path ?? "/mcp")) {
    res.writeHead(404);
    return res.end("Not found");
  }

  const authenticated = auth.authenticate(req.headers);
  if (!authenticated.ok) {
    res.writeHead(authenticated.code ?? 401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: authenticated.detail }));
  }

  let parsedBody;
  if (req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid JSON body." }));
    }
  }

  req.auth = { caller: authenticated.caller, requestId: randomUUID() };
  const server = serverFactory();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    transport.close();
  }
}

export async function startHttp(options = {}) {
  const port = options.port ?? Number(process.env.CIRCUIT_MCP_PORT ?? 4185);
  const nodeServer = http.createServer((req, res) => handleHttpRequest(req, res, options));

  await new Promise((resolve, reject) => {
    nodeServer.once("error", reject);
    nodeServer.listen(port, "127.0.0.1", () => {
      nodeServer.removeListener("error", reject);
      console.log(`CIRCUIT MCP (HTTP, stateless) → http://127.0.0.1:${nodeServer.address()?.port ?? port}/mcp`);
      resolve();
    });
  });
  return nodeServer;
}
