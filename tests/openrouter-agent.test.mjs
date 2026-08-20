import test from "node:test";
import assert from "node:assert/strict";
import { stableHash } from "../dist/core/hash.js";
import { demoMandate, demoMarket, demoPortfolio } from "../dist/competition/demo.js";
import { aiProviderInfo, planWithOpenRouter } from "../integrations/openrouter-agent.mjs";

const rawPlan = {
  planId: "plan-openrouter-1",
  intents: [{ assetId: "tslax", symbol: "TSLAx", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 25, rationale: "Stay within issuer exposure." }],
  allocationRationale: "Use a bounded TSLAx allocation.",
  expectedAllocation: { cashUsd: 5000, holdings: [
    { assetId: "tslax", symbol: "TSLAx", notionalUsd: 3000, pctNav: 30 },
    { assetId: "googlx", symbol: "GOOGLx", notionalUsd: 1500, pctNav: 15 },
    { assetId: "mstrx", symbol: "MSTRx", notionalUsd: 500, pctNav: 5 },
  ] },
  assumptions: ["Supplied market references remain current."],
};

function withOpenRouterEnv(run) {
  const before = {
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
    metadataAttempts: process.env.OPENROUTER_METADATA_ATTEMPTS,
    metadataDelayMs: process.env.OPENROUTER_METADATA_DELAY_MS,
  };
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "openai/gpt-5";
  process.env.OPENROUTER_METADATA_ATTEMPTS = "2";
  process.env.OPENROUTER_METADATA_DELAY_MS = "50";
  return Promise.resolve(run()).finally(() => {
    if (before.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = before.key;
    if (before.model === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = before.model;
    if (before.metadataAttempts === undefined) delete process.env.OPENROUTER_METADATA_ATTEMPTS; else process.env.OPENROUTER_METADATA_ATTEMPTS = before.metadataAttempts;
    if (before.metadataDelayMs === undefined) delete process.env.OPENROUTER_METADATA_DELAY_MS; else process.env.OPENROUTER_METADATA_DELAY_MS = before.metadataDelayMs;
  });
}

test("OpenRouter provider requires both key and model", { concurrency: false }, () => {
  const before = { key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL };
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  assert.equal(aiProviderInfo().configured, false);
  process.env.OPENROUTER_API_KEY = "test-key";
  assert.equal(aiProviderInfo().configured, false);
  if (before.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = before.key;
  if (before.model === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = before.model;
});

test("OpenRouter plan records verified generation provenance and exact content hashes", { concurrency: false }, async () => withOpenRouterEnv(async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/generation?")) return new Response(JSON.stringify({ data: {
      id: "gen-proof-1", model: "openai/gpt-5", provider_name: "OpenAI", request_id: "req-proof-1"
    } }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({
      id: "gen-proof-1",
      created: 1787193600,
      model: "openai/gpt-5",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(rawPlan) } }],
      usage: { prompt_tokens: 800, completion_tokens: 240 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const plan = await planWithOpenRouter({ mandate: demoMandate, portfolio: demoPortfolio, market: demoMarket, objective: demoMandate.objective, timeoutMs: 1000 });
    assert.equal(plan.provider, "openrouter");
    assert.equal(plan.model, "openai/gpt-5");
    assert.equal(plan.provenance.generationId, "gen-proof-1");
    assert.equal(plan.provenance.metadataVerified, true);
    assert.equal(plan.provenance.upstreamProvider, "OpenAI");
    assert.equal(plan.provenance.completionHash, stableHash(JSON.stringify(rawPlan)));
    assert.equal(plan.provenance.normalizedOutputHash, stableHash(rawPlan));
    assert.equal(plan.intents[0].id, "intent-plan-openrouter-1-1");
    assert.equal(calls.length, 2);
    const request = JSON.parse(calls[0].init.body);
    assert.equal(request.model, "openai/gpt-5");
    assert.equal(request.response_format.type, "json_schema");
  } finally { globalThis.fetch = previousFetch; }
}));

test("OpenRouter planning fails closed when generation metadata cannot be verified", { concurrency: false }, async () => withOpenRouterEnv(async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ id: "gen-proof-2", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(rawPlan) } }] }), { status: 200 });
    return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
  };
  try {
    await assert.rejects(
      () => planWithOpenRouter({ mandate: demoMandate, portfolio: demoPortfolio, market: demoMarket, objective: demoMandate.objective, timeoutMs: 1000 }),
      error => error?.code === "AI_PROVIDER_ERROR" && /metadata verification failed/.test(error.message),
    );
    assert.equal(calls, 3);
  } finally { globalThis.fetch = previousFetch; }
}));
