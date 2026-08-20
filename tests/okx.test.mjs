import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  OkxError,
  fetchOkxMarketContext,
  marketContextForAgent,
  buildLiveMarket,
  okxConfigured,
  signRequest,
} from "../dist/integrations/okx.js";
import { demoMarket } from "../dist/competition/demo.js";

const CREDS = { OKX_API_KEY: "test-key", OKX_SECRET_KEY: "test-secret", OKX_PASSPHRASE: "test-pass" };

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) { saved[key] = process.env[key]; if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; }
  return Promise.resolve(fn()).finally(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const indexPriceData = [
  { price: "339.85000000", time: String(Date.now() - 4000), chainIndex: "1", tokenContractAddress: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0" },
  { price: "345.15000000", time: String(Date.now() - 4000), chainIndex: "1", tokenContractAddress: "0xe92f673ca36c5e2efd2de7628f815f84807e803f" },
  { price: "94.07000000", time: String(Date.now() - 4000), chainIndex: "1", tokenContractAddress: "0xae2f842ef90c0d5213259ab82639d5bbf649b08e" },
];

function liveFetch(url, init) {
  const target = typeof url === "string" ? url : String(url);
  if (target.includes("/api/v6/dex/index/current-price")) {
    assert.equal(init.method, "POST");
    assert.ok(init.headers["OK-ACCESS-KEY"]);
    assert.ok(init.headers["OK-ACCESS-SIGN"]);
    assert.ok(init.headers["OK-ACCESS-TIMESTAMP"]);
    assert.ok(init.headers["OK-ACCESS-PASSPHRASE"]);
    return Promise.resolve(jsonResponse({ code: "0", msg: "", data: indexPriceData }));
  }
  if (target.includes("/api/v6/dex/market/rwa/tokens")) {
    return Promise.resolve(jsonResponse({ code: "0", data: { cursor: "", list: [
      { tokenSymbol: "TSLAx", volume24h: "123456.789" },
      { tokenSymbol: "GOOGLx", volume24h: "98765.432" },
    ] } }));
  }
  if (target.includes("/api/v6/dex/aggregator/quote")) {
    return Promise.resolve(jsonResponse({ code: "0", data: [{ priceImpactPercent: "-0.42" }] }));
  }
  return Promise.resolve(jsonResponse({ code: "0", data: [] }));
}

test("signRequest follows the official pre-hash: timestamp + METHOD + path + body", () => {
  const timestamp = "2026-08-14T12:00:00.000Z";
  const body = JSON.stringify([{ chainIndex: "1", tokenContractAddress: "0xabc" }]);
  const signature = signRequest(timestamp, "POST", "/api/v6/dex/index/current-price", body, "secret");
  const expected = createHmac("sha256", "secret").update(`${timestamp}POST/api/v6/dex/index/current-price${body}`).digest("base64");
  assert.equal(signature, expected);
});

test("missing credentials yield MISCONFIGURED entries and never call the network", async () => {
  await withEnv({ OKX_API_KEY: undefined, OKX_SECRET_KEY: undefined, OKX_PASSPHRASE: undefined }, async () => {
    let calls = 0;
    const result = await fetchOkxMarketContext(["tslax", "googlx", "mstrx"], { fetchFn: async () => { calls += 1; return jsonResponse({}); } });
    assert.equal(result.state, "MISCONFIGURED");
    assert.equal(result.entries.tslax.state, "MISCONFIGURED");
    assert.equal(result.entries.tslax.stateCode, "OKX_MISSING_CREDENTIALS");
    assert.equal(calls, 0);
    assert.equal(okxConfigured(), false);
  });
});

test("authenticated index prices normalize into LIVE MarketContext entries", async () => {
  await withEnv(CREDS, async () => {
    const before = Date.now();
    const result = await fetchOkxMarketContext(["tslax", "googlx", "mstrx"], { fetchFn: liveFetch });
    assert.equal(result.state, "LIVE");
    assert.equal(result.provider, "OKX");
    assert.ok(result.fetchedAt >= before);
    const entry = result.entries.tslax;
    assert.equal(entry.state, "LIVE");
    assert.equal(entry.context.asset, "TSLAx");
    assert.equal(entry.context.chainId, 1);
    assert.equal(entry.context.price, "339.85000000");
    assert.ok(Math.abs(entry.context.quoteTimestamp - (Date.now() - 4000)) < 5000);
    assert.equal(typeof entry.context.referenceAgeSeconds, "number");
    assert.ok(entry.context.referenceAgeSeconds >= 0 && entry.context.referenceAgeSeconds < 60);
    assert.equal(entry.context.provider, "OKX");
    assert.equal(entry.context.rawReferenceId, "index-price:1:0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0");
    assert.equal(entry.context.expectedSlippageBps, 42);
    assert.equal(entry.context.liquidity, "123456.789");
    const mstrx = result.entries.mstrx.context;
    assert.equal(mstrx.asset, "MSTRx");
    assert.equal(mstrx.expectedSlippageBps, 42);
    assert.equal(mstrx.liquidity, undefined);
  });
});

test("rejected credentials yield MISCONFIGURED entries with OKX_AUTH_REJECTED", async () => {
  await withEnv(CREDS, async () => {
    const fetchFn = async () => jsonResponse({ msg: "Request header OK-ACCESS-KEY can not be empty.", code: "50103" }, 401);
    const result = await fetchOkxMarketContext(["tslax"], { fetchFn });
    assert.equal(result.state, "MISCONFIGURED");
    assert.equal(result.entries.tslax.state, "MISCONFIGURED");
    assert.equal(result.entries.tslax.stateCode, "OKX_AUTH_REJECTED");
  });
});

test("x402 payment-required responses surface as UNAVAILABLE without fabricating data", async () => {
  await withEnv(CREDS, async () => {
    const fetchFn = async () => new Response(JSON.stringify({ x402Version: 2, resource: { url: "https://web3.okx.com/api/v6/dex/market/rwa/tokens" } }), { status: 402, headers: { "content-type": "application/json" } });
    const result = await fetchOkxMarketContext(["tslax"], { fetchFn });
    assert.equal(result.state, "UNAVAILABLE");
    assert.equal(result.paymentRequired, true);
    assert.equal(result.entries.tslax.state, "UNAVAILABLE");
    assert.equal(result.entries.tslax.stateCode, "OKX_PAYMENT_REQUIRED");
    assert.equal(result.entries.tslax.context, undefined);
  });
});

test("network failure retries once, then yields UNAVAILABLE OKX_NETWORK_ERROR", async () => {
  await withEnv(CREDS, async () => {
    let calls = 0;
    const fetchFn = async () => { calls += 1; throw new TypeError("fetch failed"); };
    const result = await fetchOkxMarketContext(["tslax"], { fetchFn });
    assert.equal(result.state, "UNAVAILABLE");
    assert.equal(result.entries.tslax.state, "UNAVAILABLE");
    assert.ok(["OKX_NETWORK_ERROR", "OKX_TIMEOUT"].includes(result.entries.tslax.stateCode));
    assert.ok(calls >= 2);
  });
});

test("timeout surfaces as UNAVAILABLE OKX_TIMEOUT", async () => {
  await withEnv(CREDS, async () => {
    const fetchFn = async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    const result = await fetchOkxMarketContext(["tslax"], { fetchFn, timeoutMs: 50 });
    assert.equal(result.state, "UNAVAILABLE");
    assert.equal(result.entries.tslax.stateCode, "OKX_TIMEOUT");
  });
});

test("unknown assets are UNSUPPORTED and support is never fabricated", async () => {
  await withEnv(CREDS, async () => {
    const result = await fetchOkxMarketContext(["tslax", "nvdlax"], { fetchFn: liveFetch });
    assert.equal(result.entries.nvdlax.state, "UNSUPPORTED");
    assert.equal(result.entries.nvdlax.stateCode, "OKX_ASSET_UNKNOWN");
    assert.equal(result.entries.nvdlax.context, undefined);
    assert.equal(result.entries.tslax.state, "LIVE");
  });
});

test("marketContextForAgent exposes normalized state for the AI planner", async () => {
  await withEnv(CREDS, async () => {
    const result = await fetchOkxMarketContext(["tslax"], { fetchFn: liveFetch });
    const forAgent = marketContextForAgent(result);
    const entry = forAgent[0];
    assert.equal(entry.assetId, "tslax");
    assert.equal(entry.state, "LIVE");
    assert.equal(entry.provider, "OKX");
    assert.equal(entry.asset, "TSLAx");
    assert.equal(entry.price, "339.85000000");
    assert.equal(entry.chainId, 1);
  });
});

test("buildLiveMarket: LIVE assets carry OKX prices, stale assets block new exposure, UNSUPPORTED are excluded", async () => {
  await withEnv(CREDS, async () => {
    const result = await fetchOkxMarketContext(["tslax", "googlx", "mstrx"], { fetchFn: liveFetch });
    result.entries.googlx = { state: "MISCONFIGURED", stateCode: "OKX_MISSING_CREDENTIALS" };
    result.entries.mstrx = { state: "UNSUPPORTED", stateCode: "OKX_ASSET_UNKNOWN" };
    const market = buildLiveMarket(result, demoMarket);
    const byId = new Map(market.map(a => [a.assetId, a]));
    assert.equal(market.length, 2);
    assert.equal(byId.has("mstrx"), false);
    assert.equal(byId.get("tslax").priceUsd, 339.85);
    assert.equal(byId.get("tslax").source, "okx");
    assert.equal(byId.get("tslax").marketSession, "open");
    assert.ok(byId.get("tslax").referenceFreshnessMinutes < 1);
    assert.equal(byId.get("googlx").source, "okx");
    assert.equal(byId.get("googlx").referenceFreshnessMinutes, Number.MAX_SAFE_INTEGER);
    assert.equal(byId.get("googlx").marketSession, "unknown");
    assert.equal(byId.get("googlx").priceUsd, 0);
  });
});

test("OkxError carries state, code and httpStatus", () => {
  const error = new OkxError("MISCONFIGURED", "OKX_AUTH_REJECTED", "rejected", { httpStatus: 401 });
  assert.equal(error.state, "MISCONFIGURED");
  assert.equal(error.code, "OKX_AUTH_REJECTED");
  assert.equal(error.httpStatus, 401);
  assert.ok(error instanceof Error);
});
