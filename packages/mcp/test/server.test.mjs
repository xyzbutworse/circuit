import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildCircuitMcpServer } from "../src/server.mjs";
import { createAuth } from "../src/auth.mjs";
import { createCircuitCore } from "../src/core.mjs";
import { fakeChain } from "./helpers.mjs";

async function connectClient(core, auth = null) {
  const server = buildCircuitMcpServer({ core, auth, logger: () => {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

test("tool discovery exposes all seven Circuit tools", async () => {
  const { client } = await connectClient(createCircuitCore({ chain: fakeChain() }));
  const tools = await client.listTools();
  const names = tools.tools.map(t => t.name).sort();
  assert.deepEqual(names, [
    "circuit_evaluate_action",
    "circuit_execute_authorized_action",
    "circuit_explain_violation",
    "circuit_get_mandate",
    "circuit_get_portfolio",
    "circuit_get_receipt",
    "circuit_project_action",
    "circuit_request_authorization",
  ].sort());
  await client.close();
});

test("schemas reject malformed inputs", async () => {
  const { client } = await connectClient(createCircuitCore({ chain: fakeChain() }));
  const bad = await client.callTool({ name: "circuit_project_action", arguments: { portfolioId: "alpha-01", actions: [{ side: "HOLD" }] } });
  assert.equal(bad.isError, true);
  const missing = await client.callTool({ name: "circuit_evaluate_action", arguments: { portfolioId: "alpha-01" } });
  assert.equal(missing.isError, true);
  const badHash = await client.callTool({ name: "circuit_execute_authorized_action", arguments: { portfolioId: "alpha-01", authorizationHash: "not-a-hash" } });
  assert.equal(badHash.isError, true);
  await client.close();
});

test("read tools never mutate state and evaluate matches the engine", async () => {
  const chain = fakeChain();
  const { client } = await connectClient(createCircuitCore({ chain }));
  const before = await client.callTool({ name: "circuit_get_portfolio", arguments: { portfolioId: "alpha-01" } });
  const projected = await client.callTool({ name: "circuit_project_action", arguments: { portfolioId: "alpha-01", actions: [{ asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 1500 }] } });
  const after = await client.callTool({ name: "circuit_get_portfolio", arguments: { portfolioId: "alpha-01" } });
  assert.ok(projected.isError !== true);
  const beforeJson = JSON.parse(before.content[0].text);
  const afterJson = JSON.parse(after.content[0].text);
  assert.equal(beforeJson.portfolioStateHash, afterJson.portfolioStateHash);
  assert.deepEqual(beforeJson.positions, afterJson.positions);

  const evaluation = await client.callTool({ name: "circuit_evaluate_action", arguments: { portfolioId: "alpha-01", actions: [{ asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 2500 }] } });
  assert.ok(evaluation.isError !== true);
  const result = JSON.parse(evaluation.content[0].text);
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.violations[0].code, "ISSUER_CONCENTRATION_EXCEEDED");
  assert.equal(result.violations[0].projectedBps, 4000);
  assert.equal(result.violations[0].maximumBps, 3500);
  assert.equal(result.mandateVersion, 7);
  assert.match(result.evaluationHash, /^0x[0-9a-f]{64}$/);
  await client.close();
});

test("parity across callers: same action → identical evaluationHash, decision, violations", async () => {
  const core = createCircuitCore({ chain: fakeChain() });
  const { client: clientA } = await connectClient(core);
  const { client: clientB } = await connectClient(core);
  const args = { portfolioId: "alpha-01", actions: [{ asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 2500 }] };
  const evalA = JSON.parse((await clientA.callTool({ name: "circuit_evaluate_action", arguments: args })).content[0].text);
  const evalB = JSON.parse((await clientB.callTool({ name: "circuit_evaluate_action", arguments: args })).content[0].text);
  assert.equal(evalA.evaluationHash, evalB.evaluationHash);
  assert.equal(evalA.decision, evalB.decision);
  assert.deepEqual(evalA.violations, evalB.violations);
  await clientA.close();
  await clientB.close();
});

test("consequential tools are marked non-read-only; read tools are read-only", async () => {
  const { client } = await connectClient(createCircuitCore({ chain: fakeChain() }));
  const tools = await client.listTools();
  const byName = new Map(tools.tools.map(t => [t.name, t]));
  assert.equal(byName.get("circuit_evaluate_action").annotations?.readOnlyHint, true);
  assert.equal(byName.get("circuit_request_authorization").annotations?.readOnlyHint, false);
  assert.equal(byName.get("circuit_request_authorization").annotations?.destructiveHint, true);
  assert.equal(byName.get("circuit_execute_authorized_action").annotations?.readOnlyHint, false);
  assert.equal(byName.get("circuit_execute_authorized_action").annotations?.destructiveHint, true);
  await client.close();
});

test("server instructions explain the Circuit workflow", async () => {
  const { client } = await connectClient(createCircuitCore({ chain: fakeChain() }));
  const instructions = client.getInstructions();
  assert.ok(instructions?.includes("Never treat model reasoning as authorization."));
  await client.close();
});

test("auth module: unauthorized portfolio access fails", () => {
  const auth = createAuth({ "good-token": { name: "judge", portfolios: ["alpha-01"] } });
  const authenticated = auth.authenticate({ authorization: "Bearer good-token" });
  assert.equal(authenticated.ok, true);
  assert.equal(auth.authorizePortfolio(authenticated.caller, "portfolio-alpha-01"), true);
  assert.equal(auth.authorizePortfolio(authenticated.caller, "portfolio-other"), false);
  const rejected = auth.authenticate({ authorization: "Bearer bad-token" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 401);
});

test("rate limiter rejects bursts beyond capacity", () => {
  const auth = createAuth(null, { rateLimit: { capacity: 3, refillPerSecond: 0 } });
  assert.equal(auth.allowRequest("caller-1"), true);
  assert.equal(auth.allowRequest("caller-1"), true);
  assert.equal(auth.allowRequest("caller-1"), true);
  assert.equal(auth.allowRequest("caller-1"), false);
});
