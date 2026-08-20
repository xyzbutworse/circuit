import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, toUtf8Bytes } from "ethers";
import { buildJudgeReceipt, intentHashFor, objectiveHashFor, traceIntentHashFor, verifyJudgeReceipt } from "../dist/competition/judge-receipt.js";
import { makeCircuitReceipt } from "../dist/competition/receipt.js";
import { evaluatePlan } from "../dist/competition/mandate.js";
import { normalizeLivePlan } from "../dist/competition/agent-plan.js";
import { stableHash } from "../dist/core/hash.js";
import { violatingPlan, repairedPlan, demoMandate, demoMarket, demoPortfolio } from "../dist/competition/demo.js";

const rejection = {
  code: "ISSUER_CONCENTRATION_EXCEEDED",
  bucketId: "tesla",
  issuer: "Tesla, Inc.",
  message: "Tesla, Inc. exposure would become 40.0% of NAV.",
  actual: 40,
  limit: 35,
  projectedExposureBps: 4000,
  limitBps: 3500,
};

const trades = [
  { assetId: "tslax", side: "BUY", notionalUsd: 1500, intentHash: "0xaaaa", txHash: "0xbbbb", blockNumber: 123, status: 1, authorizationHash: "0xcccc" },
  { assetId: "googlx", side: "BUY", notionalUsd: 1500, intentHash: "0xdddd", txHash: "0xeeee", blockNumber: 124, status: 1, authorizationHash: "0xffff" },
];

test("objectiveHashFor is keccak256 of the objective text", () => {
  const objective = "Deploy up to $4,500 of available cash into tokenized US equities.";
  assert.equal(objectiveHashFor(objective), keccak256(toUtf8Bytes(objective)));
});

test("intentHashFor is deterministic and unique per intent", () => {
  const a = intentHashFor("plan-002", 1, "tslax", "BUY", 1500);
  const b = intentHashFor("plan-002", 1, "tslax", "BUY", 1500);
  assert.equal(a, b);
  assert.notEqual(a, intentHashFor("plan-002", 2, "tslax", "BUY", 1500));
  assert.notEqual(a, intentHashFor("plan-002", 1, "tslax", "BUY", 1501));
  assert.notEqual(a, intentHashFor("plan-002", 1, "tslax", "SELL", 1500));
  assert.equal(a.length, 66);
});

test("judge receipt carries every required linkage field", () => {
  const receipt = buildJudgeReceipt({
    id: "judge-receipt:trace-1",
    chainId: 1952,
    createdAt: "2026-08-15T00:00:00.000Z",
    objective: "Deploy up to $4,500 of available cash into tokenized US equities.",
    plan1: violatingPlan,
    plan1Hash: "sha256:p1",
    plan2: repairedPlan,
    plan2Hash: "sha256:p2",
    evaluationHash: "sha256:evaluation",
    rejectionCode: rejection.code,
    rejection,
    mandateHash: "0xmandate",
    policyVersion: 1,
    policyKey: "0xpolicy",
    trades,
    finalPortfolioHash: "sha256:final",
    previousReceiptHash: "sha256:prev",
  });
  assert.equal(receipt.objectiveHash.length, 66);
  assert.equal(receipt.plan1Hash, "sha256:p1");
  assert.equal(receipt.plan2Hash, "sha256:p2");
  assert.equal(receipt.evaluationHash, "sha256:evaluation");
  assert.equal(receipt.rejectionCode, "ISSUER_CONCENTRATION_EXCEEDED");
  assert.equal(receipt.rejection.projectedExposureBps, 4000);
  assert.equal(receipt.mandateHash, "0xmandate");
  assert.equal(receipt.policyVersion, 1);
  assert.equal(receipt.intentHash, trades[0].intentHash);
  assert.equal(receipt.authorizationHash, trades[0].authorizationHash);
  assert.equal(receipt.transactionHash, trades[0].txHash);
  assert.equal(receipt.trades.length, 2);
  assert.equal(receipt.finalPortfolioHash, "sha256:final");
  assert.equal(receipt.previousReceiptHash, "sha256:prev");
  assert.equal(receipt.receiptHash.length > 10, true);
});

test("judge receipt hash changes when any linked field changes", () => {
  const base = {
    id: "judge-receipt:trace-1",
    chainId: 1952,
    createdAt: "2026-08-15T00:00:00.000Z",
    objective: "objective",
    plan1: violatingPlan,
    plan1Hash: "sha256:p1",
    plan2: repairedPlan,
    plan2Hash: "sha256:p2",
    evaluationHash: "sha256:evaluation",
    rejectionCode: rejection.code,
    rejection,
    mandateHash: "0xmandate",
    policyVersion: 1,
    policyKey: "0xpolicy",
    trades,
    finalPortfolioHash: "sha256:final",
  };
  const one = buildJudgeReceipt(base);
  const two = buildJudgeReceipt({ ...base, trades: [{ ...trades[0], txHash: "0xdifferent" }, trades[1]] });
  assert.notEqual(one.receiptHash, two.receiptHash);
  assert.notEqual(one.transactionHash, two.transactionHash);
  const three = buildJudgeReceipt({ ...base, objective: "changed objective" });
  assert.notEqual(one.receiptHash, three.receiptHash);
  const four = buildJudgeReceipt({ ...base, evaluationHash: "sha256:changed-evaluation" });
  assert.notEqual(one.receiptHash, four.receiptHash);
});

function openRouterPlan(base, generatedAt) {
  const raw = {
    planId: base.id,
    intents: base.intents.map(({ id: _id, ...intent }) => intent),
    allocationRationale: base.allocationRationale,
    expectedAllocation: base.expectedAllocation,
    assumptions: base.assumptions,
  };
  const rawCompletion = JSON.stringify(raw);
  const provenance = {
      provider: "openrouter",
      generationId: `gen-${base.id}`,
      requestedModel: "openai/gpt-5",
      resolvedModel: "openai/gpt-5",
      upstreamProvider: "OpenAI",
      requestId: `req-${base.id}`,
      requestHash: stableHash({ plan: base.id }),
      completionHash: stableHash(rawCompletion),
      normalizedOutputHash: stableHash(raw),
      rawCompletion,
      finishReason: "stop",
      generatedAt,
      metadataVerifiedAt: generatedAt,
      metadataVerified: true,
  };
  const plan = normalizeLivePlan(raw, base.mandateId, base.revisionOf, "openai/gpt-5", provenance);
  plan.objective = base.objective;
  return plan;
}

function verifiedFixture() {
  const traceId = "trace-openrouter-proof";
  const plan1 = openRouterPlan(violatingPlan, "2026-08-15T00:00:01.000Z");
  const plan2 = openRouterPlan(repairedPlan, "2026-08-15T00:00:02.000Z");
  const decision1 = evaluatePlan(plan1, demoPortfolio, demoMandate, demoMarket, "2026-08-15T00:00:03.000Z");
  const decision2 = evaluatePlan(plan2, demoPortfolio, demoMandate, demoMarket, "2026-08-15T00:00:04.000Z");
  const receipt1 = makeCircuitReceipt({ mandateId: demoMandate.id, portfolioId: demoPortfolio.id, planId: plan1.id, decision: decision1, createdAt: decision1.checkedAt });
  const receipt2 = makeCircuitReceipt({ mandateId: demoMandate.id, portfolioId: demoPortfolio.id, planId: plan2.id, decision: decision2, createdAt: decision2.checkedAt, previousReceiptHash: receipt1.receiptHash });
  const linkedTrades = plan2.intents.map((intent, index) => ({
    assetId: intent.assetId,
    side: intent.side,
    notionalUsd: intent.notionalUsd,
    intentHash: traceIntentHashFor(traceId, plan2.id, index + 1, intent.assetId, intent.side, intent.notionalUsd),
    txHash: `0x${String(index + 1).repeat(64)}`,
    blockNumber: 100 + index,
    status: 1,
    authorizationHash: `0x${String(index + 4).repeat(64)}`,
  }));
  const readback = { assetUsd: decision2.after.assetUsd, cashUsd: decision2.after.cashUsd, dailyTurnoverUsd: decision2.after.dailyTurnoverUsd, totalInvested: decision2.after.investedUsd };
  const judgeReceipt = buildJudgeReceipt({
    id: `judge-receipt:${traceId}`,
    chainId: 1952,
    createdAt: "2026-08-15T00:00:05.000Z",
    objective: demoMandate.objective,
    plan1,
    plan1Hash: decision1.planHash,
    plan2,
    plan2Hash: decision2.planHash,
    evaluationHash: receipt2.receiptHash,
    evaluationReceiptHashes: [receipt1.receiptHash, receipt2.receiptHash],
    rejectionCode: decision1.violations[0].code,
    rejection: decision1.violations[0],
    mandateHash: "0x" + "7".repeat(64),
    policyVersion: 1,
    policyKey: "0x" + "8".repeat(64),
    trades: linkedTrades,
    finalPortfolioHash: decision2.afterPortfolioHash,
    onchainReadback: readback,
    previousReceiptHash: receipt2.receiptHash,
  });
  return { judgeReceipt, context: { traceId, attempts: [{ attempt: 1, plan: plan1, decision: decision1 }, { attempt: 2, plan: plan2, decision: decision2, revisionOf: plan1.id }], attemptReceipts: [receipt1, receipt2], onchain: { ok: true, trades: linkedTrades, readback } } };
}

test("judge proof verifier proves OpenRouter plan, evaluations, transactions, and readback", () => {
  const { judgeReceipt, context } = verifiedFixture();
  const result = verifyJudgeReceipt(judgeReceipt, context);
  assert.equal(result.valid, true, result.checks.filter(check => !check.valid).map(check => check.detail).join("\n"));
  assert.equal(result.checks.length, 9);
});

test("judge proof verifier rejects tampered AI output and transaction linkage", () => {
  const one = verifiedFixture();
  one.context.attempts[1].plan.provenance.rawCompletion = one.context.attempts[1].plan.provenance.rawCompletion.replace("1500", "1501");
  const aiResult = verifyJudgeReceipt(one.judgeReceipt, one.context);
  assert.equal(aiResult.valid, false);
  assert.equal(aiResult.checks.find(check => check.id === "OPENROUTER_GENERATIONS").valid, false);

  const two = verifiedFixture();
  two.context.onchain.trades[0].intentHash = "0x" + "f".repeat(64);
  const txResult = verifyJudgeReceipt(two.judgeReceipt, two.context);
  assert.equal(txResult.valid, false);
  assert.equal(txResult.checks.find(check => check.id === "ONCHAIN_TRANSACTIONS").valid, false);
});
