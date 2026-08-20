import { readFile } from "node:fs/promises";
import { ethers } from "ethers";
import { deploymentConfig } from "./deployment.mjs";
import { traceIntentHashFor } from "../dist/competition/judge-receipt.js";

const REGISTRY_ABI = [
  "function publisher() view returns (address)",
  "function publishMandate(bytes32 policyKey,(bytes32 mandateHash,uint64 version,uint64 validUntil,uint128 navUsdE18,uint16 maxAssetExposureBps,uint16 maxIssuerExposureBps,uint16 maxSectorExposureBps,uint16 maxInvestedBps,uint16 maxDailyTurnoverBps,uint16 maxSlippageBps,uint64 maxReferenceFreshnessSeconds,uint128 closedMarketMaxBuyUsdE18,uint128 materialEventMaxBuyUsdE18,bool enabled) params)",
];
const GUARD_ABI = [
  "function seedPortfolio(bytes32 policyKey,bytes32[] assetKeys,uint256[] notionals,uint256 initialCashUsdE18,uint256 turnoverUsdE18)",
  "function authorizeTrade(bytes32 policyKey,bytes32 intentHash,bytes32 assetKey,bool isBuy,uint256 notionalUsdE18,(uint256 expectedSlippageBps,uint256 referenceFreshnessSeconds,bool marketSessionClosed,bool materialEvent) ctx) returns (bytes32)",
  "function assetExposure(bytes32 policyKey,bytes32 assetKey) view returns (uint256)",
  "function issuerExposure(bytes32 policyKey,bytes32 issuerKey) view returns (uint256)",
  "function sectorExposure(bytes32 policyKey,bytes32 sectorKey) view returns (uint256)",
  "function totalInvested(bytes32 policyKey) view returns (uint256)",
  "function cashUsd(bytes32 policyKey) view returns (uint256)",
  "function dailyTurnover(bytes32 policyKey) view returns (uint256)",
];
const REVERT_IFACE = new ethers.Interface([
  "error ExecutionDenied(uint8 reason)",
]);

const MANDATE_HASH = ethers.id("RWA ALPHA / CONTROLLED");

async function publisherKey() {
  if (process.env.CIRCUIT_PUBLISHER_KEY) return process.env.CIRCUIT_PUBLISHER_KEY.trim();
  const file = process.env.CIRCUIT_PUBLISHER_KEY_FILE;
  if (file) return (await readFile(file, "utf8")).trim();
  return null;
}

export function onchainPublisherConfigured() {
  return Boolean(process.env.CIRCUIT_PUBLISHER_KEY || process.env.CIRCUIT_PUBLISHER_KEY_FILE);
}

function fail(status, detail, extra = {}) {
  return { status, ok: false, detail, ...extra };
}

async function gasSettings(provider) {
  const fee = await provider.getFeeData();
  const price = fee.gasPrice ?? fee.maxFeePerGas ?? 25_000_000n;
  return { maxFeePerGas: price, maxPriorityFeePerGas: price, gasLimit: 2_000_000n };
}

function e18(value) {
  return ethers.parseUnits(String(value), 18);
}

async function waitForCashReadback({ meta, guardAddress, policyKey, expectedCash, label, attempts = 12 }) {
  let lastObserved = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const fetchRequest = new ethers.FetchRequest(meta.network.rpc);
      fetchRequest.timeout = 10_000;
      fetchRequest.retries = 0;
      const readProvider = new ethers.JsonRpcProvider(fetchRequest, meta.network.chainId, { staticNetwork: true });
      const readGuard = new ethers.Contract(guardAddress, GUARD_ABI, readProvider);
      lastObserved = await readGuard.cashUsd(policyKey);
      if (lastObserved === expectedCash) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  const observed = lastObserved === null ? "unavailable" : lastObserved.toString();
  const suffix = lastError ? ` Last RPC error: ${lastError instanceof Error ? lastError.message : String(lastError)}` : "";
  throw new Error(`${label} readback did not settle. Expected cash ${expectedCash}, observed ${observed}.${suffix}`);
}

export async function runOnchainJudgePhase({ traceId, objective, mandate, plan1, plan1Hash, plan2, plan2Hash, rejectionCode, rejection, finalDecision }) {
  const key = await publisherKey();
  if (!key) return fail("ONCHAIN_UNAVAILABLE", "CIRCUIT_PUBLISHER_KEY is not configured. Onchain authorization was not attempted; nothing was committed. Configure the publisher key and run again.");

  const { meta, registry: registryAddress, guard: guardAddress } = await deploymentConfig();
  if (!registryAddress || !guardAddress) return fail("ONCHAIN_MISCONFIGURED", "No X Layer Testnet deployment addresses configured.");

  let provider;
  let wallet;
  try {
    const fetchRequest = new ethers.FetchRequest(meta.network.rpc);
    fetchRequest.timeout = 10_000;
    fetchRequest.retries = 0;
    provider = new ethers.JsonRpcProvider(fetchRequest, meta.network.chainId, { staticNetwork: true });
    wallet = new ethers.Wallet(key, provider);
  } catch (error) {
    return fail("ONCHAIN_MISCONFIGURED", `Invalid publisher key: ${error instanceof Error ? error.message : String(error)}`);
  }

  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, wallet);
  const guard = new ethers.Contract(guardAddress, GUARD_ABI, wallet);

  try {
    const publisher = await registry.publisher();
    if (String(publisher).toLowerCase() !== wallet.address.toLowerCase()) {
      return fail("ONCHAIN_MISCONFIGURED", `Publisher mismatch: guard publisher is ${publisher}, signer is ${wallet.address}. Nothing was committed.`);
    }
  } catch (error) {
    return fail("ONCHAIN_ERROR", `X Layer RPC failure while checking publisher: ${error instanceof Error ? error.message : String(error)}`);
  }

  const policyKey = ethers.keccak256(ethers.toUtf8Bytes(`circuit-judge:${traceId}`));
  const validUntil = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400);
  const navE18 = e18(mandate.navUsd);

  const mandateParams = {
    mandateHash: MANDATE_HASH,
    version: 1n,
    validUntil,
    navUsdE18: navE18,
    maxAssetExposureBps: mandate.maxAssetExposurePctNav * 100,
    maxIssuerExposureBps: mandate.maxIssuerExposurePctNav * 100,
    maxSectorExposureBps: mandate.maxSectorExposurePctNav * 100,
    maxInvestedBps: mandate.maxInvestedPctNav * 100,
    maxDailyTurnoverBps: mandate.maxDailyTurnoverPctNav * 100,
    maxSlippageBps: mandate.maxSlippageBps,
    maxReferenceFreshnessSeconds: mandate.maxReferenceFreshnessMinutes * 60,
    closedMarketMaxBuyUsdE18: e18(mandate.closedMarketMaxBuyUsd),
    materialEventMaxBuyUsdE18: e18(mandate.materialEventMaxBuyUsd),
    enabled: true,
  };

  const txs = {};
  let receipt;
  try {
    receipt = await (await registry.publishMandate(policyKey, mandateParams, await gasSettings(provider))).wait();
    if (receipt.status !== 1) return fail("ONCHAIN_ERROR", "Mandate publish reverted onchain.", { txHash: receipt.hash });
    txs.mandateTxHash = receipt.hash;
    txs.mandateBlock = receipt.blockNumber;
  } catch (error) {
    return fail("ONCHAIN_ERROR", `Mandate publish failed: ${error instanceof Error ? error.message : String(error)}`, { txs });
  }

  const assetKeys = ["tslax", "googlx", "mstrx"].map(a => ethers.id(a));
  const seededHoldings = new Map((mandate.seed?.holdings ?? [
    { assetId: "tslax", notionalUsd: 1500 },
    { assetId: "googlx", notionalUsd: 1500 },
    { assetId: "mstrx", notionalUsd: 500 },
  ]).map(h => [h.assetId, h.notionalUsd]));
  const seedAssets = ["tslax", "googlx", "mstrx"].filter(a => seededHoldings.has(a));
  const initialCash = e18(mandate.seed?.cashUsd ?? 6500);
  const initialTurnover = e18(mandate.seed?.turnoverUsd ?? 500);
  try {
    receipt = await (await guard.seedPortfolio(
      policyKey,
      seedAssets.map(a => ethers.id(a)),
      seedAssets.map(a => e18(seededHoldings.get(a))),
      initialCash,
      initialTurnover,
      await gasSettings(provider)
    )).wait();
    if (receipt.status !== 1) return fail("ONCHAIN_ERROR", "Portfolio seeding reverted onchain.", { txHash: receipt.hash, txs });
    txs.seedTxHash = receipt.hash;
    txs.seedBlock = receipt.blockNumber;
    await waitForCashReadback({ meta, guardAddress, policyKey, expectedCash: initialCash, label: "Portfolio seed" });
  } catch (error) {
    return fail("ONCHAIN_ERROR", `Portfolio seeding failed: ${error instanceof Error ? error.message : String(error)}`, { txs });
  }

  const trades = [];
  let expectedCash = initialCash;
  for (let i = 0; i < plan2.intents.length; i++) {
    const intent = plan2.intents[i];
    const assetKey = ethers.id(intent.assetId);
    const isBuy = intent.side === "BUY";
    const notionalE18 = e18(intent.notionalUsd);
    const intentHash = traceIntentHashFor(traceId, plan2.id, i + 1, intent.assetId, intent.side, intent.notionalUsd);
    const ctx = {
      expectedSlippageBps: Math.round(intent.expectedSlippageBps),
      referenceFreshnessSeconds: Math.max(0, Math.round(mandate.seed?.referenceFreshnessSeconds ?? 240)),
      marketSessionClosed: false,
      materialEvent: false,
    };
    let expectedAuthorizationHash;
    try {
      expectedAuthorizationHash = await guard.authorizeTrade.staticCall(policyKey, intentHash, assetKey, isBuy, notionalE18, ctx);
    } catch (error) {
      const revertData = error?.data ?? error?.info?.error?.data ?? null;
      const parsed = revertData ? (() => { try { return REVERT_IFACE.parseError(revertData); } catch { return null; } })() : null;
      const reason = parsed ? `${parsed.name}${parsed.args?.length ? "(" + parsed.args.map(String).join(",") + ")" : ""}` : "undecoded";
      return fail("ONCHAIN_ERROR", `Plan #2 trade ${i + 1} (${intent.symbol} ${intent.side} $${intent.notionalUsd}) was rejected by the onchain guard during pre-flight: ${reason}${revertData ? " [" + String(revertData).slice(0, 22) + "…]" : ""}`, { trades, txs, revertData });
    }
    try {
      receipt = await (await guard.authorizeTrade(policyKey, intentHash, assetKey, isBuy, notionalE18, ctx, await gasSettings(provider))).wait();
      if (receipt.status !== 1) return fail("ONCHAIN_ERROR", `Plan #2 trade ${i + 1} reverted onchain. No partial success is claimed.`, { txHash: receipt.hash, trades, txs });
      trades.push({ assetId: intent.assetId, side: intent.side, notionalUsd: intent.notionalUsd, intentHash, txHash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status, authorizationHash: expectedAuthorizationHash });
      expectedCash = isBuy ? expectedCash - notionalE18 : expectedCash + notionalE18;
      await waitForCashReadback({ meta, guardAddress, policyKey, expectedCash, label: `Plan #2 trade ${i + 1}` });
    } catch (error) {
      return fail("ONCHAIN_ERROR", `X Layer RPC failure broadcasting trade ${i + 1}: ${error instanceof Error ? error.message : String(error)}`, { trades, txs });
    }
  }

  let readback;
  try {
    readback = {
      assetUsd: Object.fromEntries(await Promise.all(["tslax", "googlx", "mstrx"].map(async a => [a, Number(await guard.assetExposure(policyKey, ethers.id(a))) / 1e18]))),
      cashUsd: Number(await guard.cashUsd(policyKey)) / 1e18,
      dailyTurnoverUsd: Number(await guard.dailyTurnover(policyKey)) / 1e18,
      totalInvested: Number(await guard.totalInvested(policyKey)) / 1e18,
    };
  } catch (error) {
    return fail("ONCHAIN_ERROR", `X Layer RPC failure while reading back authorized state: ${error instanceof Error ? error.message : String(error)}`, { trades, txs });
  }

  const projected = finalDecision.after.assetUsd;
  for (const assetId of Object.keys(projected)) {
    if (readback.assetUsd[assetId] !== projected[assetId]) {
      return fail("ONCHAIN_ERROR", `State verification failed: onchain ${assetId} exposure $${readback.assetUsd[assetId]} does not match Circuit's projected $${projected[assetId]}. No success is claimed.`, { trades, txs, readback });
    }
  }
  if (readback.cashUsd !== finalDecision.after.cashUsd || readback.totalInvested !== finalDecision.after.investedUsd) {
    return fail("ONCHAIN_ERROR", "State verification failed: onchain cash/invested does not match Circuit's projection. No success is claimed.", { trades, txs, readback });
  }

  return {
    status: "ONCHAIN_AUTHORIZED",
    ok: true,
    chainId: meta.network.chainId,
    policyKey,
    mandateHash: MANDATE_HASH,
    policyVersion: 1,
    registry: registryAddress,
    guard: guardAddress,
    publisher: wallet.address,
    txs,
    trades,
    readback,
  };
}
