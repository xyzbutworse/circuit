import type { RwaRuleId } from "./types.js";

import type { ProposedAllocation, RwaAssetState, RwaMandate, RwaPortfolioState } from "./types.js";

export interface RuleViolation {
  ruleId: RwaRuleId;
  reasonCode: string;
  message: string;
  observed: Record<string, unknown>;
}

export interface EvaluationResult {
  decision: "ALLOW" | "BLOCK";
  ruleEvaluations: Array<{ ruleId: RwaRuleId; passed: boolean; observed: Record<string, unknown> }>;
  violations: RuleViolation[];
  reasonCodes: string[];
  observed: Record<string, unknown>;
  projected: ProjectedAllocationState;
}

export interface ProjectedAllocationState {
  postTradeDebtorExposurePct: number;
  postTradeIssuerExposurePct: number;
  postTradeSectorExposurePct: number;
  postTradeJurisdictionExposurePct: number;
  postTradePortfolioExposurePct: number;
  allocationUsd: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const EPS = 1e-9;

export function portfolioExposurePct(portfolio: RwaPortfolioState): number {
  return portfolio.navUsd > 0 ? (portfolio.totalInvestedUsd / portfolio.navUsd) * 100 : 0;
}

/**
 * Deterministic mandate evaluation with post-trade portfolio simulation.
 * evaluate(assetState, portfolioState, mandate, proposedAllocation)
 */
export function evaluateAllocation(
  asset: RwaAssetState,
  portfolio: RwaPortfolioState,
  mandate: RwaMandate,
  allocation: ProposedAllocation
): EvaluationResult {
  const nav = portfolio.navUsd;
  const rules = mandate.rules;
  const currentDebtor = portfolio.debtors[asset.debtor] ?? 0;
  const currentIssuer = portfolio.issuers[asset.issuer] ?? 0;
  const currentSector = portfolio.sectors[asset.sector] ?? 0;
  const currentJurisdiction = portfolio.jurisdictions[asset.jurisdiction] ?? 0;

  const precise = {
    postTradeDebtorExposurePct: ((currentDebtor + allocation.amountUsd) / nav) * 100,
    postTradeIssuerExposurePct: ((currentIssuer + allocation.amountUsd) / nav) * 100,
    postTradeSectorExposurePct: ((currentSector + allocation.amountUsd) / nav) * 100,
    postTradeJurisdictionExposurePct: ((currentJurisdiction + allocation.amountUsd) / nav) * 100,
    postTradePortfolioExposurePct: ((portfolio.totalInvestedUsd + allocation.amountUsd) / nav) * 100,
  };
  const projected = {
    postTradeDebtorExposurePct: round1(precise.postTradeDebtorExposurePct),
    postTradeIssuerExposurePct: round1(precise.postTradeIssuerExposurePct),
    postTradeSectorExposurePct: round1(precise.postTradeSectorExposurePct),
    postTradeJurisdictionExposurePct: round1(precise.postTradeJurisdictionExposurePct),
    postTradePortfolioExposurePct: round1(precise.postTradePortfolioExposurePct),
    allocationUsd: allocation.amountUsd,
  };

  const ageHours = asset.evidenceTimestamp
    ? Math.max(0, (Date.now() - new Date(asset.evidenceTimestamp).getTime()) / 3_600_000)
    : Number.POSITIVE_INFINITY;

  const checks: Array<{ ruleId: RwaRuleId; passed: boolean; observed: Record<string, unknown>; reasonCode: string; message: string }> = [];

  checks.push({
    ruleId: "verifiedEvidence",
    passed: Boolean(rules.requireVerifiedEvidence) ? Boolean(asset.verified) : true,
    observed: { verified: Boolean(asset.verified) },
    reasonCode: "ASSET_NOT_VERIFIED",
    message: "Asset is not verified.",
  });

  checks.push({
    ruleId: "rejectDisputed",
    passed: rules.rejectDisputed === true ? !asset.disputed : true,
    observed: { disputed: Boolean(asset.disputed) },
    reasonCode: "ASSET_DISPUTED",
    message: "Asset has a dispute flag.",
  });

  checks.push({
    ruleId: "rejectEncumbered",
    passed: rules.rejectEncumbered === true ? !asset.encumbered : true,
    observed: { encumbered: Boolean(asset.encumbered) },
    reasonCode: "ASSET_ENCUMBERED",
    message: "Asset is already encumbered.",
  });

  checks.push({
    ruleId: "excludedJurisdictions",
    passed: !(rules.excludedJurisdictions ?? []).includes(asset.jurisdiction),
    observed: { jurisdiction: asset.jurisdiction },
    reasonCode: "JURISDICTION_EXCLUDED",
    message: `Jurisdiction ${asset.jurisdiction} is excluded.`,
  });

  checks.push({
    ruleId: "excludedAssetStates",
    passed: !(rules.excludedAssetStates ?? []).some(s => (asset as unknown as Record<string, boolean>)[s] === true),
    observed: { excludedAssetStates: rules.excludedAssetStates ?? [] },
    reasonCode: "ASSET_STATE_EXCLUDED",
    message: "Asset state is excluded by the mandate.",
  });

  checks.push({
    ruleId: "maxSingleAllocation",
    passed: rules.maxSingleAllocationUsd === undefined || allocation.amountUsd <= rules.maxSingleAllocationUsd,
    observed: { amountUsd: allocation.amountUsd, maxUsd: rules.maxSingleAllocationUsd ?? null },
    reasonCode: "ALLOCATION_SIZE_LIMIT",
    message: `Allocation exceeds the maximum single allocation of $${rules.maxSingleAllocationUsd}.`,
  });

  checks.push({
    ruleId: "minYield",
    passed: rules.minYieldPct === undefined || asset.yieldPct >= rules.minYieldPct,
    observed: { yieldPct: asset.yieldPct, minYieldPct: rules.minYieldPct ?? null },
    reasonCode: "YIELD_BELOW_MINIMUM",
    message: `Yield ${asset.yieldPct}% is below the minimum ${rules.minYieldPct}%.`,
  });

  checks.push({
    ruleId: "maxMaturity",
    passed: rules.maxMaturityDays === undefined || asset.maturityDays <= rules.maxMaturityDays,
    observed: { maturityDays: asset.maturityDays, maxMaturityDays: rules.maxMaturityDays ?? null },
    reasonCode: "MATURITY_EXCEEDED",
    message: `Maturity ${asset.maturityDays}d exceeds the maximum ${rules.maxMaturityDays}d.`,
  });

  checks.push({
    ruleId: "minLiquidity",
    passed: rules.minLiquidityScore === undefined || asset.liquidityScore >= rules.minLiquidityScore,
    observed: { liquidityScore: asset.liquidityScore, minLiquidityScore: rules.minLiquidityScore ?? null },
    reasonCode: "LIQUIDITY_BELOW_THRESHOLD",
    message: `Liquidity score ${asset.liquidityScore} is below the minimum ${rules.minLiquidityScore}.`,
  });

  checks.push({
    ruleId: "maxRisk",
    passed: rules.maxRiskScore === undefined || asset.riskScore <= rules.maxRiskScore,
    observed: { riskScore: asset.riskScore, maxRiskScore: rules.maxRiskScore ?? null },
    reasonCode: "RISK_ABOVE_THRESHOLD",
    message: `Risk score ${asset.riskScore} exceeds the maximum ${rules.maxRiskScore}.`,
  });

  checks.push({
    ruleId: "maxEvidenceAge",
    passed: rules.maxEvidenceAgeHours === undefined || ageHours <= rules.maxEvidenceAgeHours,
    observed: { evidenceAgeHours: round2(ageHours), maxEvidenceAgeHours: rules.maxEvidenceAgeHours ?? null },
    reasonCode: "EVIDENCE_STALE",
    message: `Evidence is ${round2(ageHours)}h old; maximum is ${rules.maxEvidenceAgeHours}h.`,
  });

  checks.push({
    ruleId: "minCollateralization",
    passed: rules.minCollateralizationRatio === undefined || (asset.collateralizationRatio ?? 0) >= rules.minCollateralizationRatio,
    observed: { collateralizationRatio: asset.collateralizationRatio ?? null, minCollateralizationRatio: rules.minCollateralizationRatio ?? null },
    reasonCode: "COLLATERALIZATION_BELOW_MINIMUM",
    message: `Collateralization ratio is below the minimum ${rules.minCollateralizationRatio}.`,
  });

  checks.push({
    ruleId: "maxDebtorConcentration",
    passed: precise.postTradeDebtorExposurePct <= (rules.maxDebtorConcentrationPct ?? 100) + EPS,
    observed: {
      currentDebtorExposurePct: round2((currentDebtor / nav) * 100),
      postTradeDebtorExposurePct: projected.postTradeDebtorExposurePct,
      mandateMaxPct: rules.maxDebtorConcentrationPct ?? 100,
    },
    reasonCode: "DEBTOR_CONCENTRATION_LIMIT",
    message: `Post-trade debtor concentration ${projected.postTradeDebtorExposurePct}% exceeds the maximum ${rules.maxDebtorConcentrationPct}%.`,
  });

  checks.push({
    ruleId: "maxIssuerConcentration",
    passed: precise.postTradeIssuerExposurePct <= (rules.maxIssuerConcentrationPct ?? 100) + EPS,
    observed: {
      postTradeIssuerExposurePct: projected.postTradeIssuerExposurePct,
      mandateMaxPct: rules.maxIssuerConcentrationPct ?? 100,
    },
    reasonCode: "ISSUER_CONCENTRATION_LIMIT",
    message: `Post-trade issuer concentration ${projected.postTradeIssuerExposurePct}% exceeds the maximum ${rules.maxIssuerConcentrationPct}%.`,
  });

  checks.push({
    ruleId: "maxSectorConcentration",
    passed: precise.postTradeSectorExposurePct <= (rules.maxSectorConcentrationPct ?? 100) + EPS,
    observed: {
      postTradeSectorExposurePct: projected.postTradeSectorExposurePct,
      mandateMaxPct: rules.maxSectorConcentrationPct ?? 100,
    },
    reasonCode: "SECTOR_CONCENTRATION_LIMIT",
    message: `Post-trade sector concentration ${projected.postTradeSectorExposurePct}% exceeds the maximum ${rules.maxSectorConcentrationPct}%.`,
  });

  checks.push({
    ruleId: "maxJurisdictionExposure",
    passed: precise.postTradeJurisdictionExposurePct <= (rules.maxJurisdictionExposurePct ?? 100) + EPS,
    observed: {
      postTradeJurisdictionExposurePct: projected.postTradeJurisdictionExposurePct,
      mandateMaxPct: rules.maxJurisdictionExposurePct ?? 100,
    },
    reasonCode: "JURISDICTION_EXPOSURE_LIMIT",
    message: `Post-trade jurisdiction exposure ${projected.postTradeJurisdictionExposurePct}% exceeds the maximum ${rules.maxJurisdictionExposurePct}%.`,
  });

  checks.push({
    ruleId: "maxPortfolioExposure",
    passed: precise.postTradePortfolioExposurePct <= (rules.maxPortfolioExposurePct ?? 100) + EPS,
    observed: {
      postTradePortfolioExposurePct: projected.postTradePortfolioExposurePct,
      mandateMaxPct: rules.maxPortfolioExposurePct ?? 100,
    },
    reasonCode: "PORTFOLIO_EXPOSURE_LIMIT",
    message: `Post-trade portfolio exposure ${projected.postTradePortfolioExposurePct}% exceeds the maximum ${rules.maxPortfolioExposurePct}%.`,
  });

  const violations: RuleViolation[] = checks
    .filter(c => !c.passed)
    .map(c => ({ ruleId: c.ruleId, reasonCode: c.reasonCode, message: c.message, observed: c.observed }));

  return {
    decision: violations.length === 0 ? "ALLOW" : "BLOCK",
    ruleEvaluations: checks.map(c => ({ ruleId: c.ruleId, passed: c.passed, observed: c.observed })),
    violations,
    reasonCodes: violations.map(v => v.reasonCode),
    observed: Object.assign({}, ...violations.map(v => v.observed)),
    projected,
  };
}
