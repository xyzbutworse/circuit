import { evaluateAllocation, type EvaluationResult } from "./evaluate.js";
import { alphaPortfolio, betaPortfolio, acmeAsset, fundAlphaMandate, fundBetaMandate, allocation } from "./scenario.js";
import { assetStateHash, portfolioStateHash, mandateHash, allocationHash, createApproval, verifyApprovalFreshness, ApprovalRegistry, type Approval } from "./approvals.js";
import { createDecisionReceipt, verifyReceipt } from "./receipt.js";
import type { ProposedAllocation, RwaAssetState, RwaMandate, RwaPortfolioState } from "./types.js";

export type GroundTruth = "ALLOW" | "BLOCK" | "STALE" | "REPLAY_REJECT" | "INVALID_APPROVAL" | "RECEIPT_VALID" | "RECEIPT_INVALID";

export interface CorpusCase {
  id: string;
  group: "clean" | "mandate-violation" | "dynamic-state" | "integrity";
  expected: GroundTruth;
  run: () => { outcome: GroundTruth; notes: string[] };
}

export function developmentCorpus(): CorpusCase[] {
  const cases: CorpusCase[] = [];
  const nav = 700_000;

  const evaluateCase = (id: string, group: "clean" | "mandate-violation", expected: GroundTruth, asset: RwaAssetState, portfolio: RwaPortfolioState, mandate: RwaMandate, alloc: ProposedAllocation): CorpusCase => ({
    id, group, expected,
    run: () => {
      const result = evaluateAllocation(asset, portfolio, mandate, alloc);
      return { outcome: result.decision, notes: result.reasonCodes };
    },
  });

  // ---- clean cases ----
  cases.push(evaluateCase("clean-valid-small", "clean", "ALLOW", acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000)));
  cases.push(evaluateCase("clean-valid-large", "clean", "ALLOW", acmeAsset, alphaPortfolio({ debtors: { ACME: 0 }, issuers: { "ACME-CORP": 0 }, sectors: { "corporate-credit": 0 }, jurisdictions: { "US-DE": 0 }, totalInvestedUsd: 0 }), fundAlphaMandate, allocation(100_000)));
  cases.push(evaluateCase("clean-after-exposure-falls", "clean", "ALLOW", acmeAsset, alphaPortfolio({ debtors: { ACME: 20_000 }, issuers: { "ACME-CORP": 20_000 }, sectors: { "corporate-credit": 20_000 }, jurisdictions: { "US-DE": 20_000 }, totalInvestedUsd: 20_000 }), fundAlphaMandate, allocation(100_000)));
  cases.push(evaluateCase("clean-same-asset-alpha", "clean", "ALLOW", acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000)));

  // ---- mandate violations ----
  cases.push(evaluateCase("viol-debtor-concentration", "mandate-violation", "BLOCK", acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(100_000)));
  cases.push(evaluateCase("viol-issuer-concentration", "mandate-violation", "BLOCK", acmeAsset, alphaPortfolio(), { ...fundAlphaMandate, rules: { ...fundAlphaMandate.rules, maxDebtorConcentrationPct: 100, maxIssuerConcentrationPct: 15 } }, allocation(100_000)));
  cases.push(evaluateCase("viol-jurisdiction-excluded", "mandate-violation", "BLOCK", acmeAsset, alphaPortfolio(), { ...fundAlphaMandate, rules: { ...fundAlphaMandate.rules, excludedJurisdictions: ["US-DE"] } }, allocation(35_000)));
  cases.push(evaluateCase("viol-yield-below-min", "mandate-violation", "BLOCK", acmeAsset, alphaPortfolio(), { ...fundAlphaMandate, rules: { ...fundAlphaMandate.rules, minYieldPct: 13 } }, allocation(35_000)));
  cases.push(evaluateCase("viol-maturity-above-max", "mandate-violation", "BLOCK", acmeAsset, alphaPortfolio(), { ...fundAlphaMandate, rules: { ...fundAlphaMandate.rules, maxMaturityDays: 30 } }, allocation(35_000)));
  cases.push(evaluateCase("viol-allocation-size", "mandate-violation", "BLOCK", acmeAsset, alphaPortfolio(), { ...fundAlphaMandate, rules: { ...fundAlphaMandate.rules, maxSingleAllocationUsd: 30_000 } }, allocation(35_000)));
  cases.push(evaluateCase("viol-liquidity-below", "mandate-violation", "BLOCK", { ...acmeAsset, liquidityScore: 20 }, alphaPortfolio(), { ...fundAlphaMandate, rules: { ...fundAlphaMandate.rules, minLiquidityScore: 60 } }, allocation(35_000)));
  cases.push(evaluateCase("viol-risk-above", "mandate-violation", "BLOCK", { ...acmeAsset, riskScore: 80 }, alphaPortfolio(), { ...fundAlphaMandate, rules: { ...fundAlphaMandate.rules, maxRiskScore: 50 } }, allocation(35_000)));
  cases.push(evaluateCase("viol-unverified", "mandate-violation", "BLOCK", { ...acmeAsset, verified: false }, alphaPortfolio(), fundAlphaMandate, allocation(35_000)));
  cases.push(evaluateCase("viol-disputed", "mandate-violation", "BLOCK", { ...acmeAsset, disputed: true }, alphaPortfolio(), fundAlphaMandate, allocation(35_000)));
  cases.push(evaluateCase("viol-stale-evidence", "mandate-violation", "BLOCK", { ...acmeAsset, evidenceTimestamp: new Date(Date.now() - 48 * 3_600_000).toISOString() }, alphaPortfolio(), fundAlphaMandate, allocation(35_000)));
  cases.push(evaluateCase("viol-beta-yield-and-maturity", "mandate-violation", "BLOCK", acmeAsset, betaPortfolio(), fundBetaMandate, allocation(100_000)));

  // ---- dynamic-state attacks (approval TOCTOU) ----
  const approvalCase = (id: string, expected: GroundTruth, mutate: (ctx: { asset: RwaAssetState; portfolio: RwaPortfolioState; mandate: RwaMandate; alloc: ProposedAllocation; approval: Approval }) => void): CorpusCase => ({
    id, group: "dynamic-state", expected,
    run: () => {
      const asset = { ...acmeAsset };
      const portfolio = alphaPortfolio();
      const mandate = { ...fundAlphaMandate };
      const alloc = allocation(35_000);
      const evaluation = evaluateAllocation(asset, portfolio, mandate, alloc);
      const approval = createApproval({ asset, portfolio, mandate, allocation: alloc, evaluation });
      const registry = new ApprovalRegistry();
      registry.add(approval);
      const current = { asset: { ...asset }, portfolio: { ...portfolio }, mandate: { ...mandate }, alloc: { ...alloc }, approval };
      mutate(current);
      const fresh = verifyApprovalFreshness(approval, current.asset, current.portfolio, current.mandate, current.alloc);
      if (!fresh.fresh) return { outcome: "STALE", notes: [fresh.reason ?? "stale"] };
      const first = registry.execute(approval, () => ({ status: "EXECUTED", txHash: "0x" + "e1".repeat(32), blockNumber: 1 }));
      if (first.status !== "EXECUTED") return { outcome: "INVALID_APPROVAL", notes: [first.reason] };
      const second = registry.execute(approval, () => ({ status: "EXECUTED", txHash: "0x" + "e2".repeat(32), blockNumber: 2 }));
      if (second.status === "REPLAY_REJECT") return { outcome: "REPLAY_REJECT", notes: ["duplicate execution blocked"] };
      return { outcome: "EXECUTED" as GroundTruth, notes: [] };
    },
  });

  cases.push(approvalCase("dyn-dispute-after-approval", "STALE", ctx => { ctx.asset.disputed = true; }));
  cases.push(approvalCase("dyn-evidence-stale-after-approval", "STALE", ctx => { ctx.asset.evidenceTimestamp = new Date(Date.now() - 48 * 3_600_000).toISOString(); }));
  cases.push(approvalCase("dyn-portfolio-change-after-approval", "STALE", ctx => { ctx.portfolio.debtors = { ACME: (ctx.portfolio.debtors["ACME"] ?? 0) + 50_000 }; }));
  cases.push(approvalCase("dyn-mandate-change-after-approval", "STALE", ctx => { ctx.mandate.version = 2; }));
  cases.push(approvalCase("dyn-allocation-change-after-approval", "STALE", ctx => { ctx.alloc.amountUsd = 90_000; }));
  cases.push(approvalCase("dyn-approval-replayed", "REPLAY_REJECT", () => {}));
  cases.push(approvalCase("dyn-expired-approval", "STALE", ctx => { ctx.approval.expiry = Date.now() - 1; }));
  cases.push(approvalCase("dyn-wrong-fund", "STALE", ctx => { ctx.alloc.fundId = "fund-beta"; }));
  cases.push(approvalCase("dyn-wrong-chain", "STALE", ctx => { ctx.alloc.chainId = 1; }));

  // ---- integrity attacks ----
  cases.push({
    id: "int-tampered-receipt", group: "integrity", expected: "RECEIPT_INVALID",
    run: () => {
      const asset = { ...acmeAsset };
      const portfolio = alphaPortfolio();
      const mandate = { ...fundAlphaMandate };
      const alloc = allocation(100_000);
      const evaluation = evaluateAllocation(asset, portfolio, mandate, alloc);
      const receipt = createDecisionReceipt({
        decisionId: "DEC-1", chainId: 1952, fundId: "fund-alpha", mandateId: mandate.mandateId, mandateVersion: mandate.version,
        mandateHash: mandateHash(mandate), assetId: asset.assetId, assetStateHash: assetStateHash(asset), portfolioStateHash: portfolioStateHash(portfolio),
        allocationId: alloc.allocationId, allocationAmountUsd: alloc.amountUsd, evaluation,
      });
      const tampered = { ...receipt, decision: "ALLOW" };
      return { outcome: verifyReceipt(tampered).valid ? "RECEIPT_VALID" : "RECEIPT_INVALID", notes: [verifyReceipt(tampered).reason ?? ""] };
    },
  });
  cases.push({
    id: "int-altered-amount", group: "integrity", expected: "RECEIPT_INVALID",
    run: () => {
      const receipt = createDecisionReceipt({
        decisionId: "DEC-2", chainId: 1952, fundId: "fund-alpha", mandateId: fundAlphaMandate.mandateId, mandateVersion: fundAlphaMandate.version,
        mandateHash: mandateHash(fundAlphaMandate), assetId: acmeAsset.assetId, assetStateHash: assetStateHash(acmeAsset),
        portfolioStateHash: portfolioStateHash(alphaPortfolio()), allocationId: "A", allocationAmountUsd: 100_000,
        evaluation: evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(100_000)),
      });
      const tampered = { ...receipt, allocationAmountUsd: 1 };
      return { outcome: verifyReceipt(tampered).valid ? "RECEIPT_VALID" : "RECEIPT_INVALID", notes: [] };
    },
  });
  cases.push({
    id: "int-altered-tx", group: "integrity", expected: "RECEIPT_INVALID",
    run: () => {
      const receipt = createDecisionReceipt({
        decisionId: "DEC-3", chainId: 1952, fundId: "fund-alpha", mandateId: fundAlphaMandate.mandateId, mandateVersion: fundAlphaMandate.version,
        mandateHash: mandateHash(fundAlphaMandate), assetId: acmeAsset.assetId, assetStateHash: assetStateHash(acmeAsset),
        portfolioStateHash: portfolioStateHash(alphaPortfolio()), allocationId: "A", allocationAmountUsd: 35_000,
        evaluation: evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000)),
        txHash: "0x" + "e1".repeat(32), executionResult: "SUCCESS",
      });
      const tampered = { ...receipt, txHash: "0x" + "00".repeat(32) };
      return { outcome: verifyReceipt(tampered).valid ? "RECEIPT_VALID" : "RECEIPT_INVALID", notes: [] };
    },
  });
  cases.push({
    id: "int-valid-receipt", group: "integrity", expected: "RECEIPT_VALID",
    run: () => {
      const receipt = createDecisionReceipt({
        decisionId: "DEC-4", chainId: 1952, fundId: "fund-alpha", mandateId: fundAlphaMandate.mandateId, mandateVersion: fundAlphaMandate.version,
        mandateHash: mandateHash(fundAlphaMandate), assetId: acmeAsset.assetId, assetStateHash: assetStateHash(acmeAsset),
        portfolioStateHash: portfolioStateHash(alphaPortfolio()), allocationId: "A", allocationAmountUsd: 35_000,
        evaluation: evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000)),
      });
      return { outcome: verifyReceipt(receipt).valid ? "RECEIPT_VALID" : "RECEIPT_INVALID", notes: [] };
    },
  });

  return cases;
}

export function holdoutCorpus(): CorpusCase[] {
  const cases: CorpusCase[] = [];
  const evaluateCase = (id: string, expected: GroundTruth, asset: RwaAssetState, portfolio: RwaPortfolioState, mandate: RwaMandate, alloc: ProposedAllocation): CorpusCase => ({
    id, group: "clean", expected,
    run: () => {
      const result = evaluateAllocation(asset, portfolio, mandate, alloc);
      return { outcome: result.decision, notes: result.reasonCodes };
    },
  });

  cases.push(evaluateCase("hold-combined-stale-and-concentration", "BLOCK", { ...acmeAsset, evidenceTimestamp: new Date(Date.now() - 30 * 3_600_000).toISOString() }, alphaPortfolio(), fundAlphaMandate, allocation(100_000)));
  cases.push(evaluateCase("hold-mandate-changed-smaller", "ALLOW", acmeAsset, alphaPortfolio(), { ...fundAlphaMandate, version: 2, rules: { ...fundAlphaMandate.rules, maxDebtorConcentrationPct: 30 } }, allocation(100_000)));
  cases.push(evaluateCase("hold-same-debtor-different-issuer", "BLOCK", { ...acmeAsset, issuer: "ACME-SPV-2" }, { ...alphaPortfolio(), issuers: { "ACME-SPV-2": 0 }, debtors: { ACME: 98_700 } }, fundAlphaMandate, allocation(100_000)));
  cases.push(evaluateCase("hold-concurrent-portfolio-change", "BLOCK", acmeAsset, alphaPortfolio({ debtors: { ACME: 60_000 }, issuers: { "ACME-CORP": 60_000 }, sectors: { "corporate-credit": 60_000 }, jurisdictions: { "US-DE": 60_000 }, totalInvestedUsd: 60_000 }), fundAlphaMandate, allocation(100_000)));
  cases.push(evaluateCase("hold-verified-but-disputed", "BLOCK", { ...acmeAsset, disputed: true }, alphaPortfolio(), fundAlphaMandate, allocation(35_000)));
  cases.push(evaluateCase("hold-exact-threshold", "ALLOW", acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(41_300))); // 98_700+41_300 = 140_000 = 20.0%
  cases.push(evaluateCase("hold-just-over-threshold", "BLOCK", acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(41_301)));
  cases.push(evaluateCase("hold-rounding-boundary", "ALLOW", acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(41_299.99)));

  return cases;
}

export interface CorpusRunResult {
  id: string;
  group: string;
  expected: GroundTruth;
  outcome: GroundTruth;
  notes: string[];
  passed: boolean;
}

export function runCorpus(cases: CorpusCase[]): CorpusRunResult[] {
  return cases.map(c => {
    const result = c.run();
    return { id: c.id, group: c.group, expected: c.expected, outcome: result.outcome, notes: result.notes, passed: result.outcome === c.expected };
  });
}

export function evaluateLatencyMs(asset: RwaAssetState, portfolio: RwaPortfolioState, mandate: RwaMandate, alloc: ProposedAllocation, rounds = 500): number[] {
  const samples: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    evaluateAllocation(asset, portfolio, mandate, alloc);
    samples.push(performance.now() - t0);
  }
  return samples;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? 0;
}
