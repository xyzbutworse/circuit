// RWA allocation execution integration — binds the deterministic CIRCUIT
// approval to the CircuitDemoRWAAllocation vehicle on X Layer Testnet.
// Live amounts are testnet token units, NOT USD capital.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ethers } from "ethers";
import { assetStateHash, createApproval, verifyApprovalFreshness } from "../dist/competition/rwa/approvals.js";
import { createDecisionReceipt, verifyReceipt } from "../dist/competition/rwa/receipt.js";
import { evaluateAllocation } from "../dist/competition/rwa/evaluate.js";
import { acmeAsset, alphaPortfolio, fundAlphaMandate, allocation } from "../dist/competition/rwa/scenario.js";

const RPC = process.env.XLAYER_TESTNET_RPC ?? "https://testrpc.xlayer.tech/terigon";
export const LIVE_CHAIN_ID = 1952;

const ENV = {
  deployment: null,
  meta: null,
  abi: null,
};

async function load() {
  if (ENV.abi) return;
  [ENV.deployment, ENV.meta] = await Promise.all([
    readFile(new URL("../artifacts/xlayer/deploy.json", import.meta.url), "utf8").then(JSON.parse).catch(() => null),
    readFile(new URL("../deployments/vault-xlayer-testnet.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  ENV.abi = JSON.parse(
    await readFile(new URL("../contracts/out/CircuitDemoRWAAllocation.sol/CircuitDemoRWAAllocation.json", import.meta.url), "utf8"),
  ).abi;
}

function freshProvider() {
  const fetchRequest = new ethers.FetchRequest(RPC);
  fetchRequest.timeout = 25_000;
  fetchRequest.retries = 3;
  return new ethers.JsonRpcProvider(fetchRequest, LIVE_CHAIN_ID, { staticNetwork: true });
}

function contractFor(provider, wallet) {
  return new ethers.Contract(ENV.deployment.contractAddress, ENV.abi, wallet ?? provider);
}

export const assetKeyOf = (assetId) => ethers.id(String(assetId).toLowerCase());
export const fundKeyOf = (fundId) => ethers.id(String(fundId).toLowerCase());

export const engineHashToBytes32 = (hash) => `0x${hash.replace(/^sha256:/, "")}`;

export async function liveBindings({ fundId = "portfolio-alpha-01" } = {}) {
  await load();
  if (!ENV.deployment) throw new Error("no RWA allocation deployment (run scripts/deploy-rwa-allocation.mjs)");
  const p = freshProvider();
  const c = contractFor(p);
  const registry = new ethers.Contract(ENV.deployment.registry, [
    "function getMandate(bytes32) view returns (bytes32,uint64,uint64,uint128,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint128,uint128,bool,bool)",
  ], p);
  const vault = new ethers.Contract(ENV.deployment.vault, ["function currentStateHash() view returns (bytes32)"], p);
  const fundKey = fundKeyOf(fundId);
  const [mandate, stateHash, isRegistered] = await Promise.all([
    registry.getMandate(fundKey),
    vault.currentStateHash(),
    c.registeredFunds(fundKey),
  ]);
  return {
    fundKey,
    mandateExists: mandate[14],
    mandateHash: mandate[0],
    mandateVersion: Number(mandate[1]),
    portfolioStateHash: stateHash,
    fundRegistered: isRegistered,
  };
}

const APPROVAL_TUPLE = [
  "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint64", "uint256", "uint256", "uint64", "uint256", "uint64", "bytes32",
];
const SCHEMA = "0x0000000000000000000000000000000000000000000000000000000000000001";

/** Must equal CircuitDemoRWAAllocation.approvalHashFor(). */
export function commitmentHash({
  fundKey, assetKey, assetStateHash, portfolioStateHash, mandateHash, mandateVersion,
  economicAmountUsd, liveAmountWei, chainId, nonce, expiry, approvalSubId,
}) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", ...APPROVAL_TUPLE],
      [SCHEMA, fundKey, assetKey, assetStateHash, portfolioStateHash, mandateHash, mandateVersion,
        economicAmountUsd, liveAmountWei, chainId, nonce, expiry, approvalSubId],
    ),
  );
}

export function buildOnchainApproval({ asset, portfolio, mandate, engineApproval, liveAmountWei, currentStateHash, mandateHashBytes, mandateVersion, fundId = "portfolio-alpha-01", expirySeconds = 300 }) {
  const chainId = LIVE_CHAIN_ID;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + (expirySeconds ?? 300));
  const nonce = BigInt(Date.now()) * 1000n + BigInt(engineApproval.nonce);
  return {
    fundKey: fundKeyOf(fundId),
    assetKey: assetKeyOf(asset.assetId),
    assetStateHash: engineHashToBytes32(assetStateHash(asset)),
    portfolioStateHash: currentStateHash,
    mandateHash: mandateHashBytes,
    mandateVersion,
    economicAmountUsd: BigInt(Math.round(engineApproval.amountUsd * 100)) * 10n ** 16n, // cents → 18-decimal USD
    liveAmountWei: BigInt(liveAmountWei),
    chainId,
    nonce,
    expiry,
    approvalSubId: ethers.id(engineApproval.approvalId),
  };
}

export async function readAllocationState({ assetId, fundId = "portfolio-alpha-01" } = {}) {
  await load();
  const p = freshProvider();
  const c = contractFor(p);
  const assetKey = assetKeyOf(assetId ?? "acme-inv-8842");
  const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [fundKeyOf(fundId), assetKey]));
  const [amount, total, count, asset] = await Promise.all([c.allocatedAmount(key), c.totalAllocated(), c.executionCount(), c.assets(assetKey)]);
  return {
    allocatedAmountWei: amount.toString(),
    totalAllocatedWei: total.toString(),
    executionCount: Number(count),
    asset: {
      assetId: asset[0],
      passportHash: asset[1],
      economicStateHash: asset[2],
      active: asset[3],
    },
  };
}

async function perReadAttempter() {
  await load();
  const p = freshProvider();
  return { c: contractFor(p), p };
}

/** eth_call — real chain interaction, no state change, captures the exact revert reason. */
export async function simulateExecute(struct) {
  const { c, p } = await perReadAttempter();
  const account = await c.executor();
  let est = 500_000n;
  try {
    est = await c.execute.estimateGas(struct, { from: account });
  } catch {}
  const callData = c.interface.encodeFunctionData("execute", [struct]);
  try {
    await p.call({ from: account, to: ENV.deployment.contractAddress, data: callData, gasLimit: est });
    return { outcome: "SUCCEEDS", reason: null };
  } catch (error) {
    const data = error?.data ?? error?.info?.error?.data ?? error?.error?.data;
    if (typeof data === "string" && data.startsWith("0x")) {
      try {
        const parsed = c.interface.parseError(data);
        if (parsed) return { outcome: "REVERTS", reason: parsed.name };
      } catch {}
    }
    return { outcome: "REVERTS", reason: parseRevertReason(error) };
  }
}

function parseRevertReason(error) {
  const msg = error?.shortMessage ?? error?.message ?? String(error);
  const m = msg.match(/Error: (?:execution reverted: )?([A-Za-z0-9_]+)/) ?? msg.match(/(?:reason|error)="([^"]+)"/);
  return (m?.[1] ?? msg).slice(0, 200);
}

export async function executeOnchain(struct) {
  const key = process.env.CIRCUIT_PUBLISHER_KEY?.trim();
  if (!key) throw new Error("CIRCUIT_PUBLISHER_KEY is not configured");
  const p = freshProvider();
  const wallet = new ethers.Wallet(key, p);
  const c = contractFor(p, wallet);
  const before = await readAllocationState();
  const beforeAllocated = before.allocatedAmountWei;
  let tx;
  try {
    tx = await c.execute(struct, { gasLimit: 500_000 });
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    e.message = `[executeOnchain] ${e.message}`;
    e.structFields = Object.fromEntries(Object.entries(struct).map(([k, v]) => [k, String(v)]));
    throw e;
  }
  const receipt = await tx.wait();
  let after = await readAllocationState();
  for (let i = 0; i < 5 && !(BigInt(after.allocatedAmountWei) > BigInt(beforeAllocated)); i++) {
    await new Promise((r) => setTimeout(r, 1_500));
    after = await readAllocationState();
  }
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    beforeAllocated,
    afterAllocated: after.allocatedAmountWei,
    executionCountAfter: after.executionCount,
    allocationId: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentHash(struct)])),
    readback: {
      allocatedAmountIncreased: BigInt(after.allocatedAmountWei) > BigInt(beforeAllocated),
      integrity: BigInt(after.allocatedAmountWei) === BigInt(beforeAllocated) + struct.liveAmountWei,
      executionCountIncremented: after.executionCount === before.executionCount + 1,
      allocationStateMatches: BigInt(after.totalAllocatedWei) >= BigInt(before.allocatedAmountWei) + struct.liveAmountWei,
    },
  };
}

export async function registerEconomicState(assetId, disputed, active = true, assetForHash) {
  const key = process.env.CIRCUIT_PUBLISHER_KEY?.trim();
  if (!key) throw new Error("CIRCUIT_PUBLISHER_KEY is not configured");
  await load();
  const p = freshProvider();
  const wallet = new ethers.Wallet(key, p);
  const c = contractFor(p, wallet);
  const asset = assetForHash ?? { ...acmeAsset, disputed };
  const hash = engineHashToBytes32(assetStateHash(asset));
  const tx = await c.registerAsset(assetKeyOf(asset.assetId), ethers.id(asset.passportId), hash, active);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, economicStateHash: hash, assetId: asset.assetId, disputed };
}

export const LIVE_EXECUTION_AMOUNT_WEI = 1_000_000_000_000n; // 0.000001 OKB testnet — notional, not USD

async function runActBlock() {
  // Economic decision: $100,000 → 28.39% > 20% → BLOCK. No approval exists.
  const portfolio = alphaPortfolio();
  const evaluation = evaluateAllocation(acmeAsset, portfolio, fundAlphaMandate, allocation(100_000));
  const before = await readAllocationState();
  const alreadyConsumed = new Map();
  let artificialApproval = null;
  let refusal = null;
  if (evaluation.decision === "BLOCK") {
    try {
      createApproval({ asset: acmeAsset, portfolio, mandate: fundAlphaMandate, allocation: allocation(100_000), evaluation });
    } catch (error) {
      refusal = { engine: "NO_VALID_APPROVAL", detail: error instanceof Error ? error.message : String(error) };
    }
    // Prove the on-chain gate separately refuses a submission the engine never
    // authorized: construct a $100,000 commitment whose expiry already passed
    // (the runtime holds no live approval for the BLOCK case, so no authorized
    // execution could ever be created).
    const b = await liveBindings();
    artificialApproval = buildOnchainApproval({
      asset: acmeAsset, portfolio, mandate: fundAlphaMandate,
      engineApproval: { approvalId: "NEVER-ISSUED", amountUsd: 100_000, nonce: 1 },
      liveAmountWei: LIVE_EXECUTION_AMOUNT_WEI, currentStateHash: b.portfolioStateHash,
      mandateHashBytes: b.mandateHash, mandateVersion: b.mandateVersion,
      expirySeconds: -60,
    });
    const sim = await simulateExecute(artificialApproval);
    if (sim.outcome === "SUCCEEDS") throw new Error("BLOCK path unexpectedly succeeds on-chain");
    refusal.onchain = sim;
  }
  const after = await readAllocationState();
  const receipt = createDecisionReceipt({
    decisionId: `ACME-BLOCK-${Date.now()}`, chainId: LIVE_CHAIN_ID, fundId: "portfolio-alpha-01",
    mandateId: fundAlphaMandate.mandateId, mandateVersion: fundAlphaMandate.version,
    mandateHash: "onchain:" + artificialApproval?.mandateHash, assetId: acmeAsset.assetId,
    assetStateHash: assetStateHash(acmeAsset), portfolioStateHash: `0x` + `${after.asset.economicStateHash ?? ""}`.slice(2),
    allocationId: allocation(100_000).allocationId, allocationAmountUsd: 100_000,
    evaluation, executionResult: "REFUSED — no valid approval; on-chain gate reverts",
  });
  return {
    act: "ACT 1 — MANDATE BLOCK",
    decision: evaluation.decision, reasonCodes: evaluation.reasonCodes,
    observed: evaluation.observed, projected: evaluation.projected,
    capitalMovedWei: "0", onchainAllocationUnchanged: BigInt(after.allocatedAmountWei) === BigInt(before.allocatedAmountWei),
    refusal, receiptHash: receipt.receiptHash, receipt,
  };
}

async function runActAllow() {
  const _s = async (label, fn) => { try { return await (async () => fn())(); } catch (e) { const err = e instanceof Error ? e : new Error(String(e)); err.message = `[allow:${label}] ${err.message}`; throw err; } };
  const portfolio = await _s("p1", () => alphaPortfolio());
  const evaluation = await _s("p2", () => evaluateAllocation(acmeAsset, portfolio, fundAlphaMandate, allocation(35_000)));
  if (evaluation.decision !== "ALLOW") throw new Error("expected ALLOW");
  const engineApproval = await _s("p3", () => createApproval({ asset: acmeAsset, portfolio, mandate: fundAlphaMandate, allocation: allocation(35_000), evaluation }));
  const b = await _s("liveBindings", () => liveBindings());
  const struct = await _s("build", () => buildOnchainApproval({
    asset: acmeAsset, portfolio, mandate: fundAlphaMandate, engineApproval,
    liveAmountWei: LIVE_EXECUTION_AMOUNT_WEI, currentStateHash: b.portfolioStateHash,
    mandateHashBytes: b.mandateHash, mandateVersion: b.mandateVersion,
  }));
  const ah = await _s("commitmentHash", () => commitmentHash(struct));
  const before = await _s("readState", () => readAllocationState());
  const ad = await _s("register", () => registerEconomicState(acmeAsset.assetId, false, true, acmeAsset));
  const exec = await _s("executeOnchain", () => executeOnchain(struct));
  const after = await readAllocationState();
  const receipt = createDecisionReceipt({
    decisionId: `ACME-ALLOW-${Date.now()}`, chainId: LIVE_CHAIN_ID, fundId: "portfolio-alpha-01",
    mandateId: fundAlphaMandate.mandateId, mandateVersion: fundAlphaMandate.version,
    mandateHash: b.mandateHash, assetId: acmeAsset.assetId,
    assetStateHash: assetStateHash(acmeAsset), portfolioStateHash: b.portfolioStateHash,
    allocationId: allocation(35_000).allocationId, allocationAmountUsd: 35_000,
    evaluation, approval: engineApproval, txHash: exec.txHash, executionResult: "EXECUTED",
    previousReceiptHash: null,
  });
  return {
    act: "ACT 2 — MANDATE ALLOW",
    decision: evaluation.decision,
    approvalId: engineApproval.approvalId, approvalHash: engineApproval.approvalHash,
    onchainApprovalHash: ah, approvalValid: true,
    postTradeExposurePct: evaluation.projected.postTradeDebtorExposurePct,
    liveAmountWei: struct.liveAmountWei.toString(),
    txHash: exec.txHash, blockNumber: exec.blockNumber,
    allocationId: exec.allocationId,
    onchainAllocationIncreased: exec.readback.allocatedAmountIncreased,
    readbackIntegrity: exec.readback.integrity,
    capitalMovedWei: struct.liveAmountWei.toString(),
    preAllocationWei: exec.beforeAllocated, postAllocationWei: exec.afterAllocated,
    receiptHash: receipt.receiptHash, receipt,
  };
}

async function runActStale() {
  const portfolio = alphaPortfolio();
  const evaluation = evaluateAllocation(acmeAsset, portfolio, fundAlphaMandate, allocation(35_000));
  const engineApproval = createApproval({ asset: acmeAsset, portfolio, mandate: fundAlphaMandate, allocation: allocation(35_000), evaluation });
  const b = await liveBindings();
  const struct = buildOnchainApproval({
    asset: acmeAsset, portfolio, mandate: fundAlphaMandate, engineApproval,
    liveAmountWei: LIVE_EXECUTION_AMOUNT_WEI, currentStateHash: b.portfolioStateHash,
    mandateHashBytes: b.mandateHash, mandateVersion: b.mandateVersion,
  });
  const before = await readAllocationState();
  // Mutate the asset's economic state on-chain (dispute flag flips the engine's commitment).
  await registerEconomicState(acmeAsset.assetId, true, true, { ...acmeAsset, disputed: true });
  // Off-chain re-verification also rejects — record it.
  const offchain = verifyApprovalFreshness(engineApproval, { ...acmeAsset, disputed: true }, portfolio, fundAlphaMandate, allocation(35_000));
  // Direct on-chain attempt with the ORIGINAL approval: the gate must refuse.
  const sim = await simulateExecute(struct);
  if (sim.outcome === "SUCCEEDS") throw new Error("stale approval unexpectedly executes on-chain");
  // Restore canonical economic state so future approvals bind cleanly.
  await registerEconomicState(acmeAsset.assetId, false, true, acmeAsset);
  const after = await readAllocationState();
  const receipt = createDecisionReceipt({
    decisionId: `ACME-STALE-${Date.now()}`, chainId: LIVE_CHAIN_ID, fundId: "portfolio-alpha-01",
    mandateId: fundAlphaMandate.mandateId, mandateVersion: fundAlphaMandate.version,
    mandateHash: b.mandateHash, assetId: acmeAsset.assetId,
    assetStateHash: assetStateHash({ ...acmeAsset, disputed: true }), portfolioStateHash: b.portfolioStateHash,
    allocationId: allocation(35_000).allocationId, allocationAmountUsd: 35_000,
    evaluation, approval: engineApproval, executionResult: `REFUSED — ${sim.reason}`,
  });
  return {
    act: "ACT 3 — STALE APPROVAL",
    approvalId: engineApproval.approvalId, approvalHash: engineApproval.approvalHash,
    onchainApprovalHash: commitmentHash(struct),
    mutation: "asset economic-state hash changed (dispute flag)",
    offchainFreshness: { fresh: offchain.fresh, reason: offchain.reason },
    onchainRefusal: sim,
    capitalMovedWei: "0",
    onchainAllocationUnchanged: BigInt(after.allocatedAmountWei) === BigInt(before.allocatedAmountWei),
    executionCountUnchanged: after.executionCount === before.executionCount,
    receiptHash: receipt.receiptHash, receipt,
  };
}

export async function runLiveProof() {
  await load();
  if (!ENV.deployment) return { status: "NOT_RUN", reason: "no deployment artifact" };
  // Canonical economic state for THIS run (engine hashes are computed fresh per process).
  await registerEconomicState(acmeAsset.assetId, false, true, acmeAsset);
  const acts = {};
  const tag = async (name, fn) => {
    try { return await fn(); }
    catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      e.message = `[act:${name}] ${e.message}`;
      throw e;
    }
  };
  acts.block = await tag("block", runActBlock);
  acts.allow = await tag("allow", runActAllow);
  acts.stale = await tag("stale", runActStale);
  const result = {
    status: "PASS",
    kind: "CIRCUIT X LAYER EXECUTION PROOF",
    version: JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version,
    commitSha: await (async () => {
      try {
        const { execFileSync } = await import("node:child_process");
        return execFileSync("git", ["rev-parse", "HEAD"], { stdio: "pipe" }).toString().trim();
      } catch { return null; }
    })(),
    network: ENV.meta.network,
    chainId: LIVE_CHAIN_ID,
    executionContract: ENV.deployment.contractAddress,
    fundKey: ENV.deployment.fundKey,
    assetId: "ACME-INV-8842",
    syntheticRwaNote: "ACME-INV-8842 is a synthetic competition RWA — not a real-world receivable. Live amounts are X Layer testnet token units, not USD capital.",
    economicNotionalVsLive: { economicBlock: "$100,000", economicAllow: "$35,000", liveAmountWei: LIVE_EXECUTION_AMOUNT_WEI.toString() },
    acts,
    receipts: {
      block: acts.block.receiptHash, allow: acts.allow.receiptHash, stale: acts.stale.receiptHash,
      blockValid: verifyReceipt(acts.block.receipt).valid,
      allowValid: verifyReceipt(acts.allow.receipt).valid,
      staleValid: verifyReceipt(acts.stale.receipt).valid,
    },
    generatedAt: new Date().toISOString(),
  };
  const dir = new URL("../artifacts/xlayer/", import.meta.url);
  await mkdir(new URL("receipts/", dir), { recursive: true });
  await writeFile(new URL("latest.json", dir), JSON.stringify(result, null, 2) + "\n");
  await writeFile(new URL("receipts/block.json", dir), JSON.stringify(acts.block.receipt, null, 2) + "\n");
  await writeFile(new URL("receipts/allow.json", dir), JSON.stringify(acts.allow.receipt, null, 2) + "\n");
  await writeFile(new URL("receipts/stale.json", dir), JSON.stringify(acts.stale.receipt, null, 2) + "\n");
  return result;
}