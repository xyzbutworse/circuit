import test from "node:test";
import assert from "node:assert/strict";
import { verifyContract } from "../integrations/deployment.mjs";

test("deployed contract stays live when a serverless runtime lacks Forge artifacts", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x6001600055" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const result = await verifyContract("0x0000000000000000000000000000000000000001", new URL("file:///missing/contract.json"));
    assert.equal(result.status, "deployed");
    assert.match(result.detail, /runtime bytecode is present/);
    assert.equal(typeof result.runtimeBytecodeHash, "string");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("empty X Layer bytecode remains offline", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const result = await verifyContract("0x0000000000000000000000000000000000000001", new URL("file:///missing/contract.json"));
    assert.equal(result.status, "missing");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
