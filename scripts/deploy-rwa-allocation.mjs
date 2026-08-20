#!/usr/bin/env node
// Deploy CircuitDemoRWAAllocation on X Layer Testnet and register the
// synthetic competition RWA (ACME-INV-8842) bound to the engine's
// asset-state commitment. Requires CIRCUIT_PUBLISHER_KEY in .env.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ethers } from "ethers";

const RPC = process.env.XLAYER_TESTNET_RPC ?? "https://testrpc.xlayer.tech/terigon";
const chainId = 1952;

const meta = JSON.parse(await readFile(new URL("../deployments/vault-xlayer-testnet.json", import.meta.url), "utf8"));

const key = process.env.CIRCUIT_PUBLISHER_KEY?.trim();
if (!key) throw new Error("CIRCUIT_PUBLISHER_KEY is required");

const fetchRequest = new ethers.FetchRequest(RPC);
fetchRequest.timeout = 30_000;
fetchRequest.retries = 3;
const provider = new ethers.JsonRpcProvider(fetchRequest, chainId, { staticNetwork: true });
const wallet = new ethers.Wallet(key, provider);

const artifact = JSON.parse(
  await readFile(new URL("../contracts/out/CircuitDemoRWAAllocation.sol/CircuitDemoRWAAllocation.json", import.meta.url), "utf8"),
);
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

console.log(`Deploying from ${wallet.address} on X Layer Testnet (${chainId})…`);
const deployed = await factory.deploy(chainId, meta.contracts.registry, meta.contracts.vault);
await deployed.waitForDeployment();
const deploymentTx = deployed.deploymentTransaction();
const receipt = await deploymentTx.wait();
const contractAddress = await deployed.getAddress();
console.log(`Deployed: ${contractAddress} (block ${receipt.blockNumber}, tx ${receipt.hash})`);

const contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

const acmeAssetKey = ethers.id("acme-inv-8842");
const passportHash = ethers.id("PASS-ACME-8842");
const fundKey = ethers.id("portfolio-alpha-01");

const { assetStateHash } = await import("../dist/competition/rwa/approvals.js");
const { acmeAsset } = await import("../dist/competition/rwa/scenario.js");
const economicStateHash = `0x${assetStateHash(acmeAsset).replace(/^sha256:/, "")}`;

let tx = await contract.registerAsset(acmeAssetKey, passportHash, economicStateHash, true);
let r = await tx.wait();
const registerTx = { tx: r.hash, block: r.blockNumber };

tx = await contract.registerFund(fundKey);
r = await tx.wait();
const fundTx = { tx: r.hash, block: r.blockNumber };

// Executor defaults to deployer (msg.sender) — confirm it for the record.
const executor = await contract.executor();

const deployment = {
  kind: "CIRCUIT DEMO RWA ALLOCATION VEHICLE",
  note: "Synthetic competition RWA execution vehicle. ACME-INV-8842 is NOT a real-world receivable. Live amounts are X Layer testnet token units, not USD capital.",
  network: meta.network,
  chainId,
  contractAddress: receipt.contractAddress,
  deployer: wallet.address,
  executor,
  registry: meta.contracts.registry,
  vault: meta.contracts.vault,
  fundKey,
  asset: {
    assetId: "ACME-INV-8842",
    assetKey: acmeAssetKey,
    passportHash,
    economicStateHash,
    engine: "assetStateHash(acmeAsset)",
    active: true,
    registered: true,
  },
  registration: { asset: registerTx, fund: fundTx },
  deployTx: { hash: receipt.hash, block: receipt.blockNumber },
  generatedAt: new Date().toISOString(),
};

const dir = new URL("../artifacts/xlayer/", import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL("deploy.json", dir), JSON.stringify(deployment, null, 2) + "\n");

console.log("\nSynthetic RWA registered:");
console.log(`  asset  ${acmeAssetKey}`);
console.log(`  fund   ${fundKey}`);
console.log(`  econ   ${economicStateHash}`);
console.log(`Artifacts: artifacts/xlayer/deploy.json`);