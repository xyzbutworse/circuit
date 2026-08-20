import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildCircuitMcpServer } from "../src/server.mjs";
import { createCircuitCore } from "../src/core.mjs";
import { createAuth } from "../src/auth.mjs";
import { startHttp } from "../src/transports/http.mjs";
import { fakeChain } from "./helpers.mjs";

const USERS = {
  "judge-token": { name: "judge", portfolios: ["alpha-01"] },
  "other-token": { name: "other", portfolios: ["beta-01"] },
};

async function startServer() {
  const core = createCircuitCore({ chain: fakeChain() });
  const nodeServer = await startHttp({ port: 0, auth: createAuth(USERS), core, logger: () => {} });
  const address = nodeServer.address();
  return { core, nodeServer, baseUrl: `http://127.0.0.1:${address.port}/mcp` };
}

async function clientFor(baseUrl, token) {
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} },
  });
  const client = new Client({ name: "http-test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

test("HTTP transport: authenticated client works end-to-end", async (t) => {
  const { nodeServer, baseUrl } = await startServer();
  t.after(() => { nodeServer.closeAllConnections?.(); nodeServer.close(); });
  const client = await clientFor(baseUrl, "judge-token");
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 8);
  const result = await client.callTool({ name: "circuit_evaluate_action", arguments: { portfolioId: "alpha-01", actions: [{ asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 2500 }] } });
  assert.ok(result.isError !== true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.decision, "BLOCKED");
  await client.close();
});

test("HTTP transport: missing token is rejected", async (t) => {
  const { nodeServer, baseUrl } = await startServer();
  t.after(() => { nodeServer.closeAllConnections?.(); nodeServer.close(); });
  await assert.rejects(() => clientFor(baseUrl, null), /401|Unauthorized|Server responded with/);
});

test("HTTP transport: wrong token is rejected", async (t) => {
  const { nodeServer, baseUrl } = await startServer();
  t.after(() => { nodeServer.closeAllConnections?.(); nodeServer.close(); });
  await assert.rejects(() => clientFor(baseUrl, "bogus-token"), /401|Unauthorized|Server responded with/);
});

test("HTTP transport: caller without portfolio access is forbidden", async (t) => {
  const { nodeServer, baseUrl } = await startServer();
  t.after(() => { nodeServer.closeAllConnections?.(); nodeServer.close(); });
  const client = await clientFor(baseUrl, "other-token");
  const result = await client.callTool({ name: "circuit_get_portfolio", arguments: { portfolioId: "alpha-01" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /FORBIDDEN/);
  await client.close();
});
