import { stableHash } from "../core/hash.js";
import type {
  AgentPlan,
  ExposureSnapshot,
  MarketAsset,
  PlanDecision,
  PlanViolation,
  PortfolioMandate,
  PortfolioState,
} from "./types.js";

const EPS = 0.0001;
const pct = (usd: number, nav: number) => nav <= 0 ? Infinity : (usd / nav) * 100;

function add(map: Record<string, number>, key: string, delta: number): void {
  map[key] = Math.max(0, (map[key] ?? 0) + delta);
}

function clonePortfolio(portfolio: PortfolioState): PortfolioState {
  return { ...portfolio, holdings: portfolio.holdings.map(h => ({ ...h })) };
}

export function exposureSnapshot(portfolio: PortfolioState, market: MarketAsset[]): ExposureSnapshot {
  const byAsset = new Map(market.map(a => [a.assetId, a]));
  const assetUsd: Record<string, number> = {};
  const issuerUsd: Record<string, number> = {};
  const sectorUsd: Record<string, number> = {};
  let investedUsd = 0;

  for (const holding of portfolio.holdings) {
    if (holding.notionalUsd <= EPS) continue;
    const asset = byAsset.get(holding.assetId);
    assetUsd[holding.assetId] = holding.notionalUsd;
    investedUsd += holding.notionalUsd;
    if (asset) {
      add(issuerUsd, asset.issuerId, holding.notionalUsd);
      add(sectorUsd, asset.sectorId, holding.notionalUsd);
    }
  }

  return {
    investedUsd,
    cashUsd: portfolio.cashUsd,
    dailyTurnoverUsd: portfolio.dailyTurnoverUsd,
    assetUsd,
    issuerUsd,
    sectorUsd,
  };
}

function simulate(plan: AgentPlan, portfolio: PortfolioState, market: MarketAsset[], violations: PlanViolation[]): PortfolioState {
  const next = clonePortfolio(portfolio);
  const byAsset = new Map(market.map(a => [a.assetId, a]));
  const holdings = new Map(next.holdings.map(h => [h.assetId, h.notionalUsd]));

  for (const intent of plan.intents) {
    const asset = byAsset.get(intent.assetId);
    if (!asset) {
      violations.push({ code: "UNKNOWN_ASSET", assetId: intent.assetId, message: `${intent.symbol} is unknown to the active portfolio registry.`, actual: intent.assetId, limit: "registered asset" });
      continue;
    }
    if (intent.notionalUsd <= 0) continue;

    if (intent.side === "BUY") {
      if (intent.notionalUsd > next.cashUsd + EPS) {
        violations.push({ code: "INSUFFICIENT_CASH", assetId: intent.assetId, message: `Buying ${intent.symbol} for $${intent.notionalUsd.toFixed(0)} exceeds available cash.`, actual: intent.notionalUsd, limit: next.cashUsd });
      }
      holdings.set(intent.assetId, (holdings.get(intent.assetId) ?? 0) + intent.notionalUsd);
      next.cashUsd -= intent.notionalUsd;
    } else {
      const current = holdings.get(intent.assetId) ?? 0;
      if (intent.notionalUsd > current + EPS) {
        violations.push({ code: "INSUFFICIENT_POSITION", assetId: intent.assetId, message: `Selling $${intent.notionalUsd.toFixed(0)} of ${intent.symbol} exceeds the current position.`, actual: intent.notionalUsd, limit: current });
      }
      const effective = Math.min(intent.notionalUsd, current);
      holdings.set(intent.assetId, current - effective);
      next.cashUsd += effective;
    }
    next.dailyTurnoverUsd += intent.notionalUsd;
  }

  next.holdings = [...holdings.entries()].filter(([, value]) => value > EPS).map(([assetId, notionalUsd]) => ({ assetId, notionalUsd }));
  return next;
}

export function evaluatePlan(plan: AgentPlan, portfolio: PortfolioState, mandate: PortfolioMandate, market: MarketAsset[], checkedAt: string): PlanDecision {
  const violations: PlanViolation[] = [];
  const byAsset = new Map(market.map(a => [a.assetId, a]));

  for (const intent of plan.intents) {
    const asset = byAsset.get(intent.assetId);
    if (!asset) continue;
    if (!mandate.allowedAssetIds.includes(asset.assetId)) {
      violations.push({ code: "ASSET_NOT_ALLOWED", assetId: asset.assetId, message: `${asset.symbol} is outside this mandate's asset universe.`, actual: asset.assetId, limit: mandate.allowedAssetIds.join(",") });
    }
    if (!mandate.allowedAssetClasses.includes(asset.category)) {
      violations.push({ code: "ASSET_CLASS_NOT_ALLOWED", assetId: asset.assetId, message: `${asset.symbol} is not an allowed asset class.`, actual: asset.category, limit: mandate.allowedAssetClasses.join(",") });
    }
    if (intent.expectedSlippageBps > mandate.maxSlippageBps) {
      violations.push({ code: "SLIPPAGE_BUDGET_EXCEEDED", assetId: asset.assetId, message: `${asset.symbol} expected slippage ${intent.expectedSlippageBps} bps exceeds mandate maximum.`, actual: intent.expectedSlippageBps, limit: mandate.maxSlippageBps });
    }
    if (intent.side === "BUY" && asset.referenceFreshnessMinutes > mandate.maxReferenceFreshnessMinutes) {
      violations.push({ code: "REFERENCE_STALE", assetId: asset.assetId, message: `${asset.symbol} reference is ${asset.referenceFreshnessMinutes}m old; new exposure is forbidden above ${mandate.maxReferenceFreshnessMinutes}m.`, actual: asset.referenceFreshnessMinutes, limit: mandate.maxReferenceFreshnessMinutes });
    }
    if (intent.side === "BUY" && asset.marketSession === "closed" && intent.notionalUsd > mandate.closedMarketMaxBuyUsd) {
      violations.push({ code: "CLOSED_MARKET_BUY_LIMIT", assetId: asset.assetId, message: `${asset.symbol} primary reference market is closed; new exposure is capped at $${mandate.closedMarketMaxBuyUsd.toFixed(0)}.`, actual: intent.notionalUsd, limit: mandate.closedMarketMaxBuyUsd });
    }
    if (intent.side === "BUY" && asset.materialEvent && intent.notionalUsd > mandate.materialEventMaxBuyUsd) {
      violations.push({ code: "MATERIAL_EVENT_BUY_LIMIT", assetId: asset.assetId, message: `${asset.symbol} has an active material event; new exposure is capped at $${mandate.materialEventMaxBuyUsd.toFixed(0)}.`, actual: intent.notionalUsd, limit: mandate.materialEventMaxBuyUsd });
    }
  }

  const before = exposureSnapshot(portfolio, market);
  const afterState = simulate(plan, portfolio, market, violations);
  afterState.asOf = checkedAt;
  const after = exposureSnapshot(afterState, market);

  for (const [assetId, value] of Object.entries(after.assetUsd)) {
    const actual = pct(value, mandate.navUsd);
    if (actual > mandate.maxAssetExposurePctNav + EPS) {
      const symbol = byAsset.get(assetId)?.symbol ?? assetId;
      violations.push({ code: "ASSET_EXPOSURE_EXCEEDED", assetId, bucketId: assetId, assetSymbol: symbol, message: `${symbol} would become ${actual.toFixed(1)}% of NAV.`, actual, limit: mandate.maxAssetExposurePctNav, projectedExposureBps: Math.round(actual * 100), limitBps: Math.round(mandate.maxAssetExposurePctNav * 100) });
    }
  }
  for (const [issuerId, value] of Object.entries(after.issuerUsd)) {
    const actual = pct(value, mandate.navUsd);
    if (actual > mandate.maxIssuerExposurePctNav + EPS) {
      const asset = market.find(a => a.issuerId === issuerId);
      const issuerName = asset?.issuerName ?? issuerId;
      violations.push({ code: "ISSUER_CONCENTRATION_EXCEEDED", bucketId: issuerId, issuer: issuerName, message: `${issuerName} exposure would become ${actual.toFixed(1)}% of NAV.`, actual, limit: mandate.maxIssuerExposurePctNav, projectedExposureBps: Math.round(actual * 100), limitBps: Math.round(mandate.maxIssuerExposurePctNav * 100) });
    }
  }
  for (const [sectorId, value] of Object.entries(after.sectorUsd)) {
    const actual = pct(value, mandate.navUsd);
    if (actual > mandate.maxSectorExposurePctNav + EPS) {
      const asset = market.find(a => a.sectorId === sectorId);
      const sectorName = asset?.sectorName ?? sectorId;
      violations.push({ code: "SECTOR_CONCENTRATION_EXCEEDED", bucketId: sectorId, sector: sectorName, message: `${sectorName} exposure would become ${actual.toFixed(1)}% of NAV.`, actual, limit: mandate.maxSectorExposurePctNav, projectedExposureBps: Math.round(actual * 100), limitBps: Math.round(mandate.maxSectorExposurePctNav * 100) });
    }
  }

  const investedPct = pct(after.investedUsd, mandate.navUsd);
  if (investedPct > mandate.maxInvestedPctNav + EPS) {
    violations.push({ code: "INVESTED_LIMIT_EXCEEDED", message: `Invested capital would become ${investedPct.toFixed(1)}% of NAV.`, actual: investedPct, limit: mandate.maxInvestedPctNav });
  }
  const turnoverPct = pct(after.dailyTurnoverUsd, mandate.navUsd);
  if (turnoverPct > mandate.maxDailyTurnoverPctNav + EPS) {
    violations.push({ code: "DAILY_TURNOVER_EXCEEDED", message: `Daily turnover would become ${turnoverPct.toFixed(1)}% of NAV.`, actual: turnoverPct, limit: mandate.maxDailyTurnoverPctNav });
  }

  const unique = [...new Map(violations.map(v => [`${v.code}:${v.assetId ?? ""}:${v.bucketId ?? ""}`, v])).values()];
  return {
    allowed: unique.length === 0,
    verdict: unique.length === 0 ? "AUTHORIZED" : "BLOCKED",
    violations: unique,
    checkedAt,
    planHash: stableHash(plan),
    mandateHash: stableHash(mandate),
    beforePortfolioHash: stableHash(portfolio),
    afterPortfolioHash: stableHash(afterState),
    before,
    after,
    afterState,
  };
}

export function feedbackForAgent(decision: PlanDecision): PlanViolation[] {
  return decision.violations;
}

export function feedbackLines(decision: PlanDecision): string[] {
  return decision.violations.map(v => `${v.code}${v.assetId ? `:${v.assetId}` : ""}${v.bucketId ? `:${v.bucketId}` : ""} — ${v.message} Actual=${v.actual}; Limit=${v.limit}`);
}
