# CIRCUIT

> A verified asset can still be the wrong investment.

> CIRCUIT is a mandate-gated execution layer for autonomous RWA capital on X Layer. It evaluates the current asset, portfolio, mandate, and proposed allocation before capital can move. Approvals are state-bound: if economic reality changes after approval, the authorization becomes invalid.

CIRCUIT does not ask *is this asset real?* — that is verification's job. CIRCUIT asks *should this fund buy this much of it right now?* The mandate — the financial state the portfolio is allowed to become — is the decision.

[Forge 0.7 status →](FORGE_STATUS.md) · [Evidence index →](docs/EVIDENCE.md) · [90-second judge demo →](docs/JUDGE-DEMO.md) · [Scope freeze →](docs/SCOPE-FREEZE.md)

---

## Live X Layer Proof

Live, executed on X Layer Testnet (chain 1952), end-to-end: off-chain mandate evaluation → state-bound approval → on-chain gate → real transaction → post-state readback. Every value below is rendered from `artifacts/xlayer/latest.json` (regenerate with `npm run prove:xlayer`; the README section updates itself via `npm run render:live`).

**Run:** `npm run prove:xlayer` (requires `CIRCUIT_PUBLISHER_KEY` in `.env`)

**RWA execution vehicle:** `CircuitDemoRWAAllocation` at `0x6d45BeB641132B19A89315110ea22565AcD38A63` — deployment `artifacts/xlayer/deploy.json`

**Asset under test:** `ACME-INV-8842` — **synthetic competition fixture**, not a real receivable (see [Real / Synthetic / Not claimed](#what-is-real--synthetic--not-claimed)).

<!-- LIVE-PROOF:START -->

### ACT 1 — BLOCK

| | |
| --- | --- |
| Verified asset | ACME-INV-8842 — VERIFIED (passport PASS-8842, yield 11.20%, maturity 74d, collateral ratio 1.32) |
| Proposed allocation | $100,000 |
| Projected mandate violation | `DEBTOR_CONCENTRATION_LIMIT` — debtor exposure 14.10% → 28.40% of NAV, mandate max 20.00% |
| Decision | **BLOCK** |
| Approval status | NO_VALID_APPROVAL — "Cannot create an approval for a BLOCKED evaluation." |
| On-chain refusal (observed) | REVERTS — `ExpiredApproval` (the gate was probed directly with an expired commitment; no new approval exists) |
| Capital moved | **0** |
| Allocation state unchanged | true |

### ACT 2 — ALLOW

| | |
| --- | --- |
| Mandate result | ALLOW — every rule passes; projected debtor exposure 19.10% stays under the 20.00% ceiling |
| State-bound approval | `AP-fund-alpha-1787191318861` — sha256 `1596213786f7d5b2d233a384538a06a3c1791889ed59d9ab7d05296579af1a62`, on-chain `0x58d7fb9c8a5e21d5cda1504a43f79929de58332894ef3babf535680fa0d17820`, expiry 2026-08-20T02:06:58.861Z |
| X Layer transaction | `0xb9a7ebf0132dd1d490ad98b5cf60b51aefbff8a7eeb0987fe071d1f0d48a2f21` |
| Confirmation | block 38732492 on chain 1952 (X Layer Testnet) — status 1, execution receipt present |
| Allocation before | 5000000000000 wei allocated |
| Allocation after | 6000000000000 wei allocated (+1000000000000 wei) |
| Readback integrity | true (post-state re-read equals committed state) |

### ACT 3 — STALE

| | |
| --- | --- |
| Approval valid at T0 | `AP-fund-alpha-1787191332978` — sha256 `590d127ec0cb2a30911ff86f89e4f080545465ba1774d6e73b78e567c7fea9f7`, on-chain `0xf7e9e7ef7e6585184719cc59f443a88696bca7155b9f3f954cf4d54310f76a59` |
| State mutation at T1 | asset economic-state hash changed (dispute flag) |
| Approval invalid at T1 | invalid — asset state changed since approval |
| Off-chain stale detection | REJECTED before sending |
| On-chain gate (probed) | REVERTS — `EconomicStateChanged` |
| Capital moved | **0** |
| Allocation / execution count unchanged | true / true |

> CIRCUIT does not authorize a transaction forever. It authorizes a specific transaction against a specific economic state.

<!-- LIVE-PROOF:END -->



---

## Verify in 60 Seconds

| Command | What it proves | Needs network? |
| --- | --- | --- |
| `npm install` | pinned dependency set | yes (once) |
| `npm run verify` | deterministic mandate engine, corpora, approvals, receipts, benchmark | **no** |
| `npm run prove:xlayer` | live BLOCK / ALLOW / STALE execution on X Layer Testnet | yes (X Layer) |

`npm run verify` is **deterministic/local competition verification** — a judge can run it offline and reproduce every decision. `npm run prove:xlayer` is the **live X Layer execution proof** — it sends real testnet transactions against the deployed gate.

Environment for `prove:xlayer` (copy `.env.example` → `.env`):

```bash
CIRCUIT_PUBLISHER_KEY=            # X Layer Testnet deployment key (never commit it)
# optional overrides:
# XLAYER_TESTNET_RPC=https://testrpc.xlayer.tech/terigon
```

No other variables are required. No secrets appear anywhere in this repository.

Expected final status formatting:

```text
npm run verify
--------------
CIRCUIT VERIFICATION
Mandate cases: 37/37
RESULT: PASS

npm run prove:xlayer
--------------------
CIRCUIT X LAYER EXECUTION PROOF
ACT 1 — MANDATE BLOCK          PASS
ACT 2 — MANDATE ALLOW          PASS
ACT 3 — STALE APPROVAL         PASS
RESULT: PASS
```

The scripts print their own results; nothing is hardcoded in this README.

---

## The canonical judge scenario

**ACME-INV-8842**: a verified, collateralized corporate credit (11.2% yield, 74-day maturity, passport PASS-8842, evidence age 0h, dispute-free). Fund ALPHA runs a **$700,000 NAV**, currently **14.1%** exposed to the ACME debtor, against a mandate ceiling of **20% maximum debtor exposure**.

The engine projects the *post-trade* portfolio and evaluates every mandate rule before any capital may move:

```text
Asset: VERIFIED
Current debtor exposure: 14.1%


Proposal A
Allocation: $100,000
Projected debtor exposure: 28.39%
Mandate maximum: 20%
Decision: BLOCK


Proposal B
Allocation: $35,000
Projected debtor exposure: 19.10%
Mandate maximum: 20%
Decision: ALLOW
```

The same verified asset. Two allocations. The boundary — not the asset — decides. `28.39%`, `14.1%`, `19.10%` are engine-computed projections (post-trade simulation of the exact portfolio), not display values; they are asserted in `tests/rwa.test.mjs`, reproduce via `npm run verify`, and were re-produced live on X Layer in the ACT 1 / ACT 2 executions above.

Fund BETA (35% debtor cap, but 12% minimum yield and 60-day maximum maturity) rejects ACME-INV-8842 entirely, even at small size — one asset, two mandates, two verdicts.

---

## State-bound approvals: the deeper thesis

> An allocation approval is valid only for the economic state that produced it.

An approval (`src/competition/rwa/approvals.ts`) commits to every dimension the decision depended on:

- **fund** — `fundKey`
- **asset** — `assetKey` and its `assetStateHash` (yield, maturity, dispute flag, evidence, collateral, verification…)
- **portfolio state** — `portfolioStateHash` (NAV and all exposure concentrations)
- **mandate / version** — `mandateHash`, `mandateVersion`
- **allocation** — `economicAmountUsd`, `liveAmountWei`
- **chain** — `chainId`
- **nonce** — single‑use, consumed exactly once
- **expiry** — the authorization dies at a timestamp

```text
If any committed state changes before execution:
APPROVAL_STALE
```

The on-chain gate enforces the same commitment. When ACT 3 changed the asset's economic state (dispute flag) after an approval was issued, the reused approval was rejected twice — first by the off-chain freshness check, then by the chain itself:

```text
Reason (off-chain): asset state changed since approval
Reason (on-chain gate): EconomicStateChanged
CAPITAL MOVED: 0
```

`EconomicStateChanged` is a revert observed live on X Layer Testnet — the chain refuses the transaction even if the off-chain layer were bypassed.

---

## What is real / synthetic / not claimed

### REAL

- Deterministic mandate evaluation: every rule, boundary, and reason code (`npm run verify`, 0 network needed)
- Post-trade portfolio simulation: projected debtor/issuer/sector/jurisdiction/portfolio exposure before capital moves
- State-bound approvals: nonce, expiry, single-use consumption; replay and staleness rejected (8 stale, 1 replay, 0 duplicate executions)
- Tamper-evident, chained decision receipts with verified sha256 linkage
- X Layer Testnet contracts (registry, guard, vault, adapter, RWA execution vehicle) — deployed and read back
- Real on-chain BLOCK / ALLOW / STALE execution on chain 1952, including a real ALLOW transaction and a real `EconomicStateChanged` revert
- Real transaction confirmation and real post-state readback (allocation changed `5e12` → `6e12` wei, integrity `true`)
- Generated development corpus (29) and holdout corpus (8) — the holdout was never used during development
- Foundry contract suite (115 tests) and Node suite (129 tests), including OpenRouter provenance and proof-tampering coverage

### SYNTHETIC

- `ACME-INV-8842` is a **competition RWA fixture**, not a production receivable — it exists only in the canonical scenario, the corpora, and the demo vehicle's registry
- The canonical `$100,000` / `$35,000` figures are **economic-notional scenarios**, not balances
- Live execution uses **X Layer Testnet units** (testnet OKB/wei), *not* USD
- The demo asset is **not represented as a production receivable** anywhere in this repository

### NOT CLAIMED

CIRCUIT is **not**:

- a production lending market
- an RWA issuer
- a custody provider
- a full liquidity protocol
- claiming the testnet token represents real USD investment
- claiming `ACME-INV-8842` is a real receivable

These disclaimers are also embedded in the generated artifacts (`syntheticRwaNote` in `artifacts/xlayer/latest.json`, `note` in `artifacts/xlayer/deploy.json`).

---

## Evidence index

Every claim maps to an artifact in **`docs/EVIDENCE.md`** — deterministic benchmark, development corpus, holdout corpus, live X Layer proof JSON, decision receipts, deployment addresses, transaction hashes, contract test output, Node test output, canonical judge scenario, and the stale-approval proof. A judge should be able to answer *"where is the proof for this claim?"* in seconds.

---

## Hardening findings (live proof → real defects)

The live proof harness found real implementation defects; they are fixed and covered:

| Finding | Detail |
| --- | --- |
| Encoding mismatch | `commitmentHash` expected `assetStateHashBytes32`; `buildOnchainApproval` emitted `assetStateHash`. `undefined` entered the ABI-encoding path and broke the commitment hash. |
| Exposed by | the live proof harness: the hash was computed on a real struct in `runActAllow` and failed with `invalid BytesLike value (value=null)` — unit fixtures never touched that code path |
| Fix | field renamed to `assetStateHash` in `commitmentHash` (`integrations/rwa-allocation.mjs`) |
| Regression coverage | hash is now computed on every live proof run; the mismatch cannot recur silently |
| Readback hardening | post-transaction state readback now retries for convergence against lagging public RPC nodes before declaring integrity |

The point stands: live verification found real implementation defects that deterministic tests did not.

---

## Why this is different

CIRCUIT is not a session key, payment budget, allowlist, or swap preflight checker. Those constrain an action. CIRCUIT is **stateful and financial**: it evaluates what the action would make the portfolio become, including asset-quality facts (yield, maturity, evidence age, dispute, collateral) that wallet permissions never see.

Mandate dimensions enforced by the deterministic engine:

- debtor / issuer / sector / jurisdiction exposure vs NAV
- allocation size vs single-allocation cap
- minimum yield, maximum maturity
- minimum liquidity, maximum risk score
- portfolio-level exposure cap
- verification state (asset must be verified), dispute, encumbrance
- evidence freshness, collateralization
- total invested capital / NAV, daily turnover / NAV
- closed-reference-market and material-event new-exposure caps

Each violation returns a machine-readable reason code (`DEBTOR_CONCENTRATION_LIMIT`, `ALLOCATION_SIZE_EXCEEDED`, `YIELD_BELOW_MINIMUM`, `MATURITY_EXCEEDED`, `ASSET_NOT_VERIFIED`, `EVIDENCE_STALE`, …) with observed and projected values — the material for AI replanning.

```text
CURRENT PORTFOLIO
      +
PROPOSED ALLOCATION
      ↓
POST-TRADE PORTFOLIO (projected)
      ↓
CIRCUIT MANDATE RUNTIME
      ↓
BLOCK → MACHINE FEEDBACK → AI REPLAN
      ↓
STATE-BOUND APPROVAL → DECISION RECEIPT
      ↓
X LAYER EXECUTION GATE (onchain re-commitment)
```

## Economic state

The engine operates on a frozen `EconomicState` per decision: asset ID, passport, issuer and debtor, jurisdiction, asset type, principal, yield, maturity, outstanding, collateral, verification, dispute, evidence timestamp and hash, risk score, chain identifiers — plus portfolio state (NAV, per-debtor / per-issuer / per-sector / per-jurisdiction exposures). The evaluation binds `mandateHash`, `assetStateHash` and `portfolioStateHash`; a mutation in any of them invalidates the decision.

## Corpora and benchmarks

- **Mandate cases** (37): every rule, boundary equality, staleness, replay, expiry, two-fund divergence
- **Development corpus** (29) with ground truth; **holdout corpus** (8) never used during development: 0 false admits, 0 false blocks
- Benchmarks written to `artifacts/benchmarks/latest.json` by `npm run verify` (decision latency included)

## Capital & execution layer

```text
OWNER WALLET → CONNECT → CREATE CIRCUIT PORTFOLIO → FUND → ACTIVATE MANDATE
      ↓
AI PROPOSES → CIRCUIT PROJECTS → BLOCK / COMPLIANT → STATE-BOUND APPROVAL
      ↓
CircuitPortfolioVault → CircuitPortfolioGuard → CircuitExecutionAdapter (whitelisted router)
      ↓
X LAYER
```

- `CircuitPortfolioVault.sol` — narrow execution account: owner-only deposit/withdraw/pause, mandate publishing, single agent entry `executeAuthorizedAction` (re-verifies mandate version, portfolio state hash, actions hash, expiry, nonce, signature before re-projecting every action)
- `CircuitExecutionAdapter.sol` — whitelisted router + explicit assets, exact-amount approvals, signed native spend caps; no generic calls
- Live on X Layer Testnet: see [deployment addresses](docs/EVIDENCE.md#deployment-addresses)
- **Venue truth**: OKX DEX lists one token on chain 1952 (native OKB; every pair returns `51001`) → swap execution reverts `UnsupportedRoute` there. Refused, never faked — receipts in `FORGE_STATUS.md`.

## Live planning loop

`POST /api/circuit/run` runs one loop per click: real market context → OpenRouter plan → Circuit rejection → OpenRouter replan → approval → execution → verified linked receipt. Each live plan binds its OpenRouter generation ID, request, completion, normalized output, model, provider metadata, and plan hash. Provider or provenance failures abort fail-closed (`AI_TIMEOUT` / `AI_PROVIDER_ERROR` / `AI_MALFORMED_OUTPUT` / `ONCHAIN_UNAVAILABLE`). Nothing is committed on failure.

## Run locally

```bash
npm install
npm run check        # typecheck + build + full Node suite
npm run verify       # mandate cases, corpora, approvals, receipts, benchmarks
npm run dev
npm run prove:openrouter       # fresh OpenRouter + OKX + X Layer proof
npm run verify:openrouter-proof # recompute every saved proof link
```

Open `http://127.0.0.1:4184` — landing, `/agent` (planning loop), `/gate` (RWA judge scenario), `/mandate`, `/proof`. `DEMO MODE` is deterministic and labeled. `LIVE AI` requires `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` and fails closed without both.

The default development model is `dots-studio/dots-3-note-preview:free`, a free OpenRouter model advertising structured-output support. Each proof records the requested model, resolved model, and upstream provider returned for every generation.

## X Layer contracts

```text
contracts/src/CircuitMandateRegistry.sol    versioned mandate + asset registry
contracts/src/CircuitPortfolioGuard.sol     authorized exposure state, authorizeTrade projection
contracts/src/CircuitPortfolioVault.sol     narrow execution account + EIP-712 authorization
contracts/src/CircuitExecutionAdapter.sol   whitelisted router, no generic calls
contracts/src/CircuitDemoRWAAllocation.sol  live RWA proof vehicle (synthetic fixture)
```

Contract checks:

```bash
cd contracts
forge build
forge test   # 115 tests, 0 failures in this pass
```

## Current verification (this pass)

- `npm run check` — typecheck, production build, full Node suite
- `npm run verify` — 37/37 mandate cases, 29/29 development corpus, 8/8 holdout, 7 admits / 17 blocks / 8 stale rejected / 1 replay rejected / 0 duplicate executions, receipt integrity valid 1 / tampered-rejected 3 — **RESULT: PASS**
- `forge test` — 115/115 contract tests — **PASS**
- `npm run prove:xlayer` — ACT 1 BLOCK / ACT 2 ALLOW (real testnet tx) / ACT 3 STALE (`EconomicStateChanged`) — **RESULT: PASS**; receipt chain verified (`blockValid`, `allowValid`, `staleValid`)

## Repository map

```text
src/competition/            types, mandate engine, post-state simulator, approvals,
                            chained receipts, corpora (29 + 8 holdout), ACME scenario
integrations/               openrouter-agent, xlayer-rpc, vault, xlayer-executor,
                            rwa-allocation (live proof orchestration)
scripts/circuit.mjs         VERIFY/BENCHMARK CLI
scripts/prove-xlayer.mjs    live three-act proof (npm run prove:xlayer)
scripts/render-live-proof.mjs  renders README live section from the artifact
tests/                      Node tests (engine, providers, approvals, receipts, corpora)
contracts/                  Solidity + 115 Foundry tests
web/                        landing, /agent, /gate, /mandate, /proof
artifacts/benchmarks/       benchmark artifact (npm run verify)
artifacts/xlayer/           live proof artifact + decision receipts (npm run prove:xlayer)
deployments/                contract metadata, traces, EVIDENCE
docs/                       EVIDENCE index, judge demo, scope freeze
```

---

## Core thesis

**The asset is real. The investment is still wrong — until the mandated portfolio permits it.**
