import { evaluatePlan } from "./mandate.js";
import type {
  AgentPlan,
  MarketAsset,
  PlanDecision,
  PlanViolation,
  PlannerErrorCode,
  PlanningAttempt,
  PlanningRunResult,
  PlanningRunStatus,
  PortfolioMandate,
  PortfolioState,
} from "./types.js";

export interface GeneratePlanContext {
  attempt: number;
  objective: string;
  availableCapitalUsd: number;
  portfolio: PortfolioState;
  market: MarketAsset[];
  revisionOf?: string;
  violations: PlanViolation[];
}

export interface RunPlanningLoopInput {
  objective: string;
  portfolio: PortfolioState;
  mandate: PortfolioMandate;
  market: MarketAsset[];
  maxReplans: number;
  generatePlan: (context: GeneratePlanContext) => Promise<AgentPlan>;
}

export function isPlannerError(error: unknown): error is Error & { code: PlannerErrorCode } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

export function runStatusForError(error: unknown): { status: PlanningRunStatus; errorCode: PlannerErrorCode | string; errorMessage: string } {
  if (isPlannerError(error)) return { status: error.code === "AI_UNAVAILABLE" ? "AI_UNAVAILABLE" : "AI_ERROR", errorCode: error.code, errorMessage: error.message };
  return { status: "AI_ERROR", errorCode: "AI_PROVIDER_ERROR", errorMessage: error instanceof Error ? error.message : String(error) };
}

export async function runPlanningLoop(input: RunPlanningLoopInput): Promise<PlanningRunResult> {
  const { objective, portfolio, mandate, market, maxReplans, generatePlan } = input;
  const attempts: PlanningAttempt[] = [];
  let violations: PlanViolation[] = [];
  let revisionOf: string | undefined;
  let lastDecision: PlanDecision | undefined;

  for (let attempt = 1; attempt <= 1 + Math.max(0, maxReplans); attempt++) {
    let plan: AgentPlan;
    try {
      plan = await generatePlan({
        attempt,
        objective,
        availableCapitalUsd: portfolio.cashUsd,
        portfolio,
        market,
        revisionOf,
        violations,
      });
    } catch (error) {
      return { ...runStatusForError(error), allowed: false, verdict: "BLOCKED", attempts, finalDecision: lastDecision };
    }

    const decision = evaluatePlan(plan, portfolio, mandate, market, new Date().toISOString());
    attempts.push({ attempt, plan, decision, ...(revisionOf ? { revisionOf } : {}) });
    lastDecision = decision;

    if (decision.allowed) {
      return { status: "AUTHORIZED", allowed: true, verdict: "AUTHORIZED", attempts, finalDecision: decision };
    }

    violations = decision.violations;
    revisionOf = plan.id;
  }

  return {
    status: "EXHAUSTED",
    allowed: false,
    verdict: "BLOCKED",
    attempts,
    finalDecision: lastDecision,
    errorCode: "MAX_REPLANS_EXCEEDED",
    errorMessage: `Circuit blocked every plan within the ${1 + Math.max(0, maxReplans)}-attempt budget. No state was committed.`,
  };
}
