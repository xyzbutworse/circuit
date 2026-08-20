export type RwaRuleId =
  | "verifiedEvidence"
  | "rejectDisputed"
  | "rejectEncumbered"
  | "excludedJurisdictions"
  | "excludedAssetStates"
  | "maxSingleAllocation"
  | "minYield"
  | "maxMaturity"
  | "minLiquidity"
  | "maxRisk"
  | "maxEvidenceAge"
  | "minCollateralization"
  | "maxDebtorConcentration"
  | "maxIssuerConcentration"
  | "maxSectorConcentration"
  | "maxJurisdictionExposure"
  | "maxPortfolioExposure";

export interface RwaMandateRules {
  maxDebtorConcentrationPct?: number;
  maxIssuerConcentrationPct?: number;
  maxSectorConcentrationPct?: number;
  maxJurisdictionExposurePct?: number;
  maxPortfolioExposurePct?: number;
  minYieldPct?: number;
  maxMaturityDays?: number;
  maxSingleAllocationUsd?: number;
  minLiquidityScore?: number;
  maxRiskScore?: number;
  minCollateralizationRatio?: number;
  maxEvidenceAgeHours?: number;
  requireVerifiedEvidence?: boolean;
  rejectDisputed?: boolean;
  rejectEncumbered?: boolean;
  excludedJurisdictions?: string[];
  excludedAssetStates?: string[];
}

export interface RwaMandate {
  mandateId: string;
  fundId: string;
  version: number;
  rules: RwaMandateRules;
}

export interface ProposedAllocation {
  allocationId: string;
  assetId: string;
  amountUsd: number;
  chainId: number;
  fundId: string;
}

export interface RwaAssetState {
  assetId: string;
  passportId: string;
  issuer: string;
  debtor: string;
  sector: string;
  jurisdiction: string;
  assetType: string;
  principalUsd: number;
  yieldPct: number;
  maturityDays: number;
  outstandingUsd: number;
  collateralized: boolean;
  collateralizationRatio: number | null;
  verified: boolean;
  disputed: boolean;
  encumbered: boolean;
  liquidityScore: number;
  riskScore: number;
  evidenceTimestamp: string;
  evidenceHash: string;
  contractAddress?: string;
}

export interface RwaPortfolioState {
  navUsd: number;
  debtors: Record<string, number>;
  issuers: Record<string, number>;
  sectors: Record<string, number>;
  jurisdictions: Record<string, number>;
  totalInvestedUsd: number;
}
