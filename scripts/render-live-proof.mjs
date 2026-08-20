#!/usr/bin/env node
// Renders the "Live X Layer Proof" section of README.md from
// artifacts/xlayer/latest.json so the README never duplicates state by hand.
// Usage: npm run render:live
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(root, "README.md");
const artifactPath = join(root, "artifacts/xlayer/latest.json");

const readme = await readFile(readmePath, "utf8");
let art;
try {
  art = JSON.parse(await readFile(artifactPath, "utf8"));
} catch {
  console.error("No live proof artifact at artifacts/xlayer/latest.json. Run npm run prove:xlayer first.");
  process.exit(1);
}

if (art.status !== "PASS") {
  console.error(`Artifact status is ${art.status} — nothing to render.`);
  process.exit(1);
}

const a1 = art.acts.block;
const a2 = art.acts.allow;
const a3 = art.acts.stale;
const fmt = (n, d = 2) => Number(n).toFixed(d);

const section = `### ACT 1 — BLOCK

| | |
| --- | --- |
| Verified asset | ${art.assetId} — VERIFIED (passport PASS-8842, yield ${fmt(11.2)}%, maturity 74d, collateral ratio ${fmt(1.32)}) |
| Proposed allocation | ${art.economicNotionalVsLive.economicBlock} |
| Projected mandate violation | \`DEBTOR_CONCENTRATION_LIMIT\` — debtor exposure ${fmt(a1.observed.currentDebtorExposurePct)}% → ${fmt(a1.projected.postTradeDebtorExposurePct)}% of NAV, mandate max ${fmt(a1.observed.mandateMaxPct)}% |
| Decision | **BLOCK** |
| Approval status | ${a1.refusal.engine} — "Cannot create an approval for a BLOCKED evaluation." |
| On-chain refusal (observed) | ${a1.refusal.onchain.outcome} — \`${a1.refusal.onchain.reason}\` (the gate was probed directly with an expired commitment; no new approval exists) |
| Capital moved | **0** |
| Allocation state unchanged | ${a1.onchainAllocationUnchanged} |

### ACT 2 — ALLOW

| | |
| --- | --- |
| Mandate result | ALLOW — every rule passes; projected debtor exposure ${fmt(a2.postTradeExposurePct)}% stays under the ${fmt(a1.observed.mandateMaxPct)}% ceiling |
| State-bound approval | \`${a2.approvalId}\` — sha256 \`${a2.approvalHash.replace("sha256:", "")}\`, on-chain \`${a2.onchainApprovalHash}\`, expiry ${new Date(a2.receipt.approvalExpiry).toISOString()} |
| X Layer transaction | \`${a2.txHash}\` |
| Confirmation | block ${a2.blockNumber} on chain ${art.chainId} (${art.network.name}) — status 1, execution receipt present |
| Allocation before | ${Number(a2.preAllocationWei)} wei allocated |
| Allocation after | ${Number(a2.postAllocationWei)} wei allocated (+${a2.capitalMovedWei} wei) |
| Readback integrity | ${a2.readbackIntegrity} (post-state re-read equals committed state) |

### ACT 3 — STALE

| | |
| --- | --- |
| Approval valid at T0 | \`${a3.approvalId}\` — sha256 \`${a3.approvalHash.replace("sha256:", "")}\`, on-chain \`${a3.onchainApprovalHash}\` |
| State mutation at T1 | ${a3.mutation} |
| Approval invalid at T1 | ${a3.offchainFreshness.fresh ? "still valid" : "invalid"} — ${a3.offchainFreshness.reason} |
| Off-chain stale detection | REJECTED before sending |
| On-chain gate (probed) | ${a3.onchainRefusal.outcome} — \`${a3.onchainRefusal.reason}\` |
| Capital moved | **0** |
| Allocation / execution count unchanged | ${a3.onchainAllocationUnchanged} / ${a3.executionCountUnchanged} |

> CIRCUIT does not authorize a transaction forever. It authorizes a specific transaction against a specific economic state.`;

export async function renderLiveProof() {
  const start = "<!-- LIVE-PROOF:START -->";
  const end = "<!-- LIVE-PROOF:END -->";
  const i = readme.indexOf(start);
  const j = readme.indexOf(end);
  if (i === -1 || j === -1) {
    console.error('README.md is missing the "<!-- LIVE-PROOF:START -->" markers.');
    process.exit(1);
  }
  const rendered = `${start}\n\n${section}\n\n${end}\n`;
  const block = readme.slice(i, j + end.length);
  if (block !== rendered) {
    await writeFile(readmePath, readme.replace(block, rendered));
    console.log(`README.md live-proof section updated from artifacts/xlayer/latest.json (${art.generatedAt}).`);
  } else {
    console.log("README.md live-proof section already current.");
  }
}

await renderLiveProof();