import test from "node:test";
import assert from "node:assert/strict";
import { runPlanningLoop } from "../dist/competition/planner.js";
import { PlannerError } from "../dist/competition/agent-plan.js";
import { demoMandate, demoMarket, demoPortfolio, violatingPlan, repairedPlan } from "../dist/competition/demo.js";

const objective = demoMandate.objective;

test("loop: violation feeds structured rejection, replan is re-evaluated and authorized", async () => {
  const calls = [];
  const generatePlan = async (ctx) => {
    calls.push(ctx);
    return structuredClone(ctx.violations.length > 0 ? repairedPlan : violatingPlan);
  };
  const result = await runPlanningLoop({ objective, portfolio: demoPortfolio, mandate: demoMandate, market: demoMarket, maxReplans: 2, generatePlan });
  assert.equal(result.status, "AUTHORIZED");
  assert.equal(result.allowed, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].decision.verdict, "BLOCKED");
  assert.equal(result.attempts[1].decision.verdict, "AUTHORIZED");
  assert.equal(result.attempts[1].decision.after.assetUsd.tslax, 3000);
  assert.equal(result.attempts[1].decision.after.issuerUsd.tesla, 3000);
  assert.equal(result.attempts[1].decision.after.sectorUsd.technology, 5000);
  assert.equal(result.attempts[1].decision.after.investedUsd, 8000);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].revisionOf, violatingPlan.id);
  assert.ok(calls[1].violations.some(v => v.code === "ISSUER_CONCENTRATION_EXCEEDED" && v.projectedExposureBps === 4000));
});

test("loop: the model never sees Circuit verdicts or mandate limits on the first pass", async () => {
  const firstCtx = {};
  const generatePlan = async (ctx) => {
    if (ctx.attempt === 1) Object.assign(firstCtx, ctx);
    return structuredClone(violatingPlan);
  };
  await runPlanningLoop({ objective, portfolio: demoPortfolio, mandate: demoMandate, market: demoMarket, maxReplans: 2, generatePlan });
  assert.equal(firstCtx.attempt, 1);
  assert.equal(firstCtx.violations.length, 0);
  assert.equal(firstCtx.revisionOf, undefined);
  assert.equal(firstCtx.availableCapitalUsd, demoPortfolio.cashUsd);
});

test("loop: a model that never complies exhausts the attempt budget without committing", async () => {
  const generatePlan = async () => structuredClone(violatingPlan);
  const result = await runPlanningLoop({ objective, portfolio: demoPortfolio, mandate: demoMandate, market: demoMarket, maxReplans: 2, generatePlan });
  assert.equal(result.status, "EXHAUSTED");
  assert.equal(result.allowed, false);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts.every(a => a.decision.verdict === "BLOCKED"), true);
  assert.equal(result.errorCode, "MAX_REPLANS_EXCEEDED");
});

test("loop: maxReplans 0 yields exactly one attempt", async () => {
  const generatePlan = async () => structuredClone(repairedPlan);
  const result = await runPlanningLoop({ objective, portfolio: demoPortfolio, mandate: demoMandate, market: demoMarket, maxReplans: 0, generatePlan });
  assert.equal(result.status, "AUTHORIZED");
  assert.equal(result.attempts.length, 1);
});

test("loop: missing credentials surface as AI_UNAVAILABLE with no silent fallback", async () => {
  const generatePlan = async () => { throw new PlannerError("AI_UNAVAILABLE", "AI UNAVAILABLE: OPENROUTER_API_KEY is not configured. LIVE AI never falls back to fixture output."); };
  const result = await runPlanningLoop({ objective, portfolio: demoPortfolio, mandate: demoMandate, market: demoMarket, maxReplans: 2, generatePlan });
  assert.equal(result.status, "AI_UNAVAILABLE");
  assert.equal(result.allowed, false);
  assert.equal(result.attempts.length, 0);
  assert.equal(result.errorCode, "AI_UNAVAILABLE");
});

test("loop: a provider failure mid-replan surfaces as AI_ERROR and keeps prior attempts in the trace", async () => {
  let call = 0;
  const generatePlan = async (ctx) => {
    call += 1;
    if (call === 2) throw new PlannerError("AI_TIMEOUT", "AI planning timed out after 20000ms.");
    return structuredClone(ctx.violations.length > 0 ? repairedPlan : violatingPlan);
  };
  const result = await runPlanningLoop({ objective, portfolio: demoPortfolio, mandate: demoMandate, market: demoMarket, maxReplans: 2, generatePlan });
  assert.equal(result.status, "AI_ERROR");
  assert.equal(result.errorCode, "AI_TIMEOUT");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].decision.verdict, "BLOCKED");
});
