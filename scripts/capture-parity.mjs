import { ethers } from "ethers";
import * as vault from "../integrations/vault.mjs";
import { createCircuitCore } from "../packages/mcp/src/core.mjs";
import { demoMandate, demoMarket } from "../dist/competition/demo.js";

const actions = [
  { asset: "TSLAx", assetId: "tslax", side: "BUY", notionalUsd: 2500, expectedSlippageBps: 42 },
];

const core = createCircuitCore();
const portfolio = await core.getPortfolio("alpha-01");
const mandate = await core.getMandate("alpha-01");

const evalResult = await vault.evaluateOnChainState(actions);
const actionStructs = vault.actionStructsFromActions(actions);
const actionsHash = vault.actionsHashFor(actionStructs);
const evaluationHash = evalResult.evaluationHash;

const restResponse = await fetch("http://127.0.0.1:4184/api/circuit/check", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    plan: vault.planFromActions(actions),
    portfolio: vault.portfolioSnapshotFromStatus(await vault.vaultStatus()),
    mandate: demoMandate,
    market: demoMarket,
  }),
});
const rest = await restResponse.json();

const parity = {
  capturedAt: new Date().toISOString(),
  inputs: {
    portfolioId: portfolio.portfolioId,
    portfolioStateHash: portfolio.portfolioStateHash,
    mandateVersion: mandate.mandateVersion,
    mandateHash: mandate.mandateHash,
    actions,
    actionsHash,
  },
  surfaces: {
    "web-rest": {
      decision: rest.decision.allowed ? "COMPLIANT" : "BLOCKED",
      violations: rest.violations.map(v => ({ code: v.code, projectedBps: v.projectedExposureBps ?? null, maximumBps: v.limitBps ?? null })),
      evaluationHash: evaluationHash,
    },
    mcp: {
      decision: evalResult.decision.allowed ? "COMPLIANT" : "BLOCKED",
      violations: evalResult.decision.violations.map(v => ({ code: v.code, projectedBps: v.projectedExposureBps ?? null, maximumBps: v.limitBps ?? null })),
      evaluationHash,
    },
    engine: {
      decision: evalResult.decision.allowed ? "COMPLIANT" : "BLOCKED",
      violations: evalResult.decision.violations.map(v => ({ code: v.code, projectedBps: v.projectedExposureBps ?? null, maximumBps: v.limitBps ?? null })),
      evaluationHash: vault.evaluationHashFor(portfolio.portfolioId, mandate.mandateHash, mandate.mandateVersion, portfolio.portfolioStateHash, actionsHash),
    },
  },
};

const decisions = new Set(Object.values(parity.surfaces).map(s => s.decision));
const violations = new Set(Object.values(parity.surfaces).map(s => JSON.stringify(s.violations)));
const hashes = new Set(Object.values(parity.surfaces).map(s => s.evaluationHash));
parity.parityHolds = decisions.size === 1 && violations.size === 1 && hashes.size === 1;

console.log(JSON.stringify({
  portfolioStateHash: parity.inputs.portfolioStateHash.slice(0, 14) + "…",
  mandateVersion: parity.inputs.mandateVersion,
  decision: [...decisions][0],
  violations: JSON.parse([...violations][0])[0],
  evaluationHash: [...hashes][0].slice(0, 14) + "…",
  parityHolds: parity.parityHolds,
  note: "Same portfolioStateHash + mandateVersion + actions across Web REST / MCP (Codex & Claude share this server) / engine produce the same decision, violations and evaluationHash.",
}, null, 2));

const { writeFile } = await import("node:fs/promises");
await writeFile(new URL("../deployments/parity-proof.json", import.meta.url), JSON.stringify(parity, null, 2) + "\n");
if (!parity.parityHolds) process.exit(1);
