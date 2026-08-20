import { stableHash } from "../core/hash.js";
import type { CircuitReceipt, PlanDecision } from "./types.js";

export function makeCircuitReceipt(input: {
  mandateId: string;
  portfolioId: string;
  planId: string;
  decision: PlanDecision;
  createdAt: string;
  chainId?: number;
  contractAddress?: string;
  txHash?: string;
  previousReceiptHash?: string;
}): CircuitReceipt {
  const unsigned = {
    id: `circuit-proof:${input.planId}:${input.createdAt}`,
    mandateId: input.mandateId,
    portfolioId: input.portfolioId,
    planId: input.planId,
    planHash: input.decision.planHash,
    mandateHash: input.decision.mandateHash,
    beforePortfolioHash: input.decision.beforePortfolioHash,
    afterPortfolioHash: input.decision.afterPortfolioHash,
    verdict: input.decision.verdict,
    violations: input.decision.violations,
    chainId: input.chainId ?? 1952,
    ...(input.contractAddress ? { contractAddress: input.contractAddress } : {}),
    ...(input.txHash ? { txHash: input.txHash } : {}),
    proofMode: input.txHash ? "xlayer-testnet" as const : "local" as const,
    createdAt: input.createdAt,
    ...(input.previousReceiptHash ? { previousReceiptHash: input.previousReceiptHash } : {}),
  };
  return { ...unsigned, receiptHash: stableHash(unsigned) };
}

export function verifyCircuitReceipt(receipt: CircuitReceipt): { valid: boolean; reason?: string } {
  const { receiptHash, ...unsigned } = receipt;
  const expected = stableHash(unsigned);
  if (receiptHash !== expected) return { valid: false, reason: `receipt hash mismatch: expected ${expected}, found ${receiptHash}` };
  if (!receipt.planHash || !receipt.mandateHash || !receipt.beforePortfolioHash || !receipt.afterPortfolioHash) {
    return { valid: false, reason: "receipt is missing a required evaluation hash" };
  }
  return { valid: true };
}
