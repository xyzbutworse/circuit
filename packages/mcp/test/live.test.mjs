import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createCircuitCore } from "../src/core.mjs";
import { evaluatePlan } from "../../../dist/competition/mandate.js";
import { demoMandate, demoMarket } from "../../../dist/competition/demo.js";
import * as vault from "../../../integrations/vault.mjs";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
const hasKey = Boolean(process.env.CIRCUIT_PUBLISHER_KEY || process.env.CIRCUIT_PUBLISHER_KEY_FILE);
try { if (!hasKey) process.loadEnvFile(rootEnv); } catch {}

const keyPresent = Boolean(process.env.CIRCUIT_PUBLISHER_KEY || process.env.CIRCUIT_PUBLISHER_KEY_FILE);
const BLOCKED = [{ asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 2500, expectedSlippageBps: 42 }];
const COMPLIANT = [
  { asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 39 },
  { asset: "GOOGLx", assetId: "googlx", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 30 },
  { asset: "MSTRx", assetId: "mstrx", side: "BUY", notionalUsd: 1500, expectedSlippageBps: 44 },
];

test("live: evaluate matches the web/API engine exactly (same Circuit engine)", { skip: !keyPresent }, async () => {
  const core = createCircuitCore();
  const mcpResult = await core.evaluate("alpha-01", BLOCKED);
  assert.equal(mcpResult.ok, true);
  const status = await vault.vaultStatus();
  assert.equal(status.ok, true);
  const plan = vault.planFromActions(BLOCKED);
  const engineDecision = evaluatePlan(plan, vault.portfolioSnapshotFromStatus(status), demoMandate, demoMarket, new Date().toISOString());
  assert.equal(mcpResult.decision, engineDecision.allowed ? "COMPLIANT" : "BLOCKED");
  assert.deepEqual(mcpResult.violations.map(v => v.code), engineDecision.violations.map(v => v.code));
  assert.deepEqual(mcpResult.violations.map(v => v.projectedBps ?? null), engineDecision.violations.map(v => v.projectedExposureBps ?? null));
  assert.equal(mcpResult.currentStateHash, status.portfolioStateHash);
});

test("live: authorization + execution reaches the same Circuit vault", { skip: !keyPresent }, async () => {
  const core = createCircuitCore();
  const evaluation = await core.evaluate("alpha-01", COMPLIANT);
  assert.equal(evaluation.decision, "COMPLIANT");
  const status = await vault.vaultStatus();
  const authorization = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: COMPLIANT,
    portfolioStateHash: status.portfolioStateHash,
    mandateVersion: status.mandate.version,
    evaluationHash: evaluation.evaluationHash,
  });
  assert.equal(authorization.ok, true, JSON.stringify(authorization));
  const execution = await core.executeAuthorizedAction({ portfolioId: "portfolio-alpha-01", authorizationHash: authorization.authorizationHash });
  // The real vault is reached either way. On X Layer Testnet the OKX DEX has no
  // pair (single-token chain), so the vault reverts UnsupportedRoute — capital
  // never moves and no success is faked.
  assert.ok(execution.status === "EXECUTED" || execution.status === "EXECUTION_UNSUPPORTED", JSON.stringify(execution));
  if (execution.status === "EXECUTED") {
    assert.match(execution.txHash, /^0x[0-9a-f]{64}$/);
    assert.equal(execution.receipt.vault, status.addresses.vault);
  } else {
    assert.match(execution.detail, /Execution route unsupported|Vault refused execution/);
  }
});

test("live: blocked action can neither be authorized nor executed", { skip: !keyPresent }, async () => {
  const core = createCircuitCore();
  const status = await vault.vaultStatus();
  const evaluation = await core.evaluate("alpha-01", BLOCKED);
  assert.equal(evaluation.decision, "BLOCKED");
  const authorization = await core.requestAuthorization({
    portfolioId: "portfolio-alpha-01",
    actions: BLOCKED,
    portfolioStateHash: status.portfolioStateHash,
    mandateVersion: status.mandate.version,
    evaluationHash: evaluation.evaluationHash,
  });
  assert.equal(authorization.ok, false);
  assert.equal(authorization.status, "BLOCKED");
});

test("live: portfolio and mandate tools read real onchain state", { skip: !keyPresent }, async () => {
  const core = createCircuitCore();
  const meta = await vault.vaultMetadata();
  const portfolio = await core.getPortfolio("alpha-01");
  assert.equal(portfolio.ok, true);
  assert.equal(portfolio.vault, meta.contracts.vault);
  assert.match(portfolio.portfolioStateHash, /^0x[0-9a-f]{64}$/);
  assert.equal(portfolio.positions.tslax, 1500);
  const mandate = await core.getMandate("alpha-01");
  assert.equal(mandate.ok, true);
  assert.equal(mandate.mandateVersion, 1);
  assert.equal(mandate.issuerLimits.maxIssuerExposureBps, 3500);
});
