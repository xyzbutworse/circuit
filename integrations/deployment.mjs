import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { rpc, XLAYER_TESTNET } from "./xlayer-rpc.mjs";

const base = new URL("../", import.meta.url);
const metadataUrl = new URL("deployments/xlayer-testnet.json", base);
const registryArtifactUrl = new URL("contracts/out/CircuitMandateRegistry.sol/CircuitMandateRegistry.json", base);
const guardArtifactUrl = new URL("contracts/out/CircuitPortfolioGuard.sol/CircuitPortfolioGuard.json", base);

function keccak(hex) {
  const bytes = String(hex).replace(/^(0x)+/i, "");
  return createHash("sha256").update(bytes, "hex").digest("hex");
}

async function artifactInfo(url) {
  const artifact = JSON.parse(await readFile(url, "utf8"));
  return {
    object: String(artifact?.deployedBytecode?.object ?? "").replace(/^(0x)+/i, ""),
    immutables: artifact?.deployedBytecode?.immutableReferences ?? {},
  };
}

function normalizeCode(hex, immutables) {
  let bytes = String(hex).replace(/^(0x)+/i, "");
  for (const refs of Object.values(immutables)) {
    for (const ref of refs) {
      const start = Number(ref.start) * 2;
      const length = Number(ref.length) * 2;
      bytes = bytes.slice(0, start) + "0".repeat(length) + bytes.slice(start + length);
    }
  }
  return bytes;
}

export async function deploymentMetadata() {
  return JSON.parse(await readFile(metadataUrl, "utf8"));
}

export async function writeDeploymentMetadata(update) {
  const current = JSON.parse(await readFile(metadataUrl, "utf8"));
  const merged = { ...current, ...update };
  await writeFile(metadataUrl, JSON.stringify(merged, null, 2) + "\n");
}

export async function deploymentConfig() {
  const meta = await deploymentMetadata();
  const registry = process.env.CIRCUIT_MANDATE_REGISTRY || meta.contracts.registry.address;
  const guard = process.env.CIRCUIT_PORTFOLIO_GUARD || meta.contracts.guard.address;
  return { meta, registry, guard };
}

export async function verifyContract(address, artifactUrl) {
  if (!address) return { address: null, status: "missing", detail: "no configured address" };
  try {
    const [info, code] = await Promise.all([artifactInfo(artifactUrl), rpc("eth_getCode", [address, "latest"])]);
    if (!code || code === "0x") return { address, status: "missing", detail: "no runtime bytecode at address" };
    const expected = keccak(normalizeCode(info.object, info.immutables));
    const actual = keccak(normalizeCode(code, info.immutables));
    if (actual !== expected) return { address, status: "mismatch", detail: `runtime bytecode does not match the build artifact (expected ${expected.slice(0, 16)}…, got ${actual.slice(0, 16)}…)` };
    return { address, status: "verified", detail: "runtime bytecode matches the audited build artifact (immutable slots normalized)" };
  } catch (error) {
    return { address, status: "unavailable", detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function verifyDeployment({ registry, guard }) {
  const [registryCheck, guardCheck] = await Promise.all([
    verifyContract(registry, registryArtifactUrl),
    verifyContract(guard, guardArtifactUrl),
  ]);
  const live = registryCheck.status === "verified" && guardCheck.status === "verified";
  return { live, registry: registryCheck, guard: guardCheck };
}

export function explorerUrl(base, type, value) {
  if (!base || !value) return null;
  return `${base}${type === "address" ? "/address/" : "/tx/"}${value}`;
}

export { XLAYER_TESTNET };
