import test from "node:test";
import assert from "node:assert/strict";
import { PlannerError, normalizeLivePlan, parseLivePlanJson } from "../dist/competition/agent-plan.js";

const validRaw = {
  planId: "plan-ai-1",
  intents: [
    { assetId: "tslax", symbol: "TSLAx", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 39, rationale: "Primary allocation." },
    { assetId: "googlx", symbol: "GOOGLx", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 30, rationale: "Diversifier." },
  ],
  allocationRationale: "Deploy capital favoring TSLAx while staying diversified.",
  expectedAllocation: {
    cashUsd: 2000,
    holdings: [
      { assetId: "tslax", symbol: "TSLAx", notionalUsd: 3000, pctNav: 30 },
      { assetId: "googlx", symbol: "GOOGLx", notionalUsd: 3000, pctNav: 30 },
    ],
  },
  assumptions: ["References stay fresh.", "Slippage holds."],
};

test("normalizeLivePlan accepts valid structured output", () => {
  const plan = normalizeLivePlan(validRaw, "mandate-rwa-alpha-01", "plan-001", "gpt-5.6-terra");
  assert.equal(plan.id, "plan-ai-1");
  assert.equal(plan.mandateId, "mandate-rwa-alpha-01");
  assert.equal(plan.revisionOf, "plan-001");
  assert.equal(plan.provider, "openrouter");
  assert.equal(plan.model, "gpt-5.6-terra");
  assert.equal(plan.intents.length, 2);
  assert.equal(plan.intents[0].assetId, "tslax");
  assert.equal(plan.intents[0].symbol, "TSLAX");
  assert.equal(plan.intents[0].notionalUsd, 1500);
  assert.equal(plan.allocationRationale, validRaw.allocationRationale);
  assert.equal(plan.thesis, validRaw.allocationRationale);
  assert.equal(plan.expectedAllocation.cashUsd, 2000);
  assert.equal(plan.expectedAllocation.holdings[0].pctNav, 30);
  assert.equal(plan.assumptions.length, 2);
});

function assertMalformed(raw, pattern) {
  assert.throws(() => normalizeLivePlan(raw, "m", undefined, "gpt-5.6-terra"), error => {
    assert.ok(error instanceof PlannerError);
    assert.equal(error.code, "AI_MALFORMED_OUTPUT");
    assert.match(error.message, pattern);
    return true;
  });
}

test("malformed output: missing planId is rejected", () => {
  const { planId, ...rest } = validRaw;
  assertMalformed(rest, /planId/);
});

test("malformed output: negative notionals are rejected", () => {
  const raw = { ...validRaw, intents: [{ ...validRaw.intents[0], notionalUsd: -100 }] };
  assertMalformed(raw, /notionalUsd/);
});

test("malformed output: non-finite slippage is rejected", () => {
  const raw = { ...validRaw, intents: [{ ...validRaw.intents[0], expectedSlippageBps: Number.NaN }] };
  assertMalformed(raw, /expectedSlippageBps/);
});

test("malformed output: invalid side is rejected", () => {
  const raw = { ...validRaw, intents: [{ ...validRaw.intents[0], side: "HOLD" }] };
  assertMalformed(raw, /side/);
});

test("malformed output: missing assumptions is rejected", () => {
  const { assumptions, ...rest } = validRaw;
  assertMalformed(rest, /assumptions/);
});

test("malformed output: empty intents is rejected", () => {
  assertMalformed({ ...validRaw, intents: [] }, /intents/);
});

test("malformed output: missing expectedAllocation is rejected", () => {
  const { expectedAllocation, ...rest } = validRaw;
  assertMalformed(rest, /expectedAllocation/);
});

test("malformed output: non-object output is rejected", () => {
  assertMalformed("not-an-object", /JSON object/);
});

test("PlannerError carries a machine-readable code", () => {
  const error = new PlannerError("AI_TIMEOUT", "timed out");
  assert.equal(error.code, "AI_TIMEOUT");
  assert.equal(error.name, "PlannerError");
  assert.ok(error instanceof Error);
});

test("parseLivePlanJson accepts fenced JSON but rejects prose without an object", () => {
  assert.deepEqual(parseLivePlanJson('```json\n{"planId":"p1"}\n```'), { planId: "p1" });
  assert.throws(() => parseLivePlanJson("no plan returned"), error => error?.code === "AI_MALFORMED_OUTPUT");
});
