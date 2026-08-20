export type AssetClass = "tokenized-equity" | "tokenized-etf" | "other-rwa";
export type MarketSession = "open" | "closed" | "unknown";
export type TradeSide = "BUY" | "SELL";

export interface PortfolioMandate {
  id: string;
  name: string;
  objective: string;
  navUsd: number;
  allowedAssetClasses: AssetClass[];
  allowedAssetIds: string[];
  maxAssetExposurePctNav: number;
  maxIssuerExposurePctNav: number;
  maxSectorExposurePctNav: number;
  maxInvestedPctNav: number;
  maxDailyTurnoverPctNav: number;
  maxSlippageBps: number;
  maxReferenceFreshnessMinutes: number;
  closedMarketMaxBuyUsd: number;
  materialEventMaxBuyUsd: number;
  createdAt: string;
}

export interface MarketAsset {
  assetId: string;
  symbol: string;
  name: string;
  issuerId: string;
  issuerName: string;
  sectorId: string;
  sectorName: string;
  category: AssetClass;
  contractAddress?: string;
  priceUsd: number;
  change24hPct: number;
  liquidityUsd: number;
  referenceFreshnessMinutes: number;
  marketSession: MarketSession;
  materialEvent: boolean;
  source: "okx" | "fixture";
  observedAt: string;
}

export interface PortfolioHolding {
  assetId: string;
  notionalUsd: number;
}

export interface PortfolioState {
  id: string;
  mandateId: string;
  navUsd: number;
  cashUsd: number;
  holdings: PortfolioHolding[];
  dailyTurnoverUsd: number;
  asOf: string;
}

export interface TradeIntent {
  id: string;
  assetId: string;
  symbol: string;
  side: TradeSide;
  notionalUsd: number;
  expectedSlippageBps: number;
  rationale: string;
}

export interface ExpectedHolding {
  assetId: string;
  symbol: string;
  notionalUsd: number;
  pctNav: number;
}

export interface ExpectedAllocation {
  cashUsd: number;
  holdings: ExpectedHolding[];
}

export interface AgentPlan {
  id: string;
  mandateId: string;
  intents: TradeIntent[];
  thesis: string;
  allocationRationale: string;
  expectedAllocation?: ExpectedAllocation;
  assumptions: string[];
  objective?: string;
  provider: "openrouter" | "fixture";
  model?: string;
  provenance?: AiPlanProvenance;
  generatedAt: string;
  revisionOf?: string;
}

export interface AiPlanProvenance {
  provider: "openrouter";
  generationId: string;
  requestedModel: string;
  resolvedModel: string;
  upstreamProvider?: string;
  requestId?: string;
  requestHash: string;
  completionHash: string;
  normalizedOutputHash: string;
  rawCompletion: string;
  finishReason: string;
  promptTokens?: number;
  completionTokens?: number;
  generatedAt: string;
  metadataVerifiedAt?: string;
  metadataVerified: boolean;
}

export interface ExposureSnapshot {
  investedUsd: number;
  cashUsd: number;
  dailyTurnoverUsd: number;
  assetUsd: Record<string, number>;
  issuerUsd: Record<string, number>;
  sectorUsd: Record<string, number>;
}

export type ViolationCode =
  | "UNKNOWN_ASSET"
  | "ASSET_NOT_ALLOWED"
  | "ASSET_CLASS_NOT_ALLOWED"
  | "INSUFFICIENT_CASH"
  | "INSUFFICIENT_POSITION"
  | "SLIPPAGE_BUDGET_EXCEEDED"
  | "REFERENCE_STALE"
  | "CLOSED_MARKET_BUY_LIMIT"
  | "MATERIAL_EVENT_BUY_LIMIT"
  | "ASSET_EXPOSURE_EXCEEDED"
  | "ISSUER_CONCENTRATION_EXCEEDED"
  | "SECTOR_CONCENTRATION_EXCEEDED"
  | "INVESTED_LIMIT_EXCEEDED"
  | "DAILY_TURNOVER_EXCEEDED";

export interface PlanViolation {
  code: ViolationCode;
  assetId?: string;
  bucketId?: string;
  assetSymbol?: string;
  issuer?: string;
  sector?: string;
  message: string;
  actual: number | string;
  limit: number | string;
  projectedExposureBps?: number;
  limitBps?: number;
}

export interface PlanDecision {
  allowed: boolean;
  verdict: "AUTHORIZED" | "BLOCKED";
  violations: PlanViolation[];
  checkedAt: string;
  planHash: string;
  mandateHash: string;
  beforePortfolioHash: string;
  afterPortfolioHash: string;
  before: ExposureSnapshot;
  after: ExposureSnapshot;
  afterState: PortfolioState;
}

export interface CircuitReceipt {
  id: string;
  mandateId: string;
  portfolioId: string;
  planId: string;
  planHash: string;
  mandateHash: string;
  beforePortfolioHash: string;
  afterPortfolioHash: string;
  verdict: PlanDecision["verdict"];
  violations: PlanViolation[];
  chainId: number;
  contractAddress?: string;
  txHash?: string;
  proofMode: "local" | "xlayer-testnet";
  createdAt: string;
  previousReceiptHash?: string;
  receiptHash: string;
}

export type PlannerErrorCode = "AI_UNAVAILABLE" | "AI_TIMEOUT" | "AI_MALFORMED_OUTPUT" | "AI_PROVIDER_ERROR";

export type PlanningRunStatus = "AUTHORIZED" | "EXHAUSTED" | "AI_UNAVAILABLE" | "AI_ERROR";

export interface PlanningAttempt {
  attempt: number;
  plan: AgentPlan;
  decision: PlanDecision;
  revisionOf?: string;
}

export interface PlanningRunResult {
  status: PlanningRunStatus;
  allowed: boolean;
  verdict: PlanDecision["verdict"];
  attempts: PlanningAttempt[];
  finalDecision?: PlanDecision;
  errorCode?: PlannerErrorCode | string;
  errorMessage?: string;
}

export interface PlanningTrace extends PlanningRunResult {
  id: string;
  mode: "live" | "demo";
  objective: string;
  availableCapitalUsd: number;
  mandateId: string;
  portfolioId: string;
  startedAt: string;
  endedAt: string;
  maxReplans: number;
}
