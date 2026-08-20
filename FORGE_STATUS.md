# CIRCUIT — Competition Status (FORGE 0.7)

Every gate marked exactly once: `PASS` / `FAIL` / `NOT RUN` / `BLOCKED`. Rule: nothing is PROVEN without an inspectable artifact.

## Core hypothesis

> An allocation approval is valid only for the economic state that produced it. A verified asset can still be the wrong investment.

**Gate: PASS** — proven by the canonical scenario, corpora, and the full live X Layer three-act proof (`artifacts/xlayer/latest.json`).

## Sponsor-native primitive

> The mandate boundary preserved **on-chain** on X Layer: `CircuitPortfolioGuard.authorizeTrade` (equity rig) and `CircuitDemoRWAAllocation.execute` (RWA proof vehicle) re-project the state and revert on violation — the chain, not just the agent, refuses stale or non-compliant authorizations (`ExecutionDenied(7)` and `EconomicStateChanged` observed live).

**Gate: PASS** — reverts observed on chain 1952; contracts in `contracts/src/`.

## MCPL (Minimum Complete Proof Loop)

```text
asset + portfolio + mandate
→ proposed allocation
→ post-trade projection
→ mandate verdict (BLOCK / ALLOW)
→ state-bound approval (nonce, expiry, single-use)
→ real X Layer transaction
→ post-state readback
→ tamper-evident receipt
```

**Gate: PASS** — the loop ran end-to-end live, all three acts.

## Live X Layer proof

| Act | Result | Evidence |
| --- | --- | --- |
| ACT 1 — BLOCK (mandate ceiling, no approval, chain refuses `ExpiredApproval`) | **PASS** | `artifacts/xlayer/latest.json` → `acts.block` |
| ACT 2 — ALLOW (real tx, state 5e12 → 6e12 wei, readback integrity) | **PASS** | `latest.json` → `acts.allow`; tx `0xb9a7ebf0132dd1d490ad98b5cf60b51aefbff8a7eeb0987fe071d1f0d48a2f21`, block 38732492 |
| ACT 3 — STALE (state mutation → off-chain reject + on-chain `EconomicStateChanged`) | **PASS** | `latest.json` → `acts.stale` |
| Receipt chain verification | **PASS** | `blockValid` / `allowValid` / `staleValid` = true |

## Benchmark

- Node `npm run check`: **PASS** — 123/123 tests, typecheck + build + syntax checks
- Deterministic `npm run verify`: **PASS** — mandate cases 37/37, development corpus 29/29, holdout 8/8, admits 7, blocks 17, stale rejected 8, replay rejected 1, duplicate executions 0, receipt integrity valid 1 / tampered-rejected 3
- Contracts `forge test`: **PASS** — 115/115 (this pass; suite grew past the earlier 97)
- Artifacts: `artifacts/benchmarks/latest.json` (generatedAt, engine, per-case outcomes)

## Adversarial proof

| Attack | Result | Evidence |
| --- | --- | --- |
| Stale approval reuse | **PASS** — rejected off-chain + `EconomicStateChanged` on-chain, 0 moved | `acts.stale`; verify `Stale approvals rejected: 8` |
| Replay / duplicate execution | **PASS** — replay rejected 1, duplicate executions 0 (concurrency suite) | verify output; `tests/rwa.test.mjs` |
| Tampered receipt | **PASS** — 3 tampered receipts rejected | verify output |
| Commit mismatch between producers | **PASS** — `commitmentHash` field mismatch found by the live harness, fixed, regression-covered | README → Hardening findings; `tests/rwa.test.mjs` |

## Receipt integrity

**Gate: PASS** — chained, hash-linked decision receipts; per-act files in `artifacts/xlayer/receipts/`, sha256 linkage verified (`receipts.*Valid`), tamper-evidence tested (1 valid / 3 rejected).

## Known limitations

- **Synthetic asset**: ACME-INV-8842 is a competition fixture, not a receivable (stated in README, artifact, deploy file).
- **Testnet units**: live execution moves testnet token units, not USD.
- **Venue**: OKX DEX on chain 1952 lists one token; swap execution reverts `UnsupportedRoute` — refused, never faked.
- **No git history**: artifacts carry `commitSha: null` (no repo in build environment); provenance is via regenerated artifacts, not commit pins.
- **Live AI agents**: provider account limits blocked full Codex/Claude live conversations (MCP registration verified; traces in `deployments/traces/`).

## Reproduction commands

```bash
npm install
npm run check          # deterministic: typecheck + 123 Node tests
npm run verify         # deterministic: mandate cases, corpora, receipts, benchmark
cd contracts && forge test   # 115 contract tests
npm run prove:xlayer   # live: three-act X Layer proof (needs CIRCUIT_PUBLISHER_KEY in .env)
```

## Final FORGE 0.7 score

| Gate | Verdict |
| --- | --- |
| Core hypothesis | PASS |
| Sponsor-native primitive | PASS |
| MCPL | PASS |
| Live X Layer proof | PASS |
| Benchmark | PASS |
| Adversarial proof | PASS |
| Receipt integrity | PASS |
| Known limitations | DISCLOSED |
| Reproduction | PASS |

**PASS — submission-ready.**