import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAllocation } from "../dist/competition/rwa/evaluate.js";
import { createApproval, verifyApprovalFreshness, ApprovalRegistry, assetStateHash, portfolioStateHash, mandateHash, allocationHash } from "../dist/competition/rwa/approvals.js";
import { createDecisionReceipt, verifyReceipt } from "../dist/competition/rwa/receipt.js";
import { developmentCorpus, holdoutCorpus, runCorpus } from "../dist/competition/rwa/corpus.js";
import { acmeAsset, fundAlphaMandate, fundBetaMandate, alphaPortfolio, betaPortfolio, allocation } from "../dist/competition/rwa/scenario.js";

test("canonical judge scenario: $100k blocked on debtor concentration with observed values", () => {
  const result = evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(100_000));
  assert.equal(result.decision, "BLOCK");
  assert.deepEqual(result.reasonCodes, ["DEBTOR_CONCENTRATION_LIMIT"]);
  assert.equal(result.projected.postTradeDebtorExposurePct, 28.4);
  assert.equal(result.observed.currentDebtorExposurePct, 14.1);
  assert.equal(result.observed.mandateMaxPct, 20); // from the violated rule
});

test("canonical judge scenario: $35k passes with engine-computed post-trade concentration", () => {
  const result = evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000));
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.reasonCodes.length, 0);
  assert.equal(result.projected.postTradeDebtorExposurePct, 19.1);
});

test("two-fund comparison: same asset, different mandates, different deterministic results", () => {
  const alpha = evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(100_000));
  const beta = evaluateAllocation(acmeAsset, betaPortfolio(), fundBetaMandate, allocation(100_000));
  assert.equal(alpha.decision, "BLOCK");
  assert.equal(beta.decision, "BLOCK");
  assert.ok(alpha.reasonCodes.includes("DEBTOR_CONCENTRATION_LIMIT"));
  assert.ok(beta.reasonCodes.includes("YIELD_BELOW_MINIMUM") && beta.reasonCodes.includes("MATURITY_EXCEEDED"));
  // Alpha passes at a smaller allocation; Beta still fails on yield for ANY size.
  assert.equal(evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000)).decision, "ALLOW");
  assert.equal(evaluateAllocation(acmeAsset, betaPortfolio(), fundBetaMandate, allocation(35_000)).decision, "BLOCK");
});

test("execution state machine: BLOCKED evaluations cannot produce approvals", () => {
  const evaluation = evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(100_000));
  assert.throws(() => createApproval({ asset: acmeAsset, portfolio: alphaPortfolio(), mandate: fundAlphaMandate, allocation: allocation(100_000), evaluation }), /BLOCKED/);
});

test("approvals bind asset/portfolio/mandate/allocation/chain; staleness is detected", () => {
  const evaluation = evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000));
  const approval = createApproval({ asset: acmeAsset, portfolio: alphaPortfolio(), mandate: fundAlphaMandate, allocation: allocation(35_000), evaluation });
  assert.ok(approval.approvalHash.length > 10);
  assert.ok(approval.assetStateHash === assetStateHash(acmeAsset));
  assert.ok(approval.portfolioStateHash === portfolioStateHash(alphaPortfolio()));
  assert.ok(approval.mandateHash === mandateHash(fundAlphaMandate));
  assert.ok(approval.allocationHash === allocationHash(allocation(35_000)));

  const fresh = verifyApprovalFreshness(approval, acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000));
  assert.equal(fresh.fresh, true);

  const disputed = verifyApprovalFreshness(approval, { ...acmeAsset, disputed: true }, alphaPortfolio(), fundAlphaMandate, allocation(35_000));
  assert.equal(disputed.fresh, false);
  assert.match(disputed.reason ?? "", /asset state changed/);

  const changedPortfolio = verifyApprovalFreshness(approval, acmeAsset, { ...alphaPortfolio(), totalInvestedUsd: 200_000 }, fundAlphaMandate, allocation(35_000));
  assert.equal(changedPortfolio.fresh, false);

  const changedMandate = verifyApprovalFreshness(approval, acmeAsset, alphaPortfolio(), { ...fundAlphaMandate, version: 2 }, allocation(35_000));
  assert.equal(changedMandate.fresh, false);

  const changedAllocation = verifyApprovalFreshness(approval, acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(36_000));
  assert.equal(changedAllocation.fresh, false);

  const wrongChain = verifyApprovalFreshness(approval, acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000, { chainId: 1 }));
  assert.equal(wrongChain.fresh, false);
});

test("atomic execution: at most one successful execution per approval", () => {
  const evaluation = evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(35_000));
  const approval = createApproval({ asset: acmeAsset, portfolio: alphaPortfolio(), mandate: fundAlphaMandate, allocation: allocation(35_000), evaluation });
  const registry = new ApprovalRegistry();
  registry.add(approval);
  let executions = 0;
  const onExecute = () => { executions += 1; return { status: "EXECUTED", txHash: "0x" + "e1".repeat(32), blockNumber: 42 }; };
  const first = registry.execute(approval, onExecute);
  assert.equal(first.status, "EXECUTED");
  const second = registry.execute(approval, onExecute);
  assert.equal(second.status, "REPLAY_REJECT");
  assert.equal(executions, 1, "exactly one successful capital movement per approval");
});

test("decision receipts are tamper-evident", () => {
  const evaluation = evaluateAllocation(acmeAsset, alphaPortfolio(), fundAlphaMandate, allocation(100_000));
  const receipt = createDecisionReceipt({
    decisionId: "DEC-1", chainId: 1952, fundId: "fund-alpha", mandateId: fundAlphaMandate.mandateId, mandateVersion: fundAlphaMandate.version,
    mandateHash: mandateHash(fundAlphaMandate), assetId: acmeAsset.assetId, assetStateHash: assetStateHash(acmeAsset),
    portfolioStateHash: portfolioStateHash(alphaPortfolio()), allocationId: "A-1", allocationAmountUsd: 100_000, evaluation,
  });
  assert.equal(verifyReceipt(receipt).valid, true);
  for (const tampered of [
    { ...receipt, decision: "ALLOW" },
    { ...receipt, allocationAmountUsd: 1 },
    { ...receipt, assetId: "OTHER" },
    { ...receipt, txHash: "0x" + "00".repeat(32) },
    { ...receipt, projected: { ...receipt.projected, postTradeDebtorExposurePct: 1 } },
  ]) {
    assert.equal(verifyReceipt(tampered).valid, false, "tampered receipt must fail verification");
  }
});

test("adversarial corpora: all ground truths pass", () => {
  const dev = runCorpus(developmentCorpus());
  const hold = runCorpus(holdoutCorpus());
  assert.ok(dev.length >= 29, `development corpus size ${dev.length}`);
  assert.ok(hold.length >= 8, `holdout corpus size ${hold.length}`);
  assert.equal(dev.every(c => c.passed), true, dev.filter(c => !c.passed).map(c => c.id).join(","));
  assert.equal(hold.every(c => c.passed), true, hold.filter(c => !c.passed).map(c => c.id).join(","));
});
