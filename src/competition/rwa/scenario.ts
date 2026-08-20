import type { ProposedAllocation, RwaAssetState, RwaMandate, RwaPortfolioState } from "./types.js";

export const NAV = 700_000;

// Fixed fixture timestamp: asset-state hashes must be deterministic across
// processes so on-chain registrations remain valid for the full proof run.
const FIXED_EVIDENCE = "2026-08-20T00:00:00.000Z";

export const acmeAsset: RwaAssetState = {
  assetId: "ACME-INV-8842",
  passportId: "PASS-ACME-8842",
  issuer: "ACME-CORP",
  debtor: "ACME",
  sector: "corporate-credit",
  jurisdiction: "US-DE",
  assetType: "invoice-finance-note",
  principalUsd: 1_200_000,
  yieldPct: 11.2,
  maturityDays: 74,
  outstandingUsd: 640_000,
  collateralized: true,
  collateralizationRatio: 1.32,
  verified: true,
  disputed: false,
  encumbered: false,
  liquidityScore: 85,
  riskScore: 4,
  evidenceTimestamp: FIXED_EVIDENCE,
  evidenceHash: "sha256:acme-evidence-v1",
  contractAddress: "0x" + "ac".repeat(20),
};

export const fundAlphaMandate: RwaMandate = {
  mandateId: "fund-alpha-v1",
  fundId: "fund-alpha",
  version: 1,
  rules: {
    maxDebtorConcentrationPct: 20,
    minYieldPct: 8,
    maxMaturityDays: 90,
    maxSingleAllocationUsd: 100_000,
    requireVerifiedEvidence: true,
    rejectDisputed: true,
    maxEvidenceAgeHours: 24,
    maxPortfolioExposurePct: 95,
  },
};

export const fundBetaMandate: RwaMandate = {
  mandateId: "fund-beta-v1",
  fundId: "fund-beta",
  version: 1,
  rules: {
    maxDebtorConcentrationPct: 35,
    minYieldPct: 12,
    maxMaturityDays: 60,
    requireVerifiedEvidence: true,
    rejectDisputed: true,
    maxEvidenceAgeHours: 24,
    maxPortfolioExposurePct: 95,
  },
};

export function alphaPortfolio(overrides: Partial<RwaPortfolioState> = {}): RwaPortfolioState {
  return {
    navUsd: NAV,
    debtors: { ACME: 98_700 },
    issuers: { "ACME-CORP": 98_700 },
    sectors: { "corporate-credit": 98_700 },
    jurisdictions: { "US-DE": 98_700 },
    totalInvestedUsd: 98_700,
    ...overrides,
  };
}

export function betaPortfolio(): RwaPortfolioState {
  return {
    navUsd: NAV,
    debtors: { ACME: 40_000 },
    issuers: { "ACME-CORP": 40_000 },
    sectors: { "corporate-credit": 40_000 },
    jurisdictions: { "US-DE": 40_000 },
    totalInvestedUsd: 40_000,
  };
}

export function allocation(amountUsd: number, overrides: Partial<ProposedAllocation> = {}): ProposedAllocation {
  return {
    allocationId: `ALLOC-${amountUsd}-${overrides.fundId ?? "fund-alpha"}`,
    assetId: "ACME-INV-8842",
    amountUsd,
    chainId: 1952,
    fundId: "fund-alpha",
    ...overrides,
  };
}
