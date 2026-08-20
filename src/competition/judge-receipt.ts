import { keccak256, toUtf8Bytes } from "ethers";
import { stableHash } from "../core/hash.js";
import { verifyCircuitReceipt } from "./receipt.js";
import { normalizeLivePlan, parseLivePlanJson } from "./agent-plan.js";
import type { AgentPlan, CircuitReceipt, PlanViolation, PlanningAttempt } from "./types.js";

export interface OnchainTradeRecord {
  assetId: string;
  side: "BUY" | "SELL";
  notionalUsd: number;
  intentHash: string;
  txHash: string;
  blockNumber: number;
  status: number;
  authorizationHash: string;
}

export interface JudgeReceiptInput {
  id: string;
  chainId: number;
  createdAt: string;
  objective: string;
  plan1: AgentPlan;
  plan1Hash: string;
  plan2: AgentPlan;
  plan2Hash: string;
  plans?: Array<{ attempt: number; plan: AgentPlan; planHash: string }>;
  evaluationHash: string;
  rejectionCode: string;
  rejection: PlanViolation;
  mandateHash: string;
  policyVersion: number;
  policyKey: string;
  trades: OnchainTradeRecord[];
  finalPortfolioHash: string;
  evaluationReceiptHashes?: string[];
  onchainReadback?: unknown;
  previousReceiptHash?: string;
}

export interface AiEvidenceLink {
  attempt: number;
  planId: string;
  planHash: string;
  provider: string;
  model: string;
  generationId: string;
  requestHash: string;
  completionHash: string;
  normalizedOutputHash: string;
  metadataVerified: boolean;
}

export interface JudgeReceipt extends Omit<JudgeReceiptInput, "objective" | "plan1" | "plan2" | "rejection"> {
  objectiveHash: string;
  rejection: PlanViolation;
  intentHash: string;
  authorizationHash: string;
  transactionHash: string;
  aiEvidence: AiEvidenceLink[];
  evaluationReceiptHashes: string[];
  onchainReadbackHash: string;
  receiptHash: string;
}

export function objectiveHashFor(objective: string): string {
  return keccak256(toUtf8Bytes(objective));
}

export function intentHashFor(planId: string, intentIndex: number, assetId: string, side: "BUY" | "SELL", notionalUsd: number): string {
  return keccak256(toUtf8Bytes(`${planId}:${intentIndex}:${assetId.toLowerCase()}:${side}:${notionalUsd}`));
}

export function traceIntentHashFor(traceId: string, planId: string, intentIndex: number, assetId: string, side: "BUY" | "SELL", notionalUsd: number): string {
  return keccak256(toUtf8Bytes(`${traceId}:${planId}:${intentIndex}:${assetId.toLowerCase()}:${side}:${notionalUsd}`));
}

function evidenceFor(plan: AgentPlan, planHash: string, attempt: number): AiEvidenceLink {
  const p = plan.provenance;
  return {
    attempt,
    planId: plan.id,
    planHash,
    provider: plan.provider,
    model: plan.model ?? "",
    generationId: p?.generationId ?? "",
    requestHash: p?.requestHash ?? "",
    completionHash: p?.completionHash ?? "",
    normalizedOutputHash: p?.normalizedOutputHash ?? "",
    metadataVerified: p?.metadataVerified === true,
  };
}

export function buildJudgeReceipt(input: JudgeReceiptInput): JudgeReceipt {
  const headline = input.trades[0];
  const plans = input.plans?.length
    ? input.plans.map(item => evidenceFor(item.plan, item.planHash, item.attempt))
    : input.plan1.id === input.plan2.id
      ? [evidenceFor(input.plan1, input.plan1Hash, 1)]
      : [evidenceFor(input.plan1, input.plan1Hash, 1), evidenceFor(input.plan2, input.plan2Hash, 2)];
  const unsigned = {
    id: input.id,
    chainId: input.chainId,
    createdAt: input.createdAt,
    objectiveHash: objectiveHashFor(input.objective),
    plan1Hash: input.plan1Hash,
    plan2Hash: input.plan2Hash,
    evaluationHash: input.evaluationHash,
    rejectionCode: input.rejectionCode,
    rejection: input.rejection,
    mandateHash: input.mandateHash,
    policyVersion: input.policyVersion,
    policyKey: input.policyKey,
    intentHash: headline?.intentHash ?? "",
    authorizationHash: headline?.authorizationHash ?? "",
    transactionHash: headline?.txHash ?? "",
    aiEvidence: plans,
    evaluationReceiptHashes: input.evaluationReceiptHashes ?? [input.evaluationHash],
    onchainReadbackHash: input.onchainReadback === undefined ? "" : stableHash(input.onchainReadback),
    trades: input.trades,
    finalPortfolioHash: input.finalPortfolioHash,
    ...(input.previousReceiptHash ? { previousReceiptHash: input.previousReceiptHash } : {}),
  };
  return { ...unsigned, receiptHash: stableHash(unsigned) };
}


export interface ProofCheck { id: string; valid: boolean; detail: string }
export interface JudgeProofContext {
  traceId: string;
  attempts: PlanningAttempt[];
  attemptReceipts: CircuitReceipt[];
  onchain: { ok?: boolean; trades?: OnchainTradeRecord[]; readback?: unknown } | null;
}

function verifyPlanProvenance(plan: AgentPlan): { valid: boolean; detail: string } {
  const p = plan.provenance;
  if (plan.provider !== "openrouter" || !p || p.provider !== "openrouter") return { valid: false, detail: `${plan.id} is not an OpenRouter plan` };
  if (!p.metadataVerified || !p.generationId) return { valid: false, detail: `${plan.id} lacks verified generation metadata` };
  if (p.resolvedModel !== plan.model) return { valid: false, detail: `${plan.id} model does not match provenance` };
  if (stableHash(p.rawCompletion) !== p.completionHash) return { valid: false, detail: `${plan.id} completion hash mismatch` };
  let raw: Record<string, unknown>;
  try { raw = parseLivePlanJson(p.rawCompletion) as Record<string, unknown>; }
  catch { return { valid: false, detail: `${plan.id} completion is not valid JSON` }; }
  if (stableHash(raw) !== p.normalizedOutputHash) return { valid: false, detail: `${plan.id} normalized output hash mismatch` };
  let normalized: AgentPlan;
  try { normalized = normalizeLivePlan(raw, plan.mandateId, plan.revisionOf, plan.model ?? ""); }
  catch { return { valid: false, detail: `${plan.id} completion no longer passes plan normalization` }; }
  if (normalized.id !== plan.id) return { valid: false, detail: `${plan.id} does not match the provider plan id` };
  if (stableHash(normalized.intents) !== stableHash(plan.intents)) return { valid: false, detail: `${plan.id} intents differ from the provider completion` };
  if (normalized.allocationRationale !== plan.allocationRationale) return { valid: false, detail: `${plan.id} rationale differs from the provider completion` };
  if (stableHash(normalized.expectedAllocation) !== stableHash(plan.expectedAllocation)) return { valid: false, detail: `${plan.id} allocation differs from the provider completion` };
  if (stableHash(normalized.assumptions) !== stableHash(plan.assumptions)) return { valid: false, detail: `${plan.id} assumptions differ from the provider completion` };
  return { valid: true, detail: `${plan.id} is bound to OpenRouter generation ${p.generationId}` };
}

export function verifyJudgeReceipt(receipt: JudgeReceipt, context: JudgeProofContext): { valid: boolean; checks: ProofCheck[] } {
  const checks: ProofCheck[] = [];
  const add = (id: string, valid: boolean, detail: string) => checks.push({ id, valid, detail });
  const { receiptHash, ...unsigned } = receipt;
  add("JUDGE_RECEIPT_HASH", stableHash(unsigned) === receiptHash, "Judge receipt hash recomputes from every linked field.");

  const planHashesValid = context.attempts.length > 0 && context.attempts.every(a => stableHash(a.plan) === a.decision.planHash);
  add("PLAN_HASHES", planHashesValid, planHashesValid ? "Every evaluated plan hash recomputes." : "A plan differs from its evaluated hash.");

  const provenanceResults = context.attempts.map(a => verifyPlanProvenance(a.plan));
  const provenanceValid = provenanceResults.length > 0 && provenanceResults.every(r => r.valid);
  add("OPENROUTER_GENERATIONS", provenanceValid, provenanceResults.map(r => r.detail).join(" | ") || "No AI attempts exist.");

  const evidenceValid = receipt.aiEvidence.length === context.attempts.length && receipt.aiEvidence.every((e, index) => {
    const a = context.attempts[index];
    return Boolean(a && e.planId === a.plan.id && e.planHash === a.decision.planHash && e.generationId === a.plan.provenance?.generationId && e.metadataVerified);
  });
  add("AI_EVIDENCE_LINKS", evidenceValid, evidenceValid ? "Receipt AI links match every planning attempt." : "Receipt AI links do not match the trace.");

  const evaluationReceiptsValid = context.attemptReceipts.length === context.attempts.length && context.attemptReceipts.every((r, index) => {
    const a = context.attempts[index];
    return Boolean(a && verifyCircuitReceipt(r).valid && r.planHash === a.decision.planHash && r.verdict === a.decision.verdict);
  });
  add("EVALUATION_RECEIPTS", evaluationReceiptsValid, evaluationReceiptsValid ? "Every Circuit evaluation receipt recomputes and matches its plan." : "An evaluation receipt is missing, invalid, or mismatched.");

  const expectedReceiptHashes = context.attemptReceipts.map(r => r.receiptHash);
  const evaluationChainValid = stableHash(receipt.evaluationReceiptHashes) === stableHash(expectedReceiptHashes)
    && receipt.evaluationHash === expectedReceiptHashes.at(-1)
    && receipt.previousReceiptHash === expectedReceiptHashes.at(-1);
  add("EVALUATION_CHAIN", evaluationChainValid, evaluationChainValid ? "The judge receipt links the complete evaluation receipt chain." : "The evaluation receipt chain is broken.");

  const finalAttempt = context.attempts.at(-1);
  const trades = context.onchain?.trades ?? [];
  const tradesValid = Boolean(context.onchain?.ok && finalAttempt && trades.length === finalAttempt.plan.intents.length && trades.every((trade, index) => {
    const intent = finalAttempt.plan.intents[index];
    return Boolean(intent && trade.status === 1 && trade.txHash.length === 66 && trade.authorizationHash.length === 66
      && trade.intentHash === traceIntentHashFor(context.traceId, finalAttempt.plan.id, index + 1, intent.assetId, intent.side, intent.notionalUsd));
  }));
  add("ONCHAIN_TRANSACTIONS", tradesValid, tradesValid ? "Every final-plan intent links to a successful X Layer transaction." : "Transaction evidence is incomplete or does not match the final plan.");

  const readbackValid = context.onchain?.readback !== undefined && stableHash(context.onchain.readback) === receipt.onchainReadbackHash;
  add("ONCHAIN_READBACK", readbackValid, readbackValid ? "The onchain readback hash matches the judge receipt." : "The onchain readback is missing or mismatched.");

  const headline = trades[0];
  const headlineValid = Boolean(headline && receipt.intentHash === headline.intentHash && receipt.authorizationHash === headline.authorizationHash && receipt.transactionHash === headline.txHash);
  add("HEADLINE_TRANSACTION", headlineValid, headlineValid ? "Headline execution fields match the first verified trade." : "Headline execution fields do not match the trade evidence.");
  return { valid: checks.every(check => check.valid), checks };
}
