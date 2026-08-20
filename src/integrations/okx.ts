import { createHmac } from "node:crypto";
import dns from "node:dns";
import type { MarketAsset } from "../competition/types.js";

export const OKX_BASE_URL = process.env.OKX_BASE_URL ?? "https://web3.okx.com";
export const OKX_DEFAULT_TIMEOUT_MS = Number(process.env.OKX_TIMEOUT_MS ?? 8000);

const OKX_PINNED_IPS = (process.env.OKX_PINNED_IPS ?? "").split(",").map(s => s.trim()).filter(Boolean);
const OKX_HOST = new URL(OKX_BASE_URL).hostname;

if (OKX_PINNED_IPS.length > 0) {
  type LookupFn = (hostname: string, options: unknown, callback?: unknown) => unknown;
  const originalLookup = dns.lookup.bind(dns) as LookupFn;
  (dns as unknown as { lookup: LookupFn }).lookup = (hostname: string, options: unknown, callback?: unknown) => {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    if (callback && hostname === OKX_HOST) {
      const all = Boolean((options as { all?: boolean } | undefined)?.all);
      if (all) {
        (callback as (err: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => void)(null, OKX_PINNED_IPS.map(address => ({ address, family: 4 })));
      } else {
        (callback as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(null, OKX_PINNED_IPS[0] as string, 4);
      }
      return;
    }
    return originalLookup(hostname, options, callback);
  };
}

export type OkxState = "LIVE" | "UNAVAILABLE" | "MISCONFIGURED" | "UNSUPPORTED";

export type MarketContext = {
  asset: string;
  chainId: number;
  price?: string;
  quoteTimestamp: number;
  referenceAgeSeconds?: number;
  expectedSlippageBps?: number;
  liquidity?: string;
  provider: "OKX";
  rawReferenceId?: string;
};

export interface OkxContextEntry {
  state: OkxState;
  stateCode?: string;
  stateDetail?: string;
  context?: MarketContext;
}

export interface OkxMarketContextResult {
  state: OkxState;
  fetchedAt: number;
  provider: "OKX";
  baseUrl: string;
  entries: Record<string, OkxContextEntry>;
  paymentRequired?: boolean;
  error?: string;
}

export class OkxError extends Error {
  readonly state: Exclude<OkxState, "LIVE" | "UNSUPPORTED">;
  readonly code: string;
  readonly httpStatus?: number;
  readonly x402?: unknown;
  constructor(state: Exclude<OkxState, "LIVE" | "UNSUPPORTED">, code: string, message: string, options: { httpStatus?: number; x402?: unknown } = {}) {
    super(message);
    this.name = "OkxError";
    this.state = state;
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.x402 = options.x402;
  }
}

export interface OkxAssetReference {
  symbol: string;
  chainIndex: string;
  contractAddress: string;
}

const DOCS_RWA_REFERENCE = "https://web3.okx.com/onchainos/dev-docs/market/market-rwa-token";

function referenceFor(assetId: string): OkxAssetReference | undefined {
  const overrides: Record<string, string> = {
    tslax: process.env.OKX_TSLAX_ADDRESS ?? "",
    googlx: process.env.OKX_GOOGLX_ADDRESS ?? "",
    mstrx: process.env.OKX_MSTRX_ADDRESS ?? "",
  };
  const documented: Record<string, OkxAssetReference> = {
    tslax: { symbol: "TSLAx", chainIndex: "1", contractAddress: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0" },
    googlx: { symbol: "GOOGLx", chainIndex: "1", contractAddress: "0xe92f673ca36c5e2efd2de7628f815f84807e803f" },
    mstrx: { symbol: "MSTRx", chainIndex: "1", contractAddress: "0xae2f842ef90c0d5213259ab82639d5bbf649b08e" },
  };
  const base = documented[assetId];
  const override = overrides[assetId];
  if (!base) return undefined;
  return override ? { ...base, contractAddress: override } : base;
}

export function okxConfigured(): boolean {
  return Boolean(process.env.OKX_API_KEY && process.env.OKX_SECRET_KEY && process.env.OKX_PASSPHRASE);
}

function credentials(): { apiKey: string; secret: string; passphrase: string } {
  const apiKey = process.env.OKX_API_KEY;
  const secret = process.env.OKX_SECRET_KEY;
  const passphrase = process.env.OKX_PASSPHRASE;
  if (!apiKey || !secret || !passphrase) {
    throw new OkxError("MISCONFIGURED", "OKX_MISSING_CREDENTIALS", "OKX UNAVAILABLE FOR LIVE USE — OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE are required. Fixture data is never substituted for live market data.");
  }
  return { apiKey, secret, passphrase };
}

export function signRequest(timestamp: string, method: string, pathWithQuery: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${method.toUpperCase()}${pathWithQuery}${body}`).digest("base64");
}

interface OkxHttpOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export async function okxFetch(method: "GET" | "POST", pathWithQuery: string, options: OkxHttpOptions = {}): Promise<{ code: string; msg?: string; data: unknown }> {
  const { apiKey, secret, passphrase } = credentials();
  const timeoutMs = options.timeoutMs ?? OKX_DEFAULT_TIMEOUT_MS;
  const rawBody = options.body === undefined ? "" : JSON.stringify(options.body);
  const doFetch = async (): Promise<Response> => {
    const timestamp = new Date().toISOString();
    const signature = signRequest(timestamp, method, pathWithQuery, rawBody, secret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await (options.fetchFn ?? fetch)(`${OKX_BASE_URL}${pathWithQuery}`, {
        method,
        headers: {
          "OK-ACCESS-KEY": apiKey,
          "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-TIMESTAMP": timestamp,
          "OK-ACCESS-PASSPHRASE": passphrase,
          ...(rawBody ? { "content-type": "application/json" } : {}),
        },
        body: rawBody || undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response: Response;
  try {
    response = await doFetch();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new OkxError("UNAVAILABLE", "OKX_TIMEOUT", `OKX request timed out after ${timeoutMs}ms.`);
    }
    try {
      response = await doFetch();
    } catch (retryError) {
      if (retryError instanceof Error && retryError.name === "AbortError") {
        throw new OkxError("UNAVAILABLE", "OKX_TIMEOUT", `OKX request timed out after ${timeoutMs}ms.`);
      }
      throw new OkxError("UNAVAILABLE", "OKX_NETWORK_ERROR", `OKX Onchain OS is unreachable: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
    }
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OkxError("UNAVAILABLE", "OKX_MALFORMED_RESPONSE", `OKX returned a non-JSON response (HTTP ${response.status}).`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new OkxError("MISCONFIGURED", "OKX_AUTH_REJECTED", "OKX MISCONFIGURED — the API key was rejected. Check OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE.", { httpStatus: response.status });
  }
  if (response.status === 402) {
    throw new OkxError("UNAVAILABLE", "OKX_PAYMENT_REQUIRED", "OKX requires x402 payment for this endpoint. The monthly free quota may be exhausted.", { httpStatus: response.status, x402: payload });
  }
  if (response.status === 429) {
    throw new OkxError("UNAVAILABLE", "OKX_RATE_LIMITED", "OKX rate limit exceeded.", { httpStatus: response.status });
  }
  if (!response.ok) {
    throw new OkxError("UNAVAILABLE", "OKX_HTTP_ERROR", `OKX request failed with HTTP ${response.status}.`, { httpStatus: response.status });
  }

  if (typeof payload === "object" && payload !== null && (payload as { code?: unknown }).code === "50103") {
    throw new OkxError("MISCONFIGURED", "OKX_AUTH_REJECTED", "OKX MISCONFIGURED — request header OK-ACCESS-KEY can not be empty.");
  }
  return payload as { code: string; msg?: string; data: unknown };
}

function parseInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeIndexPrice(item: unknown, fetchedAt: number): MarketContext | undefined {
  const entry = item as { price?: string; time?: string; chainIndex?: string; tokenContractAddress?: string };
  if (!entry || typeof entry !== "object") return undefined;
  const quoteTimestamp = parseInteger(entry.time);
  if (quoteTimestamp === undefined) return undefined;
  const price = entry.price && entry.price !== "" ? entry.price : undefined;
  const chainId = parseInteger(entry.chainIndex);
  const context: MarketContext = {
    asset: entry.tokenContractAddress ?? "unknown",
    chainId: chainId ?? 0,
    quoteTimestamp,
    referenceAgeSeconds: Math.max(0, Math.round((fetchedAt - quoteTimestamp) / 1000)),
    provider: "OKX",
    rawReferenceId: `index-price:${entry.chainIndex ?? "?"}:${entry.tokenContractAddress ?? "?"}`,
  };
  if (price) context.price = price;
  return context;
}

async function getOkxIndexPrices(assetIds: string[], fetchedAt: number, fetchFn?: typeof fetch, timeoutMs?: number): Promise<Map<string, { context?: MarketContext; error?: OkxError }>> {
  const results = new Map<string, { context?: MarketContext; error?: OkxError }>();
  const batch: { chainIndex: string; tokenContractAddress: string }[] = [];
  const byAddress = new Map<string, string>();
  for (const assetId of assetIds) {
    const ref = referenceFor(assetId);
    if (!ref) continue;
    batch.push({ chainIndex: ref.chainIndex, tokenContractAddress: ref.contractAddress });
    byAddress.set(ref.contractAddress.toLowerCase(), assetId);
  }
  if (batch.length === 0) return results;
  try {
    const payload = await okxFetch("POST", "/api/v6/dex/index/current-price", { body: batch, fetchFn, timeoutMs });
    if (payload.code !== "0") {
      const error = new OkxError("UNAVAILABLE", "OKX_API_ERROR", `OKX index-price error ${payload.code}: ${payload.msg ?? "unknown"}`);
      for (const assetId of assetIds) results.set(assetId, { error });
      return results;
    }
    const list = Array.isArray(payload.data) ? payload.data : [];
    const byResponseAddress = new Map<string, unknown>();
    for (const item of list) {
      const address = String((item as { tokenContractAddress?: string }).tokenContractAddress ?? "").toLowerCase();
      if (address) byResponseAddress.set(address, item);
    }
    for (const assetId of assetIds) {
      const ref = referenceFor(assetId);
      if (!ref) continue;
      const item = byResponseAddress.get(ref.contractAddress.toLowerCase());
      const context = item ? normalizeIndexPrice(item, fetchedAt) : undefined;
      if (context) {
        const symbol = referenceFor(assetId)?.symbol ?? assetId;
        context.asset = symbol;
        results.set(assetId, { context });
      } else {
        results.set(assetId, { error: new OkxError("UNAVAILABLE", "OKX_NO_QUOTE", "OKX returned no index price for this asset.") });
      }
    }
  } catch (error) {
    if (error instanceof OkxError) {
      for (const assetId of assetIds) results.set(assetId, { error });
    } else {
      for (const assetId of assetIds) results.set(assetId, { error: new OkxError("UNAVAILABLE", "OKX_NETWORK_ERROR", String(error)) });
    }
  }
  return results;
}

async function getOkxRwaLiquidity(fetchFn?: typeof fetch, timeoutMs?: number): Promise<{ liquidityBySymbol: Map<string, string>; error?: OkxError }> {
  const liquidityBySymbol = new Map<string, string>();
  try {
    const payload = await okxFetch("GET", "/api/v6/dex/market/rwa/tokens?chainIndex=1&limit=100", { fetchFn, timeoutMs });
    if (payload.code !== "0") return { liquidityBySymbol, error: new OkxError("UNAVAILABLE", "OKX_API_ERROR", `OKX rwa-tokens error ${payload.code}: ${payload.msg ?? "unknown"}`) };
    const data = payload.data as { list?: { tokenSymbol?: string; volume24h?: string }[] };
    for (const token of data?.list ?? []) {
      if (token?.tokenSymbol && token?.volume24h) liquidityBySymbol.set(String(token.tokenSymbol), String(token.volume24h));
    }
  } catch (error) {
    return { liquidityBySymbol, error: error instanceof OkxError ? error : new OkxError("UNAVAILABLE", "OKX_NETWORK_ERROR", String(error)) };
  }
  return { liquidityBySymbol };
}

async function estimateSlippageBps(assetId: string, fetchFn?: typeof fetch, timeoutMs?: number): Promise<number | undefined> {
  const ref = referenceFor(assetId);
  if (!ref) return undefined;
  const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  try {
    const params = new URLSearchParams({ chainIndex: ref.chainIndex, amount: "1000000000", fromTokenAddress: usdc, toTokenAddress: ref.contractAddress });
    const payload = await okxFetch("GET", `/api/v6/dex/aggregator/quote?${params.toString()}`, { fetchFn, timeoutMs });
    if (payload.code !== "0") return undefined;
    const data = payload.data as { priceImpactPercent?: string }[];
    const route = Array.isArray(data) ? data[0] : undefined;
    const impact = route?.priceImpactPercent;
    if (impact === undefined || impact === "") return undefined;
    const impactNumber = Number(impact);
    if (!Number.isFinite(impactNumber)) return undefined;
    return Math.max(0, Math.round(-impactNumber * 100));
  } catch {
    return undefined;
  }
}

export async function fetchOkxMarketContext(assetIds: string[], options: { timeoutMs?: number; fetchFn?: typeof fetch } = {}): Promise<OkxMarketContextResult> {
  const fetchedAt = Date.now();
  const entries: Record<string, OkxContextEntry> = {};
  const timeoutMs = options.timeoutMs ?? OKX_DEFAULT_TIMEOUT_MS;

  if (!okxConfigured()) {
    for (const assetId of assetIds) {
      const ref = referenceFor(assetId);
      entries[assetId] = ref
        ? { state: "MISCONFIGURED", stateCode: "OKX_MISSING_CREDENTIALS", stateDetail: "OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE are not configured. Live market data is unavailable; fixtures are never substituted." }
        : { state: "UNSUPPORTED", stateCode: "OKX_ASSET_UNKNOWN", stateDetail: `${assetId} has no OKX Onchain OS asset reference.` };
    }
    return { state: "MISCONFIGURED", fetchedAt, provider: "OKX", baseUrl: OKX_BASE_URL, entries };
  }

  let paymentRequired = false;
  let errorDetail: string | undefined;

  const priceResults = await getOkxIndexPrices(assetIds, fetchedAt, options.fetchFn, timeoutMs);
  for (const assetId of assetIds) {
    const ref = referenceFor(assetId);
    if (!ref) {
      entries[assetId] = { state: "UNSUPPORTED", stateCode: "OKX_ASSET_UNKNOWN", stateDetail: `${assetId} has no OKX Onchain OS asset reference. Support is never fabricated.` };
      continue;
    }
    const result = priceResults.get(assetId);
    if (result?.context) {
      entries[assetId] = { state: "LIVE", context: { ...result.context, asset: ref.symbol, rawReferenceId: `index-price:${ref.chainIndex}:${ref.contractAddress}` } };
    } else if (result?.error) {
      if (result.error.code === "OKX_PAYMENT_REQUIRED") paymentRequired = true;
      entries[assetId] = { state: result.error.state, stateCode: result.error.code, stateDetail: result.error.message };
      if (result.error.state === "MISCONFIGURED") errorDetail ??= result.error.message;
    } else {
      entries[assetId] = { state: "UNAVAILABLE", stateCode: "OKX_NO_QUOTE", stateDetail: "OKX returned no market data for this asset." };
    }
  }

  const rwa = await getOkxRwaLiquidity(options.fetchFn, timeoutMs);
  if (rwa.error?.code === "OKX_PAYMENT_REQUIRED") paymentRequired = true;
  for (const assetId of assetIds) {
    const ref = referenceFor(assetId);
    const entry = entries[assetId];
    if (!ref || !entry?.context) continue;
    const volume = rwa.liquidityBySymbol.get(ref.symbol);
    if (volume) entry.context.liquidity = volume;
  }

  for (const assetId of assetIds) {
    const entry = entries[assetId];
    if (entry?.state !== "LIVE" || !entry.context) continue;
    const slippage = await estimateSlippageBps(assetId, options.fetchFn, timeoutMs);
    if (slippage !== undefined) entry.context.expectedSlippageBps = slippage;
  }

  const liveCount = assetIds.filter(id => entries[id]?.state === "LIVE").length;
  const unsupportedCount = assetIds.filter(id => entries[id]?.state === "UNSUPPORTED").length;
  const state: OkxState = liveCount > 0 ? "LIVE" : assetIds.length > 0 && unsupportedCount === assetIds.length ? "UNSUPPORTED" : errorDetail ? "MISCONFIGURED" : "UNAVAILABLE";

  return {
    state,
    fetchedAt,
    provider: "OKX",
    baseUrl: OKX_BASE_URL,
    entries,
    ...(paymentRequired ? { paymentRequired } : {}),
    ...(errorDetail ? { error: errorDetail } : {}),
  };
}

export interface OkxCandle {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeUsd: number;
  confirm: number;
}

export type CandleRange = "1H" | "4H" | "1D" | "1W" | "1M";

export interface OkxRwaInstrument {
  asset: string;
  symbol: string;
  issuer: string;
  chainIndex: string;
  chainLabel: string;
  tokenContractAddress: string;
}

export const OKX_RWA_INSTRUMENTS: Record<string, OkxRwaInstrument> = {
  tslax: { asset: "tslax", symbol: "TSLAx", issuer: "TESLA INC.", chainIndex: "196", chainLabel: "X LAYER MAINNET", tokenContractAddress: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0" },
  googlx: { asset: "googlx", symbol: "GOOGLx", issuer: "ALPHABET INC.", chainIndex: "196", chainLabel: "X LAYER MAINNET", tokenContractAddress: "0xe92f673ca36c5e2efd2de7628f815f84807e803f" },
  mstrx: { asset: "mstrx", symbol: "MSTRx", issuer: "STRATEGY INC.", chainIndex: "196", chainLabel: "X LAYER MAINNET", tokenContractAddress: "0xae2f842ef90c0d5213259ab82639d5bbf649b08e" },
};

export function rangeToBar(range: CandleRange): { bar: string; limit: number } {
  switch (range) {
    case "1H": return { bar: "1m", limit: 120 };
    case "4H": return { bar: "5m", limit: 96 };
    case "1D": return { bar: "15m", limit: 96 };
    case "1W": return { bar: "1H", limit: 168 };
    case "1M": return { bar: "1D", limit: 31 };
  }
}

function normalizeCandle(item: unknown): OkxCandle | undefined {
  if (!Array.isArray(item) || item.length < 8) return undefined;
  const timestampMs = Number(item[0]);
  const open = Number(item[1]);
  const high = Number(item[2]);
  const low = Number(item[3]);
  const close = Number(item[4]);
  const volume = Number(item[5]);
  const volumeUsd = Number(item[6]);
  const confirm = Number(item[7]);
  if (!Number.isFinite(timestampMs) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return undefined;
  return { timestampMs, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0, volumeUsd: Number.isFinite(volumeUsd) ? volumeUsd : 0, confirm: Number.isFinite(confirm) ? confirm : 0 };
}

export async function getOkxCandles(input: {
  asset: string;
  range: CandleRange;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): Promise<{ ok: true; candles: OkxCandle[]; instrument: OkxRwaInstrument; bar: string } | { ok: false; code: string; message: string; instrument?: OkxRwaInstrument }> {
  const instrument = OKX_RWA_INSTRUMENTS[String(input.asset).toLowerCase()];
  if (!instrument) return { ok: false, code: "UNSUPPORTED_ASSET", message: `${input.asset} has no OKX market instrument. Support is never fabricated.` };
  const { bar, limit } = rangeToBar(input.range);
  try {
    const params = new URLSearchParams({ chainIndex: instrument.chainIndex, tokenContractAddress: instrument.tokenContractAddress, bar, limit: String(limit) });
    const payload = await okxFetch("GET", `/api/v6/dex/market/candles?${params.toString()}`, { fetchFn: input.fetchFn, timeoutMs: input.timeoutMs });
    if (payload.code !== "0") return { ok: false, code: "OKX_API_ERROR", message: `OKX candles error ${payload.code}: ${payload.msg ?? "unknown"}`, instrument };
    const candles = (Array.isArray(payload.data) ? payload.data : []).map(normalizeCandle).filter((c): c is OkxCandle => c !== undefined);
    return { ok: true, candles, instrument, bar };
  } catch (error) {
    if (error instanceof OkxError) return { ok: false, code: error.code, message: error.message, instrument };
    return { ok: false, code: "OKX_NETWORK_ERROR", message: error instanceof Error ? error.message : String(error), instrument };
  }
}

export function marketContextForAgent(result: OkxMarketContextResult): unknown[] {  return Object.entries(result.entries).map(([assetId, entry]) => ({
    assetId,
    state: entry.state,
    ...(entry.stateCode ? { stateCode: entry.stateCode } : {}),
    ...(entry.stateDetail ? { stateDetail: entry.stateDetail } : {}),
    ...(entry.context ?? {}),
  }));
}

export function buildLiveMarket(result: OkxMarketContextResult, baseMarket: MarketAsset[]): MarketAsset[] {
  const byAsset = new Map(baseMarket.map(a => [a.assetId, a]));
  const market: MarketAsset[] = [];
  for (const [assetId, entry] of Object.entries(result.entries)) {
    const base = byAsset.get(assetId);
    if (!base) continue;
    if (entry.state === "UNSUPPORTED") continue;
    const live = entry.state === "LIVE" && entry.context;
    const priceUsd = live && entry.context?.price !== undefined && entry.context.price !== "" ? Number(entry.context.price) : 0;
    market.push({
      ...base,
      priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0,
      referenceFreshnessMinutes: live ? Math.max(0, Math.round((entry.context?.referenceAgeSeconds ?? 0) / 60)) : Number.MAX_SAFE_INTEGER,
      marketSession: live ? "open" : "unknown",
      materialEvent: false,
      source: "okx",
      observedAt: live ? new Date(entry.context?.quoteTimestamp ?? result.fetchedAt).toISOString() : new Date(result.fetchedAt).toISOString(),
    });
  }
  return market;
}
