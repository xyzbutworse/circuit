import { stableHash } from "../../core/hash.js";
import type { EvaluationResult } from "./evaluate.js";
import type { Approval } from "./approvals.js";

export interface DecisionReceipt {
  receiptVersion: 1;
  decisionId: string;
  timestamp: string;
  chainId: number;
  fundId: string;
  mandateId: string;
  mandateVersion: number;
  mandateHash: string;
  assetId: string;
  assetStateHash: string;
  portfolioStateHash: string;
  allocationId: string;
  allocationAmountUsd: number;
  projected: Record<string, number>;
  ruleEvaluations: Array<{ ruleId: string; passed: boolean; observed: Record<string, unknown> }>;
  reasonCodes: string[];
  decision: "ALLOW" | "BLOCK";
  approvalId: string | null;
  approvalExpiry: number | null;
  txHash: string | null;
  executionResult: string | null;
  previousReceiptHash: string | null;
}

export interface ReceiptEnvelope extends DecisionReceipt {
  receiptHash: string;
}

export function createDecisionReceipt(input: {
  decisionId: string;
  chainId: number;
  fundId: string;
  mandateId: string;
  mandateVersion: number;
  mandateHash: string;
  assetId: string;
  assetStateHash: string;
  portfolioStateHash: string;
  allocationId: string;
  allocationAmountUsd: number;
  evaluation: EvaluationResult;
  approval?: Approval;
  txHash?: string;
  executionResult?: string;
  previousReceiptHash?: string;
}): ReceiptEnvelope {
  const receipt: DecisionReceipt = {
    receiptVersion: 1,
    decisionId: input.decisionId,
    timestamp: new Date().toISOString(),
    chainId: input.chainId,
    fundId: input.fundId,
    mandateId: input.mandateId,
    mandateVersion: input.mandateVersion,
    mandateHash: input.mandateHash,
    assetId: input.assetId,
    assetStateHash: input.assetStateHash,
    portfolioStateHash: input.portfolioStateHash,
    allocationId: input.allocationId,
    allocationAmountUsd: input.allocationAmountUsd,
    projected: { ...input.evaluation.projected },
    ruleEvaluations: input.evaluation.ruleEvaluations.map(r => ({ ruleId: r.ruleId, passed: r.passed, observed: { ...r.observed } })),
    reasonCodes: [...input.evaluation.reasonCodes],
    decision: input.evaluation.decision,
    approvalId: input.approval?.approvalId ?? null,
    approvalExpiry: input.approval?.expiry ?? null,
    txHash: input.txHash ?? null,
    executionResult: input.executionResult ?? null,
    previousReceiptHash: input.previousReceiptHash ?? null,
  };
  return { ...receipt, receiptHash: stableHash(receipt) };
}

export function verifyReceipt(envelope: unknown): { valid: boolean; reason?: string } {
  if (!envelope || typeof envelope !== "object") return { valid: false, reason: "receipt is not an object" };
  const receipt = envelope as ReceiptEnvelope;
  if (receipt.receiptVersion !== 1) return { valid: false, reason: "unsupported receipt version" };
  const { receiptHash, ...unsigned } = receipt;
  const recomputed = stableHash(unsigned);
  if (recomputed !== receiptHash) return { valid: false, reason: `receipt hash mismatch (expected ${recomputed.slice(0, 24)}…, found ${String(receiptHash).slice(0, 24)}…)` };
  return { valid: true };
}
