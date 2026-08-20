import test from "node:test";
import assert from "node:assert/strict";
import { createCircuitCore } from "../src/core.mjs";
import { fakeChain } from "./helpers.mjs";

const COMPLIANT = [
  { asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 39 },
  { asset: "GOOGLx", assetId: "googlx", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 30 },
  { asset: "MSTRx", assetId: "mstrx", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 44 },
];
const BLOCKED = [{ asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 2500, expectedSlippageBps: 42 }];

test("parity: same portfolio + mandate + action → same evaluationHash, decision, violations regardless of caller", async () => {
  const chainA = fakeChain();
  const chainB = fakeChain();
  const coreA = createCircuitCore({ chain: chainA });
  const coreB = createCircuitCore({ chain: chainB });
  const evalA = await coreA.evaluate("alpha-01", BLOCKED);
  const evalB = await coreB.evaluate("alpha-01", BLOCKED);
  assert.equal(evalA.ok, true);
  assert.equal(evalB.ok, true);
  assert.equal(evalA.evaluationHash, evalB.evaluationHash);
  assert.equal(evalA.decision, evalB.decision);
  assert.deepEqual(evalA.violations.map(v => v.code), evalB.violations.map(v => v.code));
  assert.deepEqual(evalA.violations[0].projectedBps, evalB.violations[0].projectedBps);
});

test("project_action does not mutate state", async () => {
  const chain = fakeChain();
  const core = createCircuitCore({ chain });
  const before = await core.getPortfolio("alpha-01");
  const projected = await core.project("alpha-01", COMPLIANT);
  const after = await core.getPortfolio("alpha-01");
  assert.equal(projected.ok, true);
  assert.equal(before.portfolioStateHash, after.portfolioStateHash);
  assert.deepEqual(before.positions, after.positions);
  assert.deepEqual(before.issuerExposures, after.issuerExposures);
});

test("evaluate blocked action returns the exact engine violation", async () => {
  const core = createCircuitCore({ chain: fakeChain() });
  const result = await core.evaluate("alpha-01", BLOCKED);
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.violations[0].code, "ISSUER_CONCENTRATION_EXCEEDED");
  assert.equal(result.violations[0].issuer, "Tesla, Inc.");
  assert.equal(result.violations[0].projectedBps, 4000);
  assert.equal(result.violations[0].maximumBps, 3500);
});

test("explain_violation produces deterministic repair constraints without an LLM", async () => {
  const core = createCircuitCore({ chain: fakeChain() });
  const evaluation = await core.evaluate("alpha-01", BLOCKED);
  const explanation = await core.explain("alpha-01", evaluation.violations[0]);
  assert.equal(explanation.code, "ISSUER_CONCENTRATION_EXCEEDED");
  assert.equal(explanation.repairConstraints.maximumAdditionalIssuerExposureUsd, 2000);
  assert.equal(explanation.violatedRule, "issuer concentration / NAV");
  const again = await core.explain("alpha-01", evaluation.violations[0]);
  assert.deepEqual(explanation, again);
});

test("blocked action cannot be authorized", async () => {
  const chain = fakeChain();
  const core = createCircuitCore({ chain });
  const evaluation = await core.evaluate("alpha-01", BLOCKED);
  const result = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: BLOCKED,
    portfolioStateHash: chain.state.portfolioStateHash,
    mandateVersion: chain.state.mandate.version,
    evaluationHash: evaluation.evaluationHash,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.violations[0].code, "ISSUER_CONCENTRATION_EXCEEDED");
});

test("blocked action cannot be executed (no authorization exists)", async () => {
  const core = createCircuitCore({ chain: fakeChain() });
  const result = await core.executeAuthorizedAction({ portfolioId: "portfolio-alpha-01", authorizationHash: "0x" + "11".repeat(32) });
  assert.equal(result.ok, false);
  assert.equal(result.status, "NOT_FOUND");
});

test("compliant action can be authorized and executed; receipt links everything", async () => {
  const chain = fakeChain({ executable: true });
  const core = createCircuitCore({ chain });
  const evaluation = await core.evaluate("alpha-01", COMPLIANT);
  assert.equal(evaluation.decision, "COMPLIANT");
  const authorization = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: COMPLIANT,
    portfolioStateHash: chain.state.portfolioStateHash,
    mandateVersion: chain.state.mandate.version,
    evaluationHash: evaluation.evaluationHash,
  });
  assert.equal(authorization.ok, true);
  assert.equal(authorization.status, "AUTHORIZED");
  assert.match(authorization.authorizationHash, /^0x[0-9a-f]{64}$/);
  assert.equal(typeof authorization.expiry, "number");

  const execution = await core.executeAuthorizedAction({ portfolioId: "portfolio-alpha-01", authorizationHash: authorization.authorizationHash });
  assert.equal(execution.ok, true);
  assert.equal(execution.status, "EXECUTED");
  assert.match(execution.txHash, /^0x[0-9a-f]{64}$/);
  const receipt = execution.receipt;
  assert.equal(receipt.mandateHash, chain.state.mandate.mandateHash);
  assert.equal(receipt.mandateVersion, 7);
  assert.equal(receipt.preStateHash, chain.state.portfolioStateHash);
  assert.equal(receipt.planHash, chain.actionsHashFor(chain.actionStructsFromActions(COMPLIANT)));
  assert.equal(receipt.evaluationHash, evaluation.evaluationHash);
  assert.equal(receipt.authorizationHash, authorization.authorizationHash);
  assert.equal(receipt.txHash, execution.txHash);
  assert.equal(receipt.blockNumber, 123456);
  assert.equal(receipt.timestamp.length > 0, true);
  assert.match(receipt.receiptHash, /^sha256:/);

  const fetched = await core.getReceipt(receipt.id);
  assert.equal(fetched.ok, true);
  assert.equal(fetched.receipt.txHash, execution.txHash);
});

test("expired authorization fails", async () => {
  const chain = fakeChain({ executable: true, expirySeconds: -10 });
  const core = createCircuitCore({ chain });
  const evaluation = await core.evaluate("alpha-01", COMPLIANT);
  const authorization = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: COMPLIANT,
    portfolioStateHash: chain.state.portfolioStateHash,
    mandateVersion: chain.state.mandate.version,
    evaluationHash: evaluation.evaluationHash,
  });
  assert.equal(authorization.ok, true);
  const result = await core.executeAuthorizedAction({ portfolioId: "portfolio-alpha-01", authorizationHash: authorization.authorizationHash });
  assert.equal(result.ok, false);
  assert.equal(result.status, "EXPIRED");
});

test("changed mandate version fails", async () => {
  const chain = fakeChain({ executable: true });
  const core = createCircuitCore({ chain });
  const evaluation = await core.evaluate("alpha-01", COMPLIANT);
  const authorization = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: COMPLIANT,
    portfolioStateHash: chain.state.portfolioStateHash,
    mandateVersion: 7,
    evaluationHash: evaluation.evaluationHash,
  });
  chain.state.mandate.version = 8;
  chain.state.portfolioVersion = 8;
  const result = await core.executeAuthorizedAction({ portfolioId: "portfolio-alpha-01", authorizationHash: authorization.authorizationHash });
  assert.equal(result.ok, false);
  assert.equal(result.status, "STALE_MANDATE");
});

test("changed portfolio state fails", async () => {
  const chain = fakeChain({ executable: true });
  const core = createCircuitCore({ chain });
  const evaluation = await core.evaluate("alpha-01", COMPLIANT);
  const authorization = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: COMPLIANT,
    portfolioStateHash: chain.state.portfolioStateHash,
    mandateVersion: 7,
    evaluationHash: evaluation.evaluationHash,
  });
  chain.state.portfolioStateHash = "0x" + "99".repeat(32);
  const result = await core.executeAuthorizedAction({ portfolioId: "portfolio-alpha-01", authorizationHash: authorization.authorizationHash });
  assert.equal(result.ok, false);
  assert.equal(result.status, "STALE_STATE");
});

test("modified actions after authorization fail", async () => {
  const chain = fakeChain({ executable: true });
  const core = createCircuitCore({ chain });
  const evaluation = await core.evaluate("alpha-01", COMPLIANT);
  const signed = await chain.signAuthorization({
    portfolioId: "portfolio-alpha-01",
    mandateVersion: 7,
    portfolioStateHash: chain.state.portfolioStateHash,
    actionsHash: chain.actionsHashFor(chain.actionStructsFromActions(COMPLIANT)),
    evaluationHash: evaluation.evaluationHash,
  });
  const tampered = COMPLIANT.map((a, i) => i === 0 ? { ...a, notionalUsd: a.notionalUsd + 100 } : a);
  const result = await core.executeAuthorizedAction({
    portfolioId: "portfolio-alpha-01",
    authorizationHash: signed.authorizationHash,
    authorization: signed.authorization,
    actions: tampered,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "ACTION_MISMATCH");
});

test("replay fails", async () => {
  const chain = fakeChain({ executable: true });
  const core = createCircuitCore({ chain });
  const evaluation = await core.evaluate("alpha-01", COMPLIANT);
  const authorization = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: COMPLIANT,
    portfolioStateHash: chain.state.portfolioStateHash,
    mandateVersion: 7,
    evaluationHash: evaluation.evaluationHash,
  });
  const first = await core.executeAuthorizedAction({ portfolioId: "portfolio-alpha-01", authorizationHash: authorization.authorizationHash });
  assert.equal(first.ok, true);
  const second = await core.executeAuthorizedAction({ portfolioId: "portfolio-alpha-01", authorizationHash: authorization.authorizationHash });
  assert.equal(second.ok, false);
  assert.equal(second.status, "REPLAYED");
});

test("stale evaluation hash is rejected at authorization time", async () => {
  const chain = fakeChain();
  const core = createCircuitCore({ chain });
  const evaluation = await core.evaluate("alpha-01", COMPLIANT);
  const result = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: COMPLIANT,
    portfolioStateHash: chain.state.portfolioStateHash,
    mandateVersion: 7,
    evaluationHash: "0x" + "00".repeat(32),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "STALE_EVALUATION");
});
