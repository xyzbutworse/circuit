# CIRCUIT — Evidence Index

Every claim in the submission maps to a generated artifact. Rule: **nothing is PROVEN without an inspectable artifact.**

Legend: `[generated]` = produced by a script in this repository; `[live]` = produced from a real X Layer Testnet transaction.

## 1. Deterministic benchmark artifact

| Claim | Artifact | Command |
| --- | --- | --- |
| Engine latency, corpora, mandate cases | `artifacts/benchmarks/latest.json` | `npm run verify` |
| Full verify rollup (37/37, 29/29, 8/8, receipts) | console output of `npm run verify` | `npm run verify` |

## 2. Development corpus

| Claim | Artifact |
| --- | --- |
| 29 ground-truth cases, 0 false admits / 0 false blocks | `src/competition/rwa/corpus.ts` + `npm run verify` output |
| Corpus results in artifact | `artifacts/benchmarks/latest.json` (→ `development`) |

## 3. Holdout corpus

| Claim | Artifact |
| --- | --- |
| 8 cases never used during development, 8/8 | `src/competition/rwa/corpus-holdout.ts` + `npm run verify` output |
| Holdout results in artifact | `artifacts/benchmarks/latest.json` (→ `holdout`) |

## 4. Live X Layer proof JSON

| Claim | Artifact |
| --- | --- |
| Full three-act proof (BLOCK / ALLOW / STALE), receipts, metadata | `artifacts/xlayer/latest.json` `[live][generated]` (regenerate: `npm run prove:xlayer`) |
| RWA vehicle deployment metadata | `artifacts/xlayer/deploy.json` `[live][generated]` |

`latest.json` metadata: `generatedAt`, `version`, `commitSha` (null — no git repo in this build), `network`, `chainId`, `executionContract`, per-act observed values, tx hashes, block number, pre/post allocation, receipt hashes and validity, `status: PASS`.

## 5. Decision receipts (tamper-evident)

| Act | Receipt file | sha256 |
| --- | --- | --- |
| ACT 1 BLOCK | `artifacts/xlayer/receipts/block.json` | `381402d13602f6b94a8475aafeb520a9f101cc74ff4e346ad00b1031e8b2958f` |
| ACT 2 ALLOW | `artifacts/xlayer/receipts/allow.json` | `225ed6e2a8f093c7eb76f56d87575c50e8fd1234bd411e90b53f2efe262345d5` |
| ACT 3 STALE | `artifacts/xlayer/receipts/stale.json` | `8de3162cf48f160c8809b3bae20aa5c76ad0ce12ebf9dfff5e1510e861aa7e13` |

Validity: `blockValid: true`, `allowValid: true`, `staleValid: true` (in `latest.json`). Tamper-evidence of the receipt format itself: verify output `Receipt integrity: valid=1 tampered-rejected=3` (chained receipts suite, `tests/rwa.test.mjs`).

## 6. Deployment addresses

| Contract | Address | Source |
| --- | --- | --- |
| **RWA execution vehicle** `CircuitDemoRWAAllocation` | `0x6d45BeB641132B19A89315110ea22565AcD38A63` | `artifacts/xlayer/deploy.json` |
| Registry (RWA vehicle) `CircuitMandateRegistry` | `0x6E8d0a0C740A2Bb1D8D271D02919a0f7c4f8356b` | `artifacts/xlayer/deploy.json` |
| Vault `CircuitPortfolioVault` | `0x86d66F4F892bcd91850703f4Ed9F140d1652358A` | `deployments/vault-xlayer-testnet.json` |
| Registry (managed-portfolio rig) | `0x4FE654814808d4DeB73D77e30815c2f23b969B9b` | `deployments/xlayer-testnet.json` |
| Guard `CircuitPortfolioGuard` | `0x41992657dAd81F89e61A29887b9bdd1F7cE9Ff77` | `deployments/xlayer-testnet.json` |
| Adapter `CircuitExecutionAdapter` | `0x1d9627396cFd9CfD19A0AB03eFd61e6A5A17B10F` | `deployments/xlayer-testnet.json` |

Deployer / executor (testnet): `0xB2F3c78c66B50589c7dD8bC2A937994d3F24eE21`. All on X Layer Testnet, chain 1952.

## 7. Transaction hashes

| Transaction | Hash | Where recorded |
| --- | --- | --- |
| **ACT 2 ALLOW execution** (allocation 5e12 → 6e12 wei, block 38732492, status 1) | `0xb9a7ebf0132dd1d490ad98b5cf60b51aefbff8a7eeb0987fe071d1f0d48a2f21` | `artifacts/xlayer/latest.json` → `acts.allow.txHash` |
| RWA vehicle deployment | `0x5a05afc8b5dccbb957839f3d45a9c9a4c3308145224bf7fff24e3a33b3c00d54` (block 38722221) | `artifacts/xlayer/deploy.json` |
| RWA asset registration | `0x145068e6414d3b22a46b11f651ff242c1b68d9217ec098ccb525c8197c40b37a` | `artifacts/xlayer/deploy.json` |
| RWA fund registration | `0xa60443304342bb91453c8e6c79635ec36a6ed111927de69adb32e2d3569d5843` | `artifacts/xlayer/deploy.json` |
| Guard blocked trade (equity rig) | `0x0afbbb5c5663bb5ac61673929d5fdb0e0c8fc893eb756fc9527e7ac9df35081b` | `deployments/xlayer-testnet.json` |
| Guard authorized trade (equity rig) | `0x5549e8cc24701fc28e6de10f3ac7d6ce0da56b0152bbd8ea573a95ba57b2f16f` | `deployments/xlayer-testnet.json` |

Explorer base: `https://www.okx.com/web3/explorer/xlayer-test`.

## 8. Contract test output

| Claim | Artifact / command |
| --- | --- |
| 115 Foundry tests, 0 failures (this pass) | `cd contracts && forge test` |

## 9. Node test output

| Claim | Artifact / command |
| --- | --- |
| 129 Node tests, including four live X Layer checks and OpenRouter tamper coverage | `npm test` |

## 10. Canonical judge scenario

| Claim | Artifact |
| --- | --- |
| $100,000 → 28.4% (28.39%) vs 20% → BLOCK; $35,000 → 19.1% (19.10%) → ALLOW | `src/competition/rwa/scenario.ts`, asserted in `tests/rwa.test.mjs`, reproduced live in `artifacts/xlayer/latest.json` (ACT 1 / ACT 2) |

## 11. Stale approval proof

| Claim | Artifact |
| --- | --- |
| Approval valid at T0 → dispute-flag state mutation → invalid at T1 (off-chain) + `EconomicStateChanged` revert (on-chain), capital moved 0 | `artifacts/xlayer/latest.json` → `acts.stale` [+ on-chain `EconomicStateChanged` refusal] |
| Staleness / replay rejection in the deterministic engine | verify output (`Stale approvals rejected: 8`, `Replay attempts rejected: 1`) |

## 12. Other packaged evidence

- `deployments/EVIDENCE.md` — managed-portfolio rig live traces (`ExecutionDenied(7)`, authorized trade, parity)
- `deployments/live-judge-trace.json` — historical OpenCode Go planning trace `[historical live]`
- `deployments/live-openrouter-proof.json` — current OpenRouter generation, evaluation, transaction, and readback proof bundle `[generated when configured]`

Generate the current bundle with `npm run prove:openrouter` while the server is running. Recompute all nine links with `npm run verify:openrouter-proof`.
- `deployments/parity-proof.json` — REST / MCP / engine parity (`parityHolds: true`)
- `deployments/traces/` — Codex / Claude MCP registration artifacts
- `FORGE_0.6_PROOF.md` — earlier-stage proof contract

## Claim → artifact quick map

| Question | Answer |
| --- | --- |
| Where is the proof for the BLOCK? | `artifacts/xlayer/latest.json` → `acts.block` (+ `receipts/block.json`) |
| Where is the proof for the ALLOW? | `latest.json` → `acts.allow` (+ tx hash, block, readback, receipts/allow.json) |
| Where is the proof for STALE? | `latest.json` → `acts.stale` (+ `EconomicStateChanged`) |
| Where is the benchmark? | `artifacts/benchmarks/latest.json` |
| Where are the corpora? | `src/competition/rwa/corpus.ts`, `corpus-holdout.ts` + benchmark artifact |
| Where are the contract addresses? | section 6 above |
| Where are the transactions? | section 7 above |
| Where are the contract tests? | `contracts/test/*.t.sol`, `forge test` |
| Where are the Node tests? | `tests/*.test.mjs`, `npm run check` |
| Where is the judge scenario? | `src/competition/rwa/scenario.ts` + `tests/rwa.test.mjs` |
| Where is the stale approval proof? | section 11 above |
