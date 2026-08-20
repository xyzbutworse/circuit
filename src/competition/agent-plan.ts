import type { AgentPlan, AiPlanProvenance, ExpectedAllocation, PlannerErrorCode, TradeIntent } from "./types.js";

export class PlannerError extends Error {
  readonly code: PlannerErrorCode;
  constructor(code: PlannerErrorCode, message: string) {
    super(message);
    this.name = "PlannerError";
    this.code = code;
  }
}

export function parseLivePlanJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new PlannerError("AI_MALFORMED_OUTPUT", "OpenRouter output did not contain a JSON object.");
  try { return JSON.parse(trimmed.slice(start, end + 1)); }
  catch { throw new PlannerError("AI_MALFORMED_OUTPUT", "OpenRouter output was not valid JSON."); }
}

function fail(reason: string): never {
  throw new PlannerError("AI_MALFORMED_OUTPUT", `Malformed AI plan output: ${reason}`);
}

function cleanId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a non-empty string.`);
  const cleaned = value.trim().slice(0, 80);
  if (cleaned.length === 0) fail(`${label} must be a non-empty string.`);
  return cleaned;
}

function cleanNumber(value: unknown, label: string, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number.`);
  const cleaned = Math.round(value * 100) / 100;
  if (cleaned < min) fail(`${label} must be >= ${min}.`);
  return cleaned;
}

function cleanIntent(raw: unknown, index: number, planId: string): TradeIntent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(`intents[${index}] must be an object.`);
  const intent = raw as Record<string, unknown>;
  const side = intent.side;
  if (side !== "BUY" && side !== "SELL") fail(`intents[${index}].side must be BUY or SELL.`);
  const notionalUsd = cleanNumber(intent.notionalUsd, `intents[${index}].notionalUsd`, 0.01);
  return {
    id: `intent-${planId}-${index + 1}`,
    assetId: cleanId(intent.assetId, `intents[${index}].assetId`).toLowerCase(),
    symbol: cleanId(intent.symbol, `intents[${index}].symbol`).toUpperCase(),
    side,
    notionalUsd,
    expectedSlippageBps: cleanNumber(intent.expectedSlippageBps, `intents[${index}].expectedSlippageBps`),
    rationale: cleanId(intent.rationale, `intents[${index}].rationale`),
  };
}

function cleanExpectedAllocation(raw: unknown): ExpectedAllocation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("expectedAllocation must be an object.");
  const allocation = raw as Record<string, unknown>;
  const cashUsd = cleanNumber(allocation.cashUsd, "expectedAllocation.cashUsd");
  const holdings = allocation.holdings;
  if (!Array.isArray(holdings) || holdings.length === 0) fail("expectedAllocation.holdings must be a non-empty array.");
  return {
    cashUsd,
    holdings: holdings.map((holding, index) => {
      if (typeof holding !== "object" || holding === null || Array.isArray(holding)) fail(`expectedAllocation.holdings[${index}] must be an object.`);
      const h = holding as Record<string, unknown>;
      return {
        assetId: cleanId(h.assetId, `expectedAllocation.holdings[${index}].assetId`).toLowerCase(),
        symbol: cleanId(h.symbol, `expectedAllocation.holdings[${index}].symbol`).toUpperCase(),
        notionalUsd: cleanNumber(h.notionalUsd, `expectedAllocation.holdings[${index}].notionalUsd`),
        pctNav: cleanNumber(h.pctNav, `expectedAllocation.holdings[${index}].pctNav`),
      };
    }),
  };
}

function cleanAssumptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) fail("assumptions must be an array of strings.");
  const assumptions = raw.map((item, index) => cleanId(item, `assumptions[${index}]`));
  if (assumptions.length > 20) fail("assumptions must contain at most 20 items.");
  return assumptions;
}

export function normalizeLivePlan(raw: unknown, mandateId: string, revisionOf: string | undefined, model: string, provenance?: AiPlanProvenance): AgentPlan {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("output must be a JSON object.");
  const plan = raw as Record<string, unknown>;
  const planId = cleanId(plan.planId, "planId");
  const intentsRaw = plan.intents;
  if (!Array.isArray(intentsRaw) || intentsRaw.length === 0) fail("intents must be a non-empty array.");
  if (intentsRaw.length > 6) fail("intents must contain at most 6 trades.");
  const intents = intentsRaw.map((intent, index) => cleanIntent(intent, index, planId));
  return {
    id: planId,
    mandateId,
    intents,
    thesis: cleanId(plan.allocationRationale, "allocationRationale"),
    allocationRationale: cleanId(plan.allocationRationale, "allocationRationale"),
    expectedAllocation: cleanExpectedAllocation(plan.expectedAllocation),
    assumptions: cleanAssumptions(plan.assumptions),
    provider: provenance?.provider ?? "openrouter",
    model,
    generatedAt: provenance?.generatedAt ?? new Date().toISOString(),
    ...(provenance ? { provenance } : {}),
    ...(revisionOf ? { revisionOf } : {}),
  };
}
