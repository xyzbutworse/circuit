import { stableHash } from "../../core/hash.js";
import type { EvaluationResult } from "./evaluate.js";
import type { ProposedAllocation, RwaAssetState, RwaMandate, RwaPortfolioState } from "./types.js";

export interface Approval {
  approvalId: string;
  state: "APPROVED" | "EXECUTED" | "BLOCKED" | "STALE";
  chainId: number;
  fundId: string;
  mandateId: string;
  mandateVersion: number;
  mandateHash: string;
  assetId: string;
  assetStateHash: string;
  portfolioStateHash: string;
  allocationHash: string;
  allocationId: string;
  amountUsd: number;
  expiry: number;
  nonce: number;
  approvedAt: string;
  executedAt?: string;
  txHash?: string;
  approvalHash: string;
}

export type ExecutionOutcome =
  | { status: "EXECUTED"; approval: Approval; txHash: string; blockNumber: number }
  | { status: "STALE"; reason: string; approval: Approval }
  | { status: "REPLAY_REJECT"; reason: string; approval: Approval }
  | { status: "INVALID_APPROVAL"; reason: string; approval?: Approval }
  | { status: "EXPIRED"; reason: string; approval: Approval }
  | { status: "BLOCKED"; reason: string; approval: Approval };

export const assetStateHash = (asset: RwaAssetState): string => stableHash(asset);
export const portfolioStateHash = (portfolio: RwaPortfolioState): string => stableHash(portfolio);
export const mandateHash = (mandate: RwaMandate): string => stableHash({ mandateId: mandate.mandateId, version: mandate.version, rules: mandate.rules });
export const allocationHash = (allocation: ProposedAllocation): string => stableHash(allocation);

let nonceCounter = 0;
export function nextNonce(): number {
  nonceCounter += 1;
  return Date.now() * 1000 + nonceCounter;
}

export function createApproval(input: {
  asset: RwaAssetState;
  portfolio: RwaPortfolioState;
  mandate: RwaMandate;
  allocation: ProposedAllocation;
  evaluation: EvaluationResult;
  expirySeconds?: number;
}): Approval {
  if (input.evaluation.decision !== "ALLOW") {
    throw new Error("Cannot create an approval for a BLOCKED evaluation.");
  }
  const now = Date.now();
  const approval = {
    approvalId: `AP-${input.allocation.fundId}-${now}`,
    state: "APPROVED" as const,
    chainId: input.allocation.chainId,
    fundId: input.allocation.fundId,
    mandateId: input.mandate.mandateId,
    mandateVersion: input.mandate.version,
    mandateHash: mandateHash(input.mandate),
    assetId: input.asset.assetId,
    assetStateHash: assetStateHash(input.asset),
    portfolioStateHash: portfolioStateHash(input.portfolio),
    allocationHash: allocationHash(input.allocation),
    allocationId: input.allocation.allocationId,
    amountUsd: input.allocation.amountUsd,
    expiry: now + (input.expirySeconds ?? 300) * 1000,
    nonce: nextNonce(),
    approvedAt: new Date(now).toISOString(),
  };
  return { ...approval, approvalHash: stableHash(approval) };
}

/**
 * Recompute all commitments before execution. If the current state differs
 * from the approval bindings, return STALE and capital must not move.
 */
export function verifyApprovalFreshness(
  approval: Approval,
  currentAsset: RwaAssetState,
  currentPortfolio: RwaPortfolioState,
  currentMandate: RwaMandate,
  currentAllocation: ProposedAllocation,
  now: number = Date.now()
): { fresh: boolean; reason?: string } {
  if (now >= approval.expiry) return { fresh: false, reason: "approval expired" };
  if (assetStateHash(currentAsset) !== approval.assetStateHash) return { fresh: false, reason: "asset state changed since approval" };
  if (portfolioStateHash(currentPortfolio) !== approval.portfolioStateHash) return { fresh: false, reason: "portfolio state changed since approval" };
  if (mandateHash(currentMandate) !== approval.mandateHash || currentMandate.version !== approval.mandateVersion) return { fresh: false, reason: "mandate changed since approval" };
  if (allocationHash(currentAllocation) !== approval.allocationHash) return { fresh: false, reason: "allocation changed since approval" };
  if (currentAllocation.chainId !== approval.chainId) return { fresh: false, reason: "approval used on wrong chain" };
  if (currentAllocation.fundId !== approval.fundId) return { fresh: false, reason: "approval used by wrong fund" };
  return { fresh: true };
}

export class ApprovalRegistry {
  private byHash = new Map<string, Approval>();

  add(approval: Approval): void {
    this.byHash.set(approval.approvalHash, approval);
  }

  get(approvalHash: string): Approval | undefined {
    return this.byHash.get(approvalHash);
  }

  /** Atomic execution guard: exactly one successful execution per approval. */
  execute(approval: Approval, onExecute: (approval: Approval) => { status: "EXECUTED"; txHash: string; blockNumber: number }): ExecutionOutcome {
    if (approval.state === "EXECUTED") return { status: "REPLAY_REJECT", reason: "approval already executed", approval };
    approval.state = "EXECUTED";
    const result = onExecute(approval);
    approval.executedAt = new Date().toISOString();
    approval.txHash = result.txHash;
    return { status: "EXECUTED", approval, txHash: result.txHash, blockNumber: result.blockNumber };
  }
}
