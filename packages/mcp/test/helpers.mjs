import { ethers } from "ethers";
import { evaluatePlan } from "../../../dist/competition/mandate.js";
import { demoMandate, demoMarket } from "../../../dist/competition/demo.js";
import * as vault from "../../../integrations/vault.mjs";

export const FAKE_VAULT = "0x86d66F4F892bcd91850703f4Ed9F140d1652358A";

export function fakeStatus(overrides = {}) {
  return {
    ok: true,
    portfolioId: "portfolio-alpha-01",
    network: { name: "X Layer Testnet", chainId: 1952 },
    addresses: { vault: FAKE_VAULT, guard: "0x362F8a4ce4D7f3b3254bF8a432631F0A956320a4" },
    owner: "0x0000000000000000000000000000000000000Ace",
    paused: false,
    funded: true,
    seeded: true,
    mandate: {
      version: 7,
      enabled: true,
      exists: true,
      validUntil: 4102444800,
      mandateHash: "0x" + "77".repeat(32),
      navUsd: 10_000,
      maxAssetExposureBps: 4500,
      maxIssuerExposureBps: 3500,
      maxSectorExposureBps: 5000,
      maxInvestedBps: 9500,
      maxDailyTurnoverBps: 7000,
      maxSlippageBps: 100,
      maxReferenceFreshnessSeconds: 1800,
      closedMarketMaxBuyUsdE18: 1000n * 10n ** 18n,
      materialEventMaxBuyUsdE18: 500n * 10n ** 18n,
    },
    cashUsd: 6500,
    dailyTurnoverUsd: 500,
    investedUsd: 3500,
    positions: { tslax: 1500, googlx: 1500, mstrx: 500 },
    issuerExposures: { "Tesla, Inc.": 1500, "Alphabet Inc.": 1500, "Strategy Inc.": 500 },
    sectorExposures: { automotive: 1500, technology: 2000 },
    portfolioStateHash: "0x" + "ab".repeat(32),
    portfolioVersion: 7,
    execution: { note: "fake chain" },
    ...overrides,
  };
}

export function snapshotFromStatus(status) {
  return {
    id: status.portfolioId,
    mandateId: demoMandate.id,
    navUsd: status.mandate.navUsd,
    cashUsd: status.cashUsd,
    holdings: Object.entries(status.positions).map(([assetId, notionalUsd]) => ({ assetId, notionalUsd })).filter(h => h.notionalUsd > 0),
    dailyTurnoverUsd: status.dailyTurnoverUsd,
    asOf: new Date().toISOString(),
  };
}

export function fakeChain(initial = {}) {
  const state = fakeStatus(initial);
  const consumed = new Set();
  const executed = [];

  return {
    state,
    consumed,
    executed,

    async vaultStatus() {
      return { ok: true, ...structuredClone(state) };
    },

    async evaluateOnChainState(actions) {
      const plan = vault.planFromActions(actions);
      const decision = evaluatePlan(plan, snapshotFromStatus(state), demoMandate, demoMarket, new Date().toISOString());
      const actionStructs = vault.actionStructsFromActions(actions);
      const actionsHash = vault.actionsHashFor(actionStructs);
      const evaluationHash = vault.evaluationHashFor(state.portfolioId, state.mandate.mandateHash, state.mandate.version, state.portfolioStateHash, actionsHash);
      return { ok: true, status: structuredClone(state), plan, decision, actionsHash, evaluationHash };
    },

    actionStructsFromActions: vault.actionStructsFromActions,
    actionsHashFor: vault.actionsHashFor,
    evaluationHashFor: vault.evaluationHashFor,

    async signAuthorization({ portfolioId, mandateVersion, portfolioStateHash, actionsHash, evaluationHash, expirySeconds }) {
      const ttl = expirySeconds ?? state.expirySeconds ?? 300;
      const authorization = {
        portfolioId: ethers.id(portfolioId),
        mandateVersion: BigInt(mandateVersion),
        portfolioStateHash,
        actionsHash,
        evaluationHash,
        expiry: BigInt(Math.floor(Date.now() / 1000) + ttl),
        nonce: BigInt(Date.now()),
        signature: "0x" + "cd".repeat(65),
      };
      const authorizationHash = ethers.keccak256(ethers.toUtf8Bytes(`${portfolioId}:${mandateVersion}:${portfolioStateHash}:${actionsHash}:${evaluationHash}`));
      return { ok: true, authorizationHash, expiry: Number(authorization.expiry), nonce: Number(authorization.nonce), authorization };
    },

    async isAuthorizationConsumed(authorizationHash) {
      return { ok: true, consumed: consumed.has(authorizationHash) };
    },

    async simulateExecution(authWithSig, actionStructs) {
      if (!state.executable) {
        return { ok: false, status: "EXECUTION_UNSUPPORTED", detail: `Execution route unsupported for asset ${actionStructs[0].assetKey}. ${state.execution.note}`, note: state.execution.note };
      }
      return { ok: true };
    },

    async sendExecution(authWithSig, actionStructs) {
      consumed.add(ethers.keccak256(ethers.toUtf8Bytes(`${String(authWithSig.expiry)}:${String(authWithSig.nonce)}:${authWithSig.actionsHash}`)));
      executed.push({ authWithSig, actionStructs });
      const txHash = "0x" + "cd".repeat(32);
      return { ok: true, status: "EXECUTED", txHash, blockNumber: 123456 };
    },
  };
}
