import { PlannerError, normalizeLivePlan, parseLivePlanJson } from "../dist/competition/agent-plan.js";
import { stableHash } from "../dist/core/hash.js";

const schema = {
  type: "object",
  properties: {
    planId: { type: "string" },
    intents: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: {
      assetId: { type: "string" }, symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] },
      notionalUsd: { type: "number", minimum: 0.01 }, expectedSlippageBps: { type: "number", minimum: 0 }, rationale: { type: "string" }
    }, required: ["assetId", "symbol", "side", "notionalUsd", "expectedSlippageBps", "rationale"], additionalProperties: false } },
    allocationRationale: { type: "string" },
    expectedAllocation: { type: "object", properties: {
      cashUsd: { type: "number" }, holdings: { type: "array", minItems: 1, items: { type: "object", properties: {
        assetId: { type: "string" }, symbol: { type: "string" }, notionalUsd: { type: "number" }, pctNav: { type: "number" }
      }, required: ["assetId", "symbol", "notionalUsd", "pctNav"], additionalProperties: false } }
    }, required: ["cashUsd", "holdings"], additionalProperties: false },
    assumptions: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } }
  },
  required: ["planId", "intents", "allocationRationale", "expectedAllocation", "assumptions"],
  additionalProperties: false
};

const BASE_URL = "https://openrouter.ai/api/v1";

export function aiProviderInfo() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  return {
    name: "openrouter",
    label: "OpenRouter",
    baseUrl: BASE_URL,
    endpoint: "chat/completions",
    model: model || null,
    key: key || null,
    configured: Boolean(key && model),
    error: !key ? "OPENROUTER_API_KEY is not configured." : !model ? "OPENROUTER_MODEL is not configured." : null,
  };
}

function normalizeMarket(market) {
  return market.map(asset => ({
    assetId: asset.assetId, symbol: asset.symbol, name: asset.name, issuerName: asset.issuerName,
    sectorName: asset.sectorName, category: asset.category, priceUsd: asset.priceUsd,
    change24hPct: asset.change24hPct, liquidityUsd: asset.liquidityUsd,
    referenceFreshnessMinutes: asset.referenceFreshnessMinutes, marketSession: asset.marketSession,
    materialEvent: asset.materialEvent, source: asset.source, observedAt: asset.observedAt
  }));
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) {
    if (error?.name === "AbortError") throw new PlannerError("AI_TIMEOUT", `OpenRouter planning timed out after ${timeoutMs}ms.`);
    throw error;
  } finally { clearTimeout(timer); }
}

function headers(provider) {
  return {
    authorization: `Bearer ${provider.key}`,
    "content-type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:4184",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Circuit",
  };
}

async function providerJson(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new PlannerError("AI_UNAVAILABLE", `${label} rejected the configured key. Live mode never falls back to fixtures.`);
    const providerDetail = body?.error?.metadata?.raw || body?.error?.metadata?.provider_name || body?.error?.metadata?.provider || "";
    const message = body?.error?.message || `${label} request failed with HTTP ${response.status}.`;
    throw new PlannerError("AI_PROVIDER_ERROR", providerDetail ? `${message}: ${String(providerDetail).slice(0, 600)}` : message);
  }
  return body;
}

async function verifyGeneration(provider, generationId, requestedModel, timeoutMs) {
  const url = `${provider.baseUrl}/generation?id=${encodeURIComponent(generationId)}`;
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const body = await providerJson(await fetchWithTimeout(url, { headers: headers(provider) }, timeoutMs), provider.label);
      const data = body?.data;
      if (!data || data.id !== generationId) throw new Error("generation metadata did not match the response id");
      return {
        metadataVerified: true,
        metadataVerifiedAt: new Date().toISOString(),
        resolvedModel: String(data.model || requestedModel),
        upstreamProvider: data.provider_name ? String(data.provider_name) : undefined,
        requestId: data.request_id ? String(data.request_id) : undefined,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new PlannerError("AI_PROVIDER_ERROR", `OpenRouter generation metadata verification failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function planWithOpenRouter({ mandate, portfolio, market, objective, violations = [], attempt = 1, revisionOf, timeoutMs = 20_000, okxMarketContext }) {
  const provider = aiProviderInfo();
  if (!provider.configured) throw new PlannerError("AI_UNAVAILABLE", `AI UNAVAILABLE: ${provider.error} Live AI never falls back to fixture output.`);

  const system = [
    "You are Circuit's autonomous RWA portfolio planning agent.",
    "You propose trades. Circuit alone authorizes them.",
    "Use only supplied assets and current portfolio facts.",
    "Never fabricate market facts or predict Circuit's verdict.",
    "Include only executable BUY or SELL intents with notionalUsd greater than zero. Omit zero-value trades.",
    "When rejection feedback exists, revise the plan to address every rejection while preserving the objective.",
    "Do not include reasoning or commentary.",
    "Return only the required structured JSON."
  ].join(" ");
  const firstPass = violations.length === 0;
  const base = {
    objective: objective ?? mandate.objective, mandateId: mandate.id, navUsd: mandate.navUsd,
    availableCapitalUsd: portfolio.cashUsd, portfolio,
    marketProvider: okxMarketContext ? "OKX" : "fixture",
    marketContext: okxMarketContext ?? normalizeMarket(market),
    note: okxMarketContext
      ? "Market context comes from OKX Onchain OS. Never substitute fixture prices. Circuit evaluates the plan independently."
      : "FIXTURE MARKET DATA. Circuit evaluates the plan independently."
  };
  const payload = firstPass ? { ...base, attempt } : { ...base, attempt, revisionOf, circuitRejections: violations, activeMandateLimits: {
    allowedAssetIds: mandate.allowedAssetIds, allowedAssetClasses: mandate.allowedAssetClasses,
    maxAssetExposurePctNav: mandate.maxAssetExposurePctNav, maxIssuerExposurePctNav: mandate.maxIssuerExposurePctNav,
    maxSectorExposurePctNav: mandate.maxSectorExposurePctNav, maxInvestedPctNav: mandate.maxInvestedPctNav,
    maxDailyTurnoverPctNav: mandate.maxDailyTurnoverPctNav, maxSlippageBps: mandate.maxSlippageBps,
    maxReferenceFreshnessMinutes: mandate.maxReferenceFreshnessMinutes, closedMarketMaxBuyUsd: mandate.closedMarketMaxBuyUsd,
    materialEventMaxBuyUsd: mandate.materialEventMaxBuyUsd
  } };
  const requestBody = {
    model: provider.model,
    messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }],
    response_format: { type: "json_schema", json_schema: { name: "circuit_agent_plan", strict: true, schema } },
    reasoning: { effort: "low", exclude: true },
    max_tokens: 4000,
  };

  let body;
  try {
    body = await providerJson(await fetchWithTimeout(`${provider.baseUrl}/${provider.endpoint}`, {
      method: "POST", headers: headers(provider), body: JSON.stringify(requestBody)
    }, timeoutMs), provider.label);
  } catch (error) {
    if (error instanceof PlannerError) throw error;
    throw new PlannerError("AI_PROVIDER_ERROR", error instanceof Error ? error.message : String(error));
  }
  const messageContent = body?.choices?.[0]?.message?.content;
  const rawCompletion = typeof messageContent === "string"
    ? messageContent
    : Array.isArray(messageContent)
      ? messageContent.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("")
      : null;
  if (typeof rawCompletion !== "string" || rawCompletion.length === 0) throw new PlannerError("AI_MALFORMED_OUTPUT", "OpenRouter returned no message content.");
  const raw = parseLivePlanJson(rawCompletion);
  const generationId = String(body.id || "");
  if (!generationId) throw new PlannerError("AI_MALFORMED_OUTPUT", "OpenRouter returned no generation id.");
  const verified = await verifyGeneration(provider, generationId, provider.model, timeoutMs);
  const generatedAt = Number.isFinite(body.created) ? new Date(body.created * 1000).toISOString() : new Date().toISOString();
  const provenance = {
    provider: "openrouter",
    generationId,
    requestedModel: provider.model,
    resolvedModel: verified.resolvedModel,
    ...(verified.upstreamProvider ? { upstreamProvider: verified.upstreamProvider } : {}),
    ...(verified.requestId ? { requestId: verified.requestId } : {}),
    requestHash: stableHash(requestBody),
    completionHash: stableHash(rawCompletion),
    normalizedOutputHash: stableHash(raw),
    rawCompletion,
    finishReason: String(body?.choices?.[0]?.finish_reason || "unknown"),
    ...(Number.isFinite(body?.usage?.prompt_tokens) ? { promptTokens: body.usage.prompt_tokens } : {}),
    ...(Number.isFinite(body?.usage?.completion_tokens) ? { completionTokens: body.usage.completion_tokens } : {}),
    generatedAt,
    metadataVerifiedAt: verified.metadataVerifiedAt,
    metadataVerified: true,
  };
  const plan = normalizeLivePlan(raw, mandate.id, revisionOf, verified.resolvedModel, provenance);
  plan.objective = objective ?? mandate.objective;
  return plan;
}
