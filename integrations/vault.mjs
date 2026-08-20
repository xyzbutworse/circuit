import { readFile } from "node:fs/promises";
import { ethers } from "ethers";
import { evaluatePlan } from "../dist/competition/mandate.js";
import { demoMandate, demoMarket } from "../dist/competition/demo.js";

const metaUrl = new URL("../deployments/vault-xlayer-testnet.json", import.meta.url);

const ACTION_TUPLE = "bytes32 assetKey,bool isBuy,uint256 notionalUsdE18,uint256 expectedSlippageBps,uint256 referenceFreshnessSeconds,bool marketSessionClosed,bool materialEvent,uint256 maxNativeWei,bytes executionCalldata";

const GUARD_ABI = [
  "function seeded(bytes32) view returns (bool)",
  "function totalInvested(bytes32) view returns (uint256)",
  "function cashUsd(bytes32) view returns (uint256)",
  "function dailyTurnover(bytes32) view returns (uint256)",
  "function assetExposure(bytes32,bytes32) view returns (uint256)",
  "function issuerExposure(bytes32,bytes32) view returns (uint256)",
  "function sectorExposure(bytes32,bytes32) view returns (uint256)",
];
const REGISTRY_ABI = [
  "function getMandate(bytes32) view returns (bytes32 mandateHash,uint64 version,uint64 validUntil,uint128 navUsdE18,uint16 maxAssetExposureBps,uint16 maxIssuerExposureBps,uint16 maxSectorExposureBps,uint16 maxInvestedBps,uint16 maxDailyTurnoverBps,uint16 maxSlippageBps,uint64 maxReferenceFreshnessSeconds,uint128 closedMarketMaxBuyUsdE18,uint128 materialEventMaxBuyUsdE18,bool enabled,bool exists)",
  "function getAsset(bytes32) view returns (bytes32 issuerKey,bytes32 sectorKey,bool enabled,bool exists)",
  "function publisher() view returns (address)",
];
const ADAPTER_ABI = [
  "error UnsupportedRoute(bytes32 assetKey)",
  "error SpendMismatch()",
  "error RouterCallFailed()",
  "error RouterCallFailedWithData(bytes data)",
  "error Unauthorized()",
];
const GUARD_ERRORS = [
  "error ExecutionDenied(uint8 reason)",
];
const VAULT_ABI = [
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function authorizer() view returns (address)",
  "function adapter() view returns (address)",
  "function paused() view returns (bool)",
  "function portfolioId() view returns (bytes32)",
  "function portfolioAssets(uint256) view returns (bytes32)",
  "function consumedAuthorizations(bytes32) view returns (bool)",
  "function consumedNonces(uint256) view returns (bool)",
  "function currentStateHash() view returns (bytes32)",
  "function hashAuthorization((bytes32,uint64,bytes32,bytes32,bytes32,uint64,uint256,bytes)) view returns (bytes32)",
  "function executeAuthorizedAction((bytes32,uint64,bytes32,bytes32,bytes32,uint64,uint256,bytes),(bytes32,bool,uint256,uint256,uint256,bool,bool,uint256,bytes)[])",
];

const EIP712_DOMAIN = { name: "CircuitPortfolioVault", version: "1", chainId: 1952 };
const EIP712_TYPES = {
  Authorization: [
    { name: "portfolioId", type: "bytes32" },
    { name: "mandateVersion", type: "uint64" },
    { name: "portfolioStateHash", type: "bytes32" },
    { name: "actionsHash", type: "bytes32" },
    { name: "evaluationHash", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

const REVERT_IFACE = new ethers.Interface([
  "error UnsupportedRoute(bytes32 assetKey)",
  "error SpendMismatch()",
  "error RouterCallFailed()",
  "error RouterCallFailedWithData(bytes data)",
  "error Unauthorized()",
  "error ExecutionDenied(uint8 reason)",
  "error ExecutionFailed(bytes reason)",
  "error StalePortfolioState()",
  "error StaleMandateVersion(uint64 expected, uint64 actual)",
  "error ReplayedAuthorization()",
  "error ReusedNonce()",
  "error InvalidAuthorizationSignature()",
  "error ActionMismatch()",
  "error AuthorizationExpired()",
  "error Paused()",
  "error InvalidInput()",
]);

let nextNonce = 1;

export async function vaultMetadata() {
  return JSON.parse(await readFile(metaUrl, "utf8"));
}

async function publisherKey() {
  if (process.env.CIRCUIT_PUBLISHER_KEY) return process.env.CIRCUIT_PUBLISHER_KEY.trim();
  const file = process.env.CIRCUIT_PUBLISHER_KEY_FILE;
  if (!file) return null;
  return (await readFile(file, "utf8")).trim();
}

async function connect() {
  const meta = await vaultMetadata();
  const key = await publisherKey();
  if (!key) return { meta, ok: false, detail: "CIRCUIT_PUBLISHER_KEY is not configured. Authorization signing is unavailable; nothing was committed." };
  const fetchRequest = new ethers.FetchRequest(meta.network.rpc);
  fetchRequest.timeout = 15_000;
  fetchRequest.retries = 3;
  const provider = new ethers.JsonRpcProvider(fetchRequest, meta.network.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(key, provider);
  const registry = new ethers.Contract(meta.contracts.registry, REGISTRY_ABI, provider);
  const guard = new ethers.Contract(meta.contracts.guard, GUARD_ABI, provider);
  const vault = new ethers.Contract(meta.contracts.vault, VAULT_ABI, provider);
  const vaultWriter = new ethers.Contract(meta.contracts.vault, VAULT_ABI, wallet);
  return { meta, ok: true, provider, wallet, registry, guard, vault, vaultWriter };
}

function assetKey(assetId) {
  return ethers.id(String(assetId).toLowerCase());
}

// The public Terigon gateway mis-pairs concurrent requests that share one
// ethers provider ("missing response for request"). Each read gets its own
// provider + id space so the read wave stays reliable.
function freshProvider(meta, retries = 3) {
  const fetchRequest = new ethers.FetchRequest(meta.network.rpc);
  fetchRequest.timeout = 15_000;
  fetchRequest.retries = retries;
  return new ethers.JsonRpcProvider(fetchRequest, meta.network.chainId, { staticNetwork: true });
}
function freshContract(meta, abi, address) {
  return new ethers.Contract(address, abi, freshProvider(meta));
}

function actionStruct(action, intentIndex, planId) {
  return {
    assetKey: assetKey(action.assetId),
    isBuy: action.side === "BUY",
    notionalUsdE18: ethers.parseUnits(String(action.notionalUsd), 18),
    expectedSlippageBps: BigInt(Math.round(action.expectedSlippageBps ?? 0)),
    referenceFreshnessSeconds: 240n,
    marketSessionClosed: false,
    materialEvent: false,
    maxNativeWei: ethers.parseUnits("0.05", 18),
    executionCalldata: "0x",
  };
}

export async function vaultStatus() {
  const c = await connect();
  if (!c.ok) return { ok: false, status: "VAULT_UNAVAILABLE", detail: c.detail, meta: c.meta };
  try {
    const { meta } = c;
    const policyKey = ethers.id(meta.portfolioId);
    const readOne = (name) => {
      const p = freshProvider(meta);
      const vaultP = () => new ethers.Contract(meta.contracts.vault, VAULT_ABI, p);
      const guardP = () => new ethers.Contract(meta.contracts.guard, GUARD_ABI, p);
      const registryP = () => new ethers.Contract(meta.contracts.registry, REGISTRY_ABI, p);
      if (name==="owner") return vaultP().owner();
      if (name==="agent") return vaultP().agent();
      if (name==="authorizer") return vaultP().authorizer();
      if (name==="adapter") return vaultP().adapter();
      if (name==="paused") return vaultP().paused();
      if (name==="seeded") return guardP().seeded(policyKey);
      if (name==="cash") return guardP().cashUsd(policyKey);
      if (name==="turnover") return guardP().dailyTurnover(policyKey);
      if (name==="invested") return guardP().totalInvested(policyKey);
      if (name==="mandate") return registryP().getMandate(policyKey);
      if (name==="publisher") return registryP().publisher();
      if (name==="balance") return p.getBalance(meta.contracts.vault);
      if (name==="stateHash") return vaultP().currentStateHash();
      throw new Error("unknown");
    };
    const settled = await Promise.allSettled(["owner","agent","authorizer","adapter","paused","seeded","cash","turnover","invested","mandate","publisher","balance","stateHash"].map((name) =>
      Promise.race([
        Promise.resolve().then(() => readOne(name)).then(v => ({ name, status: "fulfilled", value: v })).catch(e => ({ name, status: "rejected", reason: e?.shortMessage ?? e?.message ?? String(e) })),
        new Promise(res => setTimeout(() => res({ name, status: "timeout" }), 24000)),
      ])
    ));
    const get = (name) => settled.find(s => (s.value?.name ?? s.name) === name).value?.value;
    const [owner, agent, authorizer, adapterAddr, paused, seeded, cash, turnover, invested, mandate, registryPublisher, balance, stateHash] = ["owner","agent","authorizer","adapter","paused","seeded","cash","turnover","invested","mandate","publisher","balance","stateHash"].map(get);
    const assets = ["tslax", "googlx", "mstrx"];
    const positions = {};
    const issuerExposures = {};
    const sectorExposures = {};
    const names = { tslax: ["Tesla, Inc.", "automotive"], googlx: ["Alphabet Inc.", "technology"], mstrx: ["Strategy Inc.", "technology"] };
    const exposureDone = await Promise.all(assets.map(async (assetId) => {
      const g = () => freshContract(meta, GUARD_ABI, meta.contracts.guard);
      const r = () => freshContract(meta, REGISTRY_ABI, meta.contracts.registry);
      const [position, profile] = await Promise.all([
        g().assetExposure(policyKey, assetKey(assetId)),
        r().getAsset(assetKey(assetId)),
      ]);
      positions[assetId] = Number(position) / 1e18;
      if (!profile.exists) return;
      const [issuerName, sectorName] = names[assetId] ?? ["unknown", "unknown"];
      const [issuer, sector] = await Promise.all([
        g().issuerExposure(policyKey, profile.issuerKey),
        g().sectorExposure(policyKey, profile.sectorKey),
      ]);
      issuerExposures[issuerName] = Number(issuer) / 1e18;
      sectorExposures[sectorName] = Number(sector) / 1e18;
    }));
    const status = {
      ok: true,
      portfolioId: meta.portfolioId,
      network: meta.network,
      addresses: meta.contracts,
      owner: String(owner),
      agent: String(agent),
      authorizer: String(authorizer),
      adapter: String(adapterAddr),
      registryPublisher: String(registryPublisher),
      paused,
      seeded,
      mandate: {
        version: Number(mandate.version),
        enabled: mandate.enabled,
        exists: mandate.exists,
        validUntil: Number(mandate.validUntil),
        mandateHash: mandate.mandateHash,
        navUsd: Number(mandate.navUsdE18) / 1e18,
        maxAssetExposureBps: Number(mandate.maxAssetExposureBps),
        maxIssuerExposureBps: Number(mandate.maxIssuerExposureBps),
        maxSectorExposureBps: Number(mandate.maxSectorExposureBps),
        maxInvestedBps: Number(mandate.maxInvestedBps),
        maxDailyTurnoverBps: Number(mandate.maxDailyTurnoverBps),
        maxSlippageBps: Number(mandate.maxSlippageBps),
        maxReferenceFreshnessSeconds: Number(mandate.maxReferenceFreshnessSeconds),
        closedMarketMaxBuyUsdE18: String(mandate.closedMarketMaxBuyUsdE18),
        materialEventMaxBuyUsdE18: String(mandate.materialEventMaxBuyUsdE18),
      },
      cashUsd: Number(cash) / 1e18,
      dailyTurnoverUsd: Number(turnover) / 1e18,
      investedUsd: Number(invested) / 1e18,
      positions,
      issuerExposures,
      sectorExposures,
      portfolioStateHash: stateHash,
      portfolioVersion: Number(mandate.version),
      vaultBalanceWei: balance.toString(),
      funded: balance > 0n,
      execution: { note: meta.executionNote },
      setupTxs: meta.setupTxs,
    };
    return status;
  } catch (error) {
    return { ok: false, status: "VAULT_UNAVAILABLE", detail: error instanceof Error ? (error.shortMessage ?? error.message) : String(error), meta: c.meta };
  }
}

export function actionsHashFor(actionStructs) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([`tuple(${ACTION_TUPLE})[]`], [actionStructs]));
}

export function evaluationHashFor(portfolioId, mandateHash, mandateVersion, stateHash, actionsHash) {
  return ethers.id(`${portfolioId}:${mandateHash}:${mandateVersion}:${stateHash}:${actionsHash}`);
}

export function actionStructsFromActions(actions) {
  return actions.map(action => actionStruct(action, 0, ""));
}

export function actionTuplesFor(actionStructs) {
  return actionStructs.map(o => [o.assetKey, o.isBuy, o.notionalUsdE18, o.expectedSlippageBps, o.referenceFreshnessSeconds, o.marketSessionClosed, o.materialEvent, o.maxNativeWei, o.executionCalldata]);
}

export function authorizationTupleFor(authWithSig) {
  return [authWithSig.portfolioId, authWithSig.mandateVersion, authWithSig.portfolioStateHash, authWithSig.actionsHash, authWithSig.evaluationHash, authWithSig.expiry, authWithSig.nonce, authWithSig.signature];
}

export async function signAuthorization({ portfolioId, mandateVersion, portfolioStateHash, actionsHash, evaluationHash, expirySeconds = 300 }) {
  const c = await connect();
  if (!c.ok) return { ok: false, status: "VAULT_UNAVAILABLE", detail: c.detail };
  const policyKey = ethers.id(portfolioId);
  const authorization = {
    portfolioId: policyKey,
    mandateVersion: BigInt(mandateVersion),
    portfolioStateHash,
    actionsHash,
    evaluationHash,
    expiry: BigInt(Math.floor(Date.now() / 1000) + expirySeconds),
    nonce: BigInt(Date.now()) * 1000n + BigInt(nextNonce++),
  };
  const signature = await c.wallet.signTypedData(
    { ...EIP712_DOMAIN, verifyingContract: c.meta.contracts.vault },
    EIP712_TYPES,
    authorization
  );
  const authWithSig = { ...authorization, signature };
  const authorizationHash = await c.vault.hashAuthorization(authorizationTupleFor(authWithSig));
  return {
    ok: true,
    authorizationHash,
    expiry: Number(authorization.expiry),
    nonce: Number(authorization.nonce),
    authorization: authWithSig,
    actionStructs: null,
  };
}

export async function isAuthorizationConsumed(authorizationHash) {
  const c = await connect();
  if (!c.ok) return { ok: false, detail: c.detail };
  try {
    return { ok: true, consumed: await c.vault.consumedAuthorizations(authorizationHash) };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? (error.shortMessage ?? error.message) : String(error) };
  }
}

export async function simulateExecution(authWithSig, actionStructs) {
  const c = await connect();
  if (!c.ok) return { ok: false, status: "VAULT_UNAVAILABLE", detail: c.detail };
  try {
    await c.vaultWriter.executeAuthorizedAction.staticCall(authorizationTupleFor(authWithSig), actionTuplesFor(actionStructs));
    return { ok: true };
  } catch (simError) {
    return { ok: false, ...classifyRevert(simError, c.meta) };
  }
}

export async function sendExecution(authWithSig, actionStructs) {
  const c = await connect();
  if (!c.ok) return { ok: false, status: "VAULT_UNAVAILABLE", detail: c.detail };
  try {
    const fee = await c.provider.getFeeData();
    const tx = await c.vaultWriter.executeAuthorizedAction(authorizationTupleFor(authWithSig), actionTuplesFor(actionStructs), {
      gasLimit: 4_000_000n,
      maxFeePerGas: fee.gasPrice,
      maxPriorityFeePerGas: fee.gasPrice,
    });
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      return { ok: false, status: "EXECUTION_REVERTED", detail: "Transaction reverted onchain. No capital moved.", txHash: receipt.hash, blockNumber: receipt.blockNumber };
    }
    return { ok: true, status: "EXECUTED", txHash: receipt.hash, blockNumber: receipt.blockNumber };
  } catch (error) {
    const classified = classifyRevert(error, c.meta);
    if (classified) return { ok: false, ...classified };
    return { ok: false, status: "ONCHAIN_ERROR", detail: error instanceof Error ? (error.shortMessage ?? error.message) : String(error) };
  }
}

function classifyRevert(simError, meta) {
  const data = simError?.data ?? simError?.info?.error?.data ?? simError?.revert?.data;
  let parsed = null;
  if (data) {
    try { parsed = REVERT_IFACE.parseError(data); } catch (error) {
      console.error("[vault-revert-parse]", String(data).slice(0, 20), error instanceof Error ? error.message : String(error));
    }
  }
  if (parsed?.name === "UnsupportedRoute") {
    return { status: "EXECUTION_UNSUPPORTED", detail: `Execution route unsupported for asset ${parsed.args.assetKey}. ${meta.executionNote}`, note: meta.executionNote };
  }
  if (parsed?.name === "SpendMismatch" || parsed?.name === "ExecutionFailed") {
    return { status: "EXECUTION_UNSUPPORTED", detail: `Vault refused execution: ${parsed.name}. Signed spend exceeds available capital or the route is unavailable. No capital moved.` };
  }
  if (parsed?.name === "ExecutionDenied") {
    return { status: "BLOCKED", detail: `CircuitPortfolioGuard denied the action (reason ${parsed.args.reason}). No capital moved.` };
  }
  if (parsed?.name === "AuthorizationExpired") return { status: "EXPIRED", detail: "Authorization expired." };
  if (parsed?.name === "StalePortfolioState") return { status: "STALE_STATE", detail: "Portfolio state changed since authorization." };
  if (parsed?.name === "StaleMandateVersion") return { status: "STALE_MANDATE", detail: "Mandate version changed since authorization." };
  if (parsed?.name === "ReplayedAuthorization" || parsed?.name === "ReusedNonce") return { status: "REPLAYED", detail: "Authorization was already consumed." };
  if (parsed?.name === "ActionMismatch") return { status: "ACTION_MISMATCH", detail: "Actions do not match the authorization." };
  if (parsed?.name === "InvalidAuthorizationSignature") return { status: "INVALID_SIGNATURE", detail: "Authorization signature invalid." };
  if (parsed?.name === "Paused") return { status: "PAUSED", detail: "Vault is paused." };
  if (parsed) return { status: "ONCHAIN_ERROR", detail: `Onchain reverted: ${parsed.name}.` };
  return null;
}

function seededPortfolioSnapshot() {
  return {
    id: "portfolio-alpha-01",
    mandateId: demoMandate.id,
    navUsd: 10_000,
    cashUsd: 6_500,
    holdings: [
      { assetId: "tslax", notionalUsd: 1_500 },
      { assetId: "googlx", notionalUsd: 1_500 },
      { assetId: "mstrx", notionalUsd: 500 },
    ],
    dailyTurnoverUsd: 500,
    asOf: new Date().toISOString(),
  };
}

export function planFromActions(actions) {
  const intents = actions.map((action, index) => ({
    id: `mcp-${Date.now()}-${index + 1}`,
    assetId: String(action.assetId).toLowerCase(),
    symbol: String(action.asset).toUpperCase(),
    side: action.side === "SELL" ? "SELL" : "BUY",
    notionalUsd: Number(action.notionalUsd),
    expectedSlippageBps: Number(action.expectedSlippageBps ?? 39),
    rationale: "Proposed portfolio action.",
  }));
  return {
    id: `vault-plan-${Date.now()}`,
    mandateId: demoMandate.id,
    intents,
    thesis: "Proposed portfolio action.",
    allocationRationale: "Proposed portfolio action.",
    assumptions: [],
    provider: "mcp",
    generatedAt: new Date().toISOString(),
  };
}

export function portfolioSnapshotFromStatus(status) {
  return {
    id: status.portfolioId,
    mandateId: demoMandate.id,
    navUsd: status.mandate?.navUsd ?? 10_000,
    cashUsd: status.cashUsd ?? 0,
    holdings: Object.entries(status.positions ?? {}).map(([assetId, notionalUsd]) => ({ assetId, notionalUsd })).filter(h => h.notionalUsd > 0),
    dailyTurnoverUsd: status.dailyTurnoverUsd ?? 0,
    asOf: new Date().toISOString(),
  };
}

export async function evaluateOnChainState(actions) {
  const status = await vaultStatus();
  if (!status.ok) return { ok: false, status: status.status, detail: status.detail };
  const plan = planFromActions(actions);
  const decision = evaluatePlan(plan, portfolioSnapshotFromStatus(status), demoMandate, demoMarket, new Date().toISOString());
  const actionStructs = actionStructsFromActions(actions);
  const actionsHash = actionsHashFor(actionStructs);
  const evaluationHash = evaluationHashFor(status.portfolioId, status.mandate.mandateHash, status.mandate.version, status.portfolioStateHash, actionsHash);
  return { ok: true, status, plan, decision, actionsHash, evaluationHash };
}

export async function authorizeActions(actions) {
  const evaluation = await evaluateOnChainState(actions);
  if (!evaluation.ok) return evaluation;
  if (!evaluation.decision.allowed) {
    return { ok: false, status: "BLOCKED", decision: { verdict: evaluation.decision.verdict, violations: evaluation.decision.violations } };
  }
  const signed = await signAuthorization({
    portfolioId: evaluation.status.portfolioId,
    mandateVersion: evaluation.status.mandate.version,
    portfolioStateHash: evaluation.status.portfolioStateHash,
    actionsHash: evaluation.actionsHash,
    evaluationHash: evaluation.evaluationHash,
  });
  if (!signed.ok) return signed;
  const actionStructs = actionStructsFromActions(actions);
  const simulated = await simulateExecution(signed.authorization, actionStructs);
  if (!simulated.ok) return simulated;
  const sent = await sendExecution(signed.authorization, actionStructs);
  if (!sent.ok) return sent;
  return {
    ok: true,
    status: "AUTHORIZED",
    portfolioId: evaluation.status.portfolioId,
    mandateVersion: evaluation.status.mandate.version,
    evaluationHash: evaluation.evaluationHash,
    authorizationHash: signed.authorizationHash,
    actionsHash: evaluation.actionsHash,
    txHash: sent.txHash,
    blockNumber: sent.blockNumber,
    actions: evaluation.plan.intents.map(intent => ({ assetId: intent.assetId, side: intent.side, notionalUsd: intent.notionalUsd })),
    decision: { verdict: evaluation.decision.verdict, violations: [] },
  };
}
