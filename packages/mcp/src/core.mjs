import { stableHash } from "../../../dist/core/hash.js";
import * as liveChain from "../../../integrations/vault.mjs";

const DEFAULT_PORTFOLIO = "alpha-01";

export function mapPortfolioId(portfolioId) {
  const id = String(portfolioId ?? DEFAULT_PORTFOLIO);
  return id === "alpha-01" ? "portfolio-alpha-01" : id;
}

export function createCircuitCore(options = {}) {
  const chain = options.chain ?? liveChain;
  const authorizations = new Map();
  const receipts = new Map();

  async function refresh() {
    const status = await chain.vaultStatus();
    if (!status.ok) return { ok: false, status: status.status, detail: status.detail };
    return { ok: true, status };
  }

  function violationShape(v) {
    return {
      code: v.code,
      ...(v.issuer ? { issuer: v.issuer } : {}),
      ...(v.sector ? { sector: v.sector } : {}),
      ...(v.assetSymbol ? { asset: v.assetSymbol } : {}),
      ...(typeof v.projectedExposureBps === "number" ? { projectedBps: v.projectedExposureBps } : {}),
      ...(typeof v.limitBps === "number" ? { maximumBps: v.limitBps } : {}),
      message: v.message,
      actual: v.actual,
      limit: v.limit,
    };
  }

  async function getPortfolio(portfolioId) {
    const r = await refresh();
    if (!r.ok) return r;
    const s = r.status;
    return {
      ok: true,
      portfolioId: s.portfolioId,
      owner: s.owner,
      vault: s.addresses.vault,
      guard: s.addresses.guard,
      network: s.network.name,
      chainId: s.network.chainId,
      paused: s.paused,
      funded: s.funded,
      nav: s.mandate.navUsd,
      cash: s.cashUsd,
      positions: s.positions,
      issuerExposures: s.issuerExposures,
      sectorExposures: s.sectorExposures,
      dailyTurnover: s.dailyTurnoverUsd,
      portfolioStateHash: s.portfolioStateHash,
      portfolioVersion: s.portfolioVersion,
    };
  }

  async function getMandate(portfolioId) {
    const r = await refresh();
    if (!r.ok) return r;
    const s = r.status;
    const m = s.mandate;
    return {
      ok: true,
      mandateId: s.portfolioId,
      mandateVersion: m.version,
      enabled: m.enabled,
      validUntil: m.validUntil,
      mandateHash: m.mandateHash,
      nav: m.navUsd,
      allowedAssets: Object.entries(s.positions ?? {}).map(([assetId, notional]) => ({ assetId, symbol: assetId.toUpperCase(), positionUsd: notional })),
      issuerLimits: { maxIssuerExposureBps: m.maxIssuerExposureBps, maxAssetExposureBps: m.maxAssetExposureBps },
      sectorLimits: { maxSectorExposureBps: m.maxSectorExposureBps },
      turnoverRules: { maxDailyTurnoverBps: m.maxDailyTurnoverBps, dailyTurnoverUsd: s.dailyTurnoverUsd },
      marketRestrictions: {
        maxSlippageBps: m.maxSlippageBps,
        maxReferenceFreshnessSeconds: m.maxReferenceFreshnessSeconds,
        closedMarketMaxBuyUsdE18: m.closedMarketMaxBuyUsdE18.toString(),
        materialEventMaxBuyUsdE18: m.materialEventMaxBuyUsdE18.toString(),
      },
    };
  }

  async function evaluate(portfolioId, actions) {
    const evalResult = await chain.evaluateOnChainState(actions);
    if (!evalResult.ok) return evalResult;
    const d = evalResult.decision;
    return {
      ok: true,
      decision: d.allowed ? "COMPLIANT" : "BLOCKED",
      verdict: d.verdict,
      portfolioId: evalResult.status.portfolioId,
      currentStateHash: evalResult.status.portfolioStateHash,
      projectedStateHash: stableHash(d.afterState),
      mandateHash: evalResult.status.mandate.mandateHash,
      mandateVersion: evalResult.status.mandate.version,
      evaluationHash: evalResult.evaluationHash,
      projectedState: {
        cashUsd: d.after.cashUsd,
        investedUsd: d.after.investedUsd,
        dailyTurnoverUsd: d.after.dailyTurnoverUsd,
        assetUsd: d.after.assetUsd,
        issuerUsd: d.after.issuerUsd,
        sectorUsd: d.after.sectorUsd,
      },
      violations: d.violations.map(violationShape),
    };
  }

  async function project(portfolioId, actions) {
    const evalResult = await chain.evaluateOnChainState(actions);
    if (!evalResult.ok) return evalResult;
    const d = evalResult.decision;
    return {
      ok: true,
      portfolioId: evalResult.status.portfolioId,
      projectedPortfolio: {
        cashUsd: d.after.cashUsd,
        investedUsd: d.after.investedUsd,
        dailyTurnoverUsd: d.after.dailyTurnoverUsd,
        positions: d.after.assetUsd,
        issuerExposures: d.after.issuerUsd,
        sectorExposures: d.after.sectorUsd,
      },
      projectedStateHash: stableHash(d.afterState),
      currentStateHash: evalResult.status.portfolioStateHash,
    };
  }

  async function explain(portfolioId, violation) {
    const r = await refresh();
    if (!r.ok) return r;
    const s = r.status;
    const v = violation ?? {};
    const code = v.code;
    const m = s.mandate;
    const issuerUsd = s.issuerExposures ?? {};
    const sectorUsd = s.sectorExposures ?? {};
    const nav = m.navUsd;

    if (code === "ISSUER_CONCENTRATION_EXCEEDED") {
      const issuer = v.issuer ?? "the issuer";
      const current = issuerUsd[issuer] ?? 0;
      const maximumBps = v.limitBps ?? m.maxIssuerExposureBps;
      const maximumUsd = (maximumBps / 10_000) * nav;
      const maximumAdditional = Math.max(0, maximumUsd - current);
      return {
        ok: true,
        code,
        message: v.message ?? `Proposed action would raise ${issuer} exposure above the mandate maximum of ${maximumBps / 100}%.`,
        violatedRule: "issuer concentration / NAV",
        currentValueUsd: current,
        projectedValueUsd: ((v.projectedBps ?? 0) / 10_000) * nav,
        maximumPermittedUsd: maximumUsd,
        repairConstraints: { maximumAdditionalIssuerExposureUsd: maximumAdditional, issuer, maximumBps },
      };
    }
    if (code === "SECTOR_CONCENTRATION_EXCEEDED") {
      const sector = v.sector ?? "the sector";
      const current = sectorUsd[sector] ?? 0;
      const maximumBps = v.limitBps ?? m.maxSectorExposureBps;
      const maximumUsd = (maximumBps / 10_000) * nav;
      return {
        ok: true,
        code,
        message: v.message ?? `Proposed action would raise ${sector} sector exposure above the mandate maximum of ${maximumBps / 100}%.`,
        violatedRule: "sector concentration / NAV",
        currentValueUsd: current,
        projectedValueUsd: ((v.projectedBps ?? 0) / 10_000) * nav,
        maximumPermittedUsd: maximumUsd,
        repairConstraints: { maximumAdditionalSectorExposureUsd: Math.max(0, maximumUsd - current), sector, maximumBps },
      };
    }
    if (code === "ASSET_EXPOSURE_EXCEEDED") {
      const maximumBps = v.limitBps ?? m.maxAssetExposureBps;
      const maximumUsd = (maximumBps / 10_000) * nav;
      return {
        ok: true,
        code,
        message: v.message ?? `Proposed action would raise asset exposure above the mandate maximum of ${maximumBps / 100}%.`,
        violatedRule: "asset exposure / NAV",
        projectedValueUsd: ((v.projectedBps ?? 0) / 10_000) * nav,
        maximumPermittedUsd: maximumUsd,
        repairConstraints: { maximumBps, asset: v.asset ?? v.assetId },
      };
    }
    return {
      ok: true,
      code: code ?? "UNKNOWN_VIOLATION",
      message: v.message ?? "No repair constraints available for this violation.",
      violatedRule: code ?? "unknown",
      repairConstraints: {},
    };
  }

  async function requestAuthorization({ portfolioId, actions, portfolioStateHash, mandateVersion, evaluationHash }) {
    const r = await refresh();
    if (!r.ok) return r;
    const s = r.status;
    if (s.portfolioStateHash !== portfolioStateHash) {
      return { ok: false, status: "STALE_STATE", detail: `portfolioStateHash does not match current onchain state (expected ${portfolioStateHash}, current ${s.portfolioStateHash}).` };
    }
    if (s.mandate.version !== mandateVersion) {
      return { ok: false, status: "STALE_MANDATE", detail: `mandateVersion does not match (expected ${mandateVersion}, current ${s.mandate.version}).` };
    }
    const evalResult = await chain.evaluateOnChainState(actions);
    if (!evalResult.ok) return evalResult;
    if (!evalResult.decision.allowed) {
      return { ok: false, status: "BLOCKED", decision: "BLOCKED", violations: evalResult.decision.violations.map(violationShape) };
    }
    if (evalResult.evaluationHash !== evaluationHash) {
      return { ok: false, status: "STALE_EVALUATION", detail: `evaluationHash does not match a fresh evaluation of these actions (expected ${evaluationHash}, current ${evalResult.evaluationHash}).` };
    }
    const signed = await chain.signAuthorization({
      portfolioId: s.portfolioId,
      mandateVersion: s.mandate.version,
      portfolioStateHash: s.portfolioStateHash,
      actionsHash: evalResult.actionsHash,
      evaluationHash: evalResult.evaluationHash,
    });
    if (!signed.ok) return signed;
    authorizations.set(signed.authorizationHash, {
      authorizationHash: signed.authorizationHash,
      expiry: signed.expiry,
      authorization: signed.authorization,
      actions,
      actionStructs: chain.actionStructsFromActions(actions),
      actionsHash: evalResult.actionsHash,
      evaluationHash: evalResult.evaluationHash,
      portfolioId: s.portfolioId,
      mandateVersion: s.mandate.version,
      portfolioStateHash: s.portfolioStateHash,
      createdAt: Date.now(),
      consumed: false,
    });
    return {
      ok: true,
      status: "AUTHORIZED",
      authorizationHash: signed.authorizationHash,
      expiry: signed.expiry,
      mandateVersion: s.mandate.version,
      evaluationHash: evalResult.evaluationHash,
    };
  }

  async function executeAuthorizedAction({ portfolioId, authorizationHash, authorization, actions }) {
    let record = authorizations.get(authorizationHash);
    if (!record && authorization && actions) {
      record = {
        authorizationHash,
        expiry: Number(authorization.expiry),
        authorization,
        actions,
        actionStructs: chain.actionStructsFromActions(actions),
        actionsHash: authorization.actionsHash,
        evaluationHash: authorization.evaluationHash,
        portfolioId,
        mandateVersion: Number(authorization.mandateVersion),
        portfolioStateHash: authorization.portfolioStateHash,
        createdAt: Date.now(),
        consumed: false,
      };
    }
    if (!record) return { ok: false, status: "NOT_FOUND", detail: `No authorization exists for ${authorizationHash}.` };
    if (record.consumed) return { ok: false, status: "REPLAYED", detail: "Authorization was already consumed." };
    if (Date.now() / 1000 >= record.expiry) return { ok: false, status: "EXPIRED", detail: "Authorization expired." };

    const consumedCheck = await chain.isAuthorizationConsumed(authorizationHash);
    if (!consumedCheck.ok) return { ok: false, status: "ONCHAIN_UNAVAILABLE", detail: consumedCheck.detail };
    if (consumedCheck.consumed) return { ok: false, status: "REPLAYED", detail: "Authorization was already consumed onchain." };

    const r = await refresh();
    if (!r.ok) return { ok: false, status: "ONCHAIN_UNAVAILABLE", detail: "X Layer state is unavailable; failing closed." };
    const s = r.status;
    if (s.paused) return { ok: false, status: "PAUSED", detail: "Vault is paused." };
    if (s.mandate.version !== record.mandateVersion) return { ok: false, status: "STALE_MANDATE", detail: "Mandate version changed since authorization." };
    if (s.portfolioStateHash !== record.portfolioStateHash) return { ok: false, status: "STALE_STATE", detail: "Portfolio state changed since authorization." };
    if (chain.actionsHashFor(record.actionStructs) !== record.actionsHash) return { ok: false, status: "ACTION_MISMATCH", detail: "Actions do not match the authorization." };

    const simulated = await chain.simulateExecution(record.authorization, record.actionStructs);
    if (!simulated.ok) return { ok: false, status: simulated.status, detail: simulated.detail, note: simulated.note };
    const sent = await chain.sendExecution(record.authorization, record.actionStructs);
    if (!sent.ok) return { ok: false, status: sent.status, detail: sent.detail, txHash: sent.txHash };

    record.consumed = true;
    const refreshed = await refresh();
    const receipt = {
      id: `circuit-mcp-receipt:${authorizationHash.slice(0, 18)}`,
      portfolioId: s.portfolioId,
      owner: s.owner,
      vault: s.addresses.vault,
      mandateHash: s.mandate.mandateHash,
      mandateVersion: s.mandate.version,
      preStateHash: record.portfolioStateHash,
      planHash: record.actionsHash,
      evaluationHash: record.evaluationHash,
      authorizationHash,
      txHash: sent.txHash,
      blockNumber: sent.blockNumber,
      postStateHash: refreshed.ok ? refreshed.status.portfolioStateHash : null,
      timestamp: new Date().toISOString(),
    };
    receipt.receiptHash = stableHash(receipt);
    receipts.set(receipt.id, receipt);
    receipts.set(authorizationHash, receipt);
    return { ok: true, status: "EXECUTED", txHash: sent.txHash, blockNumber: sent.blockNumber, receipt };
  }

  async function getReceipt(receiptId) {
    const receipt = receipts.get(receiptId);
    if (!receipt) return { ok: false, status: "NOT_FOUND", detail: `No receipt for ${receiptId}.` };
    return { ok: true, receipt };
  }

  return {
    getPortfolio,
    getMandate,
    project,
    evaluate,
    explain,
    requestAuthorization,
    executeAuthorizedAction,
    getReceipt,
    authorizations,
    receipts,
  };
}
