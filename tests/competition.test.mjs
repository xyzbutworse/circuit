import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlan, feedbackForAgent } from "../dist/competition/mandate.js";
import { makeCircuitReceipt } from "../dist/competition/receipt.js";
import { demoMandate, demoMarket, demoPortfolio, violatingPlan, repairedPlan } from "../dist/competition/demo.js";

const now = "2026-08-14T18:30:00.000Z";

test("a technically plausible trade is blocked by resulting issuer concentration", () => {
  const decision = evaluatePlan(violatingPlan, demoPortfolio, demoMandate, demoMarket, now);
  assert.equal(decision.allowed, false);
  assert.equal(decision.verdict, "BLOCKED");
  assert.ok(decision.violations.some(v => v.code === "ISSUER_CONCENTRATION_EXCEEDED" && v.bucketId === "tesla"));
  assert.equal(decision.after.assetUsd.tslax, 4000);
});

test("replanned batch stays inside the portfolio mandate", () => {
  const decision = evaluatePlan(repairedPlan, demoPortfolio, demoMandate, demoMarket, now);
  assert.equal(decision.allowed, true);
  assert.equal(decision.verdict, "AUTHORIZED");
  assert.equal(decision.after.assetUsd.tslax, 3000);
  assert.equal(decision.after.issuerUsd.tesla, 3000);
  assert.equal(decision.after.sectorUsd.technology, 5000);
  assert.equal(decision.after.investedUsd, 8000);
});

test("Circuit returns machine-readable rejection feedback", () => {
  const decision = evaluatePlan(violatingPlan, demoPortfolio, demoMandate, demoMarket, now);
  const feedback = feedbackForAgent(decision);
  const violation = feedback.find(v => v.code === "ISSUER_CONCENTRATION_EXCEEDED");
  assert.ok(violation);
  assert.equal(violation.bucketId, "tesla");
  assert.equal(violation.issuer, "Tesla, Inc.");
  assert.equal(violation.projectedExposureBps, 4000);
  assert.equal(violation.limitBps, 3500);
});

test("stale reference blocks new exposure even when concentration is fine", () => {
  const market = demoMarket.map(a => a.assetId === "tslax" ? { ...a, referenceFreshnessMinutes: 90 } : a);
  const plan = { ...repairedPlan, intents: [repairedPlan.intents[0]] };
  const decision = evaluatePlan(plan, demoPortfolio, demoMandate, market, now);
  assert.ok(decision.violations.some(v => v.code === "REFERENCE_STALE"));
});

test("closed reference market caps new exposure", () => {
  const market = demoMarket.map(a => a.assetId === "tslax" ? { ...a, marketSession: "closed" } : a);
  const plan = { ...repairedPlan, intents: [{ ...repairedPlan.intents[0], notionalUsd: 1200 }] };
  const decision = evaluatePlan(plan, demoPortfolio, demoMandate, market, now);
  assert.ok(decision.violations.some(v => v.code === "CLOSED_MARKET_BUY_LIMIT"));
});

test("material event caps new exposure", () => {
  const market = demoMarket.map(a => a.assetId === "googlx" ? { ...a, materialEvent: true } : a);
  const plan = { ...repairedPlan, intents: [{ ...repairedPlan.intents[1], notionalUsd: 800 }] };
  const decision = evaluatePlan(plan, demoPortfolio, demoMandate, market, now);
  assert.ok(decision.violations.some(v => v.code === "MATERIAL_EVENT_BUY_LIMIT"));
});

test("daily turnover is portfolio state, not a per-trade property", () => {
  const mandate = { ...demoMandate, maxDailyTurnoverPctNav: 40 };
  const decision = evaluatePlan(repairedPlan, demoPortfolio, mandate, demoMarket, now);
  assert.ok(decision.violations.some(v => v.code === "DAILY_TURNOVER_EXCEEDED"));
});

test("receipts link before and after portfolio state", () => {
  const decision = evaluatePlan(repairedPlan, demoPortfolio, demoMandate, demoMarket, now);
  const first = makeCircuitReceipt({ mandateId: demoMandate.id, portfolioId: demoPortfolio.id, planId: repairedPlan.id, decision, createdAt: now });
  const second = makeCircuitReceipt({ mandateId: demoMandate.id, portfolioId: demoPortfolio.id, planId: repairedPlan.id, decision, createdAt: "2026-08-14T18:31:00.000Z", previousReceiptHash: first.receiptHash });
  assert.notEqual(first.receiptHash, second.receiptHash);
  assert.equal(second.previousReceiptHash, first.receiptHash);
  assert.equal(first.beforePortfolioHash, decision.beforePortfolioHash);
  assert.equal(first.afterPortfolioHash, decision.afterPortfolioHash);
});
