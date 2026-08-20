import test from "node:test";
import assert from "node:assert/strict";
import { getOkxCandles, rangeToBar, OKX_RWA_INSTRUMENTS } from "../dist/integrations/okx.js";
import { PlannerError } from "../dist/competition/agent-plan.js";

const CREDS = { OKX_API_KEY: "k", OKX_SECRET_KEY: "super-secret-value-xyz", OKX_PASSPHRASE: "p" };
function withEnv(fn){ const saved={OKX_API_KEY:process.env.OKX_API_KEY,OKX_SECRET_KEY:process.env.OKX_SECRET_KEY,OKX_PASSPHRASE:process.env.OKX_PASSPHRASE}; Object.assign(process.env,CREDS); return Promise.resolve(fn()).finally(()=>{for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}) }

function candleResponse(rows){
  return new Response(JSON.stringify({ code:"0", msg:"", data: rows }), { status:200, headers:{ "content-type":"application/json" } });
}

test("rangeToBar chooses appropriate granularity per range", () => {
  assert.deepEqual(rangeToBar("1H"), { bar:"1m", limit:120 });
  assert.deepEqual(rangeToBar("4H"), { bar:"5m", limit:96 });
  assert.deepEqual(rangeToBar("1D"), { bar:"15m", limit:96 });
  assert.deepEqual(rangeToBar("1W"), { bar:"1H", limit:168 });
  assert.deepEqual(rangeToBar("1M"), { bar:"1D", limit:31 });
});

test("instruments are the three RWA assets on X Layer mainnet (chain 196)", () => {
  for (const asset of ["tslax","googlx","mstrx"]) {
    const inst = OKX_RWA_INSTRUMENTS[asset];
    assert.equal(inst.chainIndex, "196");
    assert.match(inst.tokenContractAddress, /^0x[0-9a-f]{40}$/);
  }
});

test("candles normalize into typed objects with ordered timestamps and numeric parsing", async () => {
  await withEnv(async () => {
    const rows = [
      ["1786762800000","341.91","341.95","341.54","341.56","420.48","143697.14","1"],
      ["1786759200000","341.86","342.03","341.27","341.48","380.1","130000.5","1"],
    ];
    const fetchFn = async (url, init) => {
      assert.match(String(url), /api\/v6\/dex\/market\/candles/);
      assert.match(String(url), /chainIndex=196/);
      assert.equal(init.headers["OK-ACCESS-KEY"], "k");
      return candleResponse(rows);
    };
    const result = await getOkxCandles({ asset:"tslax", range:"1H", fetchFn });
    assert.equal(result.ok, true);
    const candles = result.candles;
    assert.equal(candles.length, 2);
    assert.equal(typeof candles[0].timestampMs, "number");
    assert.equal(candles[0].open, 341.91);
    assert.equal(candles[0].volumeUsd, 143697.14);
    assert.equal(candles[0].confirm, 1);
    assert.ok(candles[0].timestampMs > candles[1].timestampMs, "timestamps must be ordered");
    assert.equal(result.instrument.chainLabel, "X LAYER MAINNET");
  });
});

test("malformed rows are dropped, not fabricated", async () => {
  await withEnv(async () => {
    const rows = [["bad","o","h","l","c","v","vu","c"], ["1786759200000","1","2","0.5","1.5","3","4","1"]];
    const result = await getOkxCandles({ asset:"tslax", range:"1H", fetchFn: async () => candleResponse(rows) });
    assert.equal(result.ok, true);
    assert.equal(result.candles.length, 1);
    assert.equal(result.candles[0].close, 1.5);
  });
});

test("empty history returns ok with zero candles (MARKET HISTORY UNAVAILABLE)", async () => {
  await withEnv(async () => {
    const result = await getOkxCandles({ asset:"tslax", range:"1H", fetchFn: async () => candleResponse([]) });
    assert.equal(result.ok, true);
    assert.deepEqual(result.candles, []);
  });
});

test("provider timeout surfaces as OKX_TIMEOUT", async () => {
  await withEnv(async () => {
    const fetchFn = async (_url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name:"AbortError" })));
    });
    const result = await getOkxCandles({ asset:"tslax", range:"1H", fetchFn, timeoutMs:50 });
    assert.equal(result.ok, false);
    assert.equal(result.code, "OKX_TIMEOUT");
  });
});

test("provider error propagates its code and message", async () => {
  await withEnv(async () => {
    const result = await getOkxCandles({ asset:"tslax", range:"1H", fetchFn: async () => new Response(JSON.stringify({ msg:"quota", code:"50103" }), { status:401 }) });
    assert.equal(result.ok, false);
    assert.equal(result.code, "OKX_AUTH_REJECTED");
  });
});

test("unsupported asset is refused, never fabricated", async () => {
  await withEnv(async () => {
    const result = await getOkxCandles({ asset:"nvdlax", range:"1H", fetchFn: async () => candleResponse([]) });
    assert.equal(result.ok, false);
    assert.equal(result.code, "UNSUPPORTED_ASSET");
  });
});

test("no credentials appear in results or instruments", async () => {
  await withEnv(async () => {
    const result = await getOkxCandles({ asset:"tslax", range:"1H", fetchFn: async () => candleResponse([]) });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("OKX_SECRET_KEY"));
    assert.ok(!serialized.includes(CREDS.OKX_SECRET_KEY));
    assert.ok(!serialized.includes("OK-ACCESS"));
  });
});
