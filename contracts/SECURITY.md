# Circuit — contract security model

Scope: `contracts/src/CircuitMandateRegistry.sol` and `contracts/src/CircuitPortfolioGuard.sol`.

Circuit's contracts enforce **resulting portfolio state**, not per-transaction spending limits. A trade is authorized only when the portfolio state it would create remains inside the published mandate. This document records the trust boundaries, privileged roles, replay protection, policy-update authority, state-accounting assumptions and known MVP limitations.

## 1. Trust boundaries

```text
              OFFCHAIN                              ONCHAIN
 ┌────────────────────────────────┐   ┌──────────────────────────────────┐
 │ Circuit runtime (publisher)    │   │ CircuitMandateRegistry           │
 │  - proposes/intends trades     │──▶│  - versioned mandate + asset     │
 │  - attests market facts        │   │    → issuer → sector graph       │
 │  - never decides authorization │   ├──────────────────────────────────┤
 └────────────────────────────────┘   │ CircuitPortfolioGuard            │
                                      │  - projects post-trade state     │
                                      │  - evaluates the mandate         │
                                      │  - commits only on authorization │
                                      └──────────────────────────────────┘
```

- The **publisher** (Circuit's offchain runtime, or a rotation of it) is the only actor that can publish mandates, register assets and submit trade intents.
- The publisher **cannot** decide the outcome. Authorization is a deterministic function of the stored portfolio state, the published mandate and the attested trade context. There is no override path, no pause-and-force flag.
- The **owner** controls authority only (publisher and owner rotation). The owner cannot mutate mandates, assets or portfolio state.
- The guard is **not an asset custodian**. It is a stateful boundary ledger. It never holds tokens; token custody/settlement happens in a separate layer and must reconcile with the ledger. A settlement layer that ignores the guard's verdict is outside these contracts' protection.
- Onchain enforcement of dynamic facts (reference freshness, market session, material events, expected slippage) depends on **publisher-attested context**. The contracts enforce the mandate limits over those facts; they do not verify the facts themselves. The attestation duty is a publisher responsibility (see §6).

## 2. Privileged roles

| Role | Held by | Powers | Cannot |
| --- | --- | --- | --- |
| `owner` | deployer | `setPublisher`, `transferOwnership` | publish mandates, register assets, seed, trade |
| `publisher` | designated at construction, rotated by owner | publish/disable mandates, register/toggle assets, seed portfolios, submit `authorizeTrade` | bypass mandate evaluation, mutate committed state, replay intents |

- Both rotations are single-step and take effect **immediately** (no timelock). This is an MVP simplification; a timelocked two-step rotation is the recommended hardening for production funds.
- `transferOwnership` and `setPublisher` reject `address(0)`.
- A compromised publisher can at worst: disable a mandate, publish a *weaker* mandate (subject to version ordering, but the content is publisher-chosen), mislabel asset classification, or attest false market context. It **cannot** fabricate portfolio state (state only changes through `authorizeTrade`, which must pass the published mandate), and it cannot overwrite an older version over a newer one.

## 3. Replay protection

- Every `authorizeTrade` carries a unique `intentHash`. The guard stores `consumedIntent[intentHash]`; a consumed hash reverts with `IntentAlreadyConsumed()`.
- Consumption is **global** across policies and assets — a hash used for one policy/asset cannot be reused anywhere on the guard.
- Rejected trades do **not** consume the hash (the revert rolls back `consumedIntent`), so a rejected intent can be corrected and resubmitted under a new hash; the same hash never executes twice.
- The authorization hash returned by `authorizeTrade` binds `chainId`, guard address, policy, intent, mandate hash + version and the full resulting state — a deterministic, verifiable receipt of exactly one committed transition.

## 4. Policy-update authority

- Only the publisher publishes mandates (`publishMandate`).
- Versions are strictly monotonic per policy key: `next.version <= current.version` reverts with `VersionRegression()`. Equal-version republish is impossible.
- `setMandateEnabled` toggles an existing mandate without a version bump (emergency stop / re-enable); it cannot resurrect an expired mandate (expiry is checked in the guard).
- Mandates expire: the guard rejects `block.timestamp >= validUntil` with `REASON_EXPIRED`.
- Mandate content validation on publish: non-zero hash/NAV/freshness, `validUntil` in the future, every bps cap `<= 10_000`.
- Asset classification (`registerAsset`) and eligibility (`setAssetEnabled`) are publisher-only; re-registration overwrites issuer/sector mapping. Changing classification of an asset with existing exposure can retroactively relax/收紧 concentration accounting — the publisher is trusted not to do this without a mandate/policy migration.

## 5. State-accounting assumptions

- All exposures and notionals are **USD amounts scaled 1e18** (`notionalUsdE18`). NAV is fixed per mandate version (`navUsdE18`); the guard does **not** take price oracles — valuation of existing holdings is frozen at the nominal amounts committed onchain.
- `seedPortfolio` runs exactly once per policy key. The seeded state must satisfy the mandate, and `invested + cash <= NAV` is enforced; the invariant is preserved by every trade (BUY moves cash→invested, SELL moves invested→cash).
- Exposure buckets are computed additively: BUY increases asset/issuer/sector buckets and invested capital; SELL decreases them. Overselling reverts (`REASON_POSITION`); SELL proceeds credit the cash ledger.
- Daily turnover accumulates per UTC day (`block.timestamp / 1 days`); the counter resets when the day changes. There is no offchain feed — the boundary uses block time (see §6).
- Boundary comparisons are inclusive: exposure equal to the cap passes; one unit above fails (`exposure * 10_000 <= nav * maxBps`). Multiplication is checked and reverts on overflow.
- Rejections are atomic: `ExecutionDenied(reason)` reverts the whole call — no partial state writes ever commit.

## 6. Known MVP limitations

- **`block.timestamp` tolerance.** Mandate expiry and turnover-day rollover use `block.timestamp`, which validators can nudge within protocol bounds. Material for mandate expiry windows shorter than a few minutes; acceptable for day-granularity state.
- **Attested market facts.** Reference freshness, market-session closure, material events and expected slippage arrive as publisher-attested `TradeContext` input. A dishonest publisher can lie; a dishonest publisher is a privileged role by design (see §2). Hardening path: oracle/attestation signatures verified onchain.
- **No onchain price feed / revaluation.** The guard is a nominal-USD ledger. Market-driven value changes of existing holdings are not reflected; rebalancing against drift requires new policy versions and offchain simulation first.
- **No multi-sig / timelock on authority rotation.** Single-EOA owner and publisher; single-step rotation.
- **No guard upgrade path.** `registry` is immutable; upgrading the registry or guard requires a fresh deployment plus migration of seeded state.
- **One seed per policy.** Re-seeding a policy (e.g., after a corporate action) requires a new policy key. `seedPortfolio` also cannot run for a disabled/expired mandate.
- **Publisher self-restraint on asset reclassification.** `registerAsset` may overwrite issuer/sector for an asset that already carries exposure; the contracts do not track classification history per version.
- **Daily turnover vs. mandate publication time.** The day boundary is UTC-based and does not align to mandate creation time.
- **No native-token custody semantics.** Cash is a ledger figure; nothing prevents offchain settlement divergence unless the settlement layer enforces the guard's verdict.

## 7. Upgrade / migration posture

Contracts are deliberately non-upgradeable. Migration procedure for a future version:

1. Deploy new registry + guard.
2. Publish the same or revised mandate on the new registry.
3. Re-seed portfolio state on the new guard (verified against the new mandate).
4. Point Circuit's offchain runtime at the new addresses (env: `CIRCUIT_MANDATE_REGISTRY`, `CIRCUIT_PORTFOLIO_GUARD`).
5. Keep the old guard readable for audit; stop routing intents to it (optionally disable its mandate via publisher).

## 8. Verification

```bash
cd contracts
forge fmt --check
forge build
forge test -vvv
```

The test suite covers mandate lifecycle, authority violations, version ordering, expiry/disable, asset eligibility, seeding, every exposure limit, cash, turnover (incl. day rollover), slippage, stale-reference, closed-market and material-event restrictions, BUY/SELL, projections, rollback, replay, deterministic authorization hashes, events, malformed input and boundary equality (35.00% passes / 35.01% fails), plus the critical judge story (TSLA 15% → +$2,500 → 40% → revert → +$1,500 → 30% → authorized).

---

# CircuitPortfolioVault + CircuitExecutionAdapter (capital layer)

Scope: `CircuitPortfolioVault.sol`, `CircuitExecutionAdapter.sol` (added 2026-08-15).

## Trust boundaries

- **Owner** (connected human wallet): deposit, emergency withdraw, publish mandate, pause, set agent/authorizer/adapter, transfer ownership, register assets, seed.
- **Agent** (Circuit runtime EOA): only `executeAuthorizedAction` with a valid EIP-712 authorization signed by the **authorizer**. The agent cannot change mandates, raise limits, withdraw, pause, replace the guard/adapter, or transfer tokens — 30 forge tests cover every forbidden path.
- **Guard is the gate**: `authorizeTrade` is publisher-only, and the vault is the registry publisher. The agent can never call the guard directly (tested).
- **Browser cannot fabricate authorization**: there is no `authorized: true` input. The vault re-verifies mandate version, portfolio state hash, actions hash, expiry, nonce and the authorizer signature, then re-projects every action through the guard.

## Execution adapter (least privilege)

- No generic `call(target, data)`: target must equal the owner-whitelisted OKX router, asset must be explicitly enabled, calldata selector must be non-zero, spend is capped by the signed per-action `maxNativeWei`, the vault funds the adapter with exactly that sum (`SpendMismatch` otherwise), and token approvals are exact-amount (never unlimited — tested).
- Failed routes revert atomically: guard state, consumed nonce and balances all roll back.

## Venue reality (honest limitation)

OKX DEX on X Layer Testnet (1952) lists one token (native TESTNET_OKB); every pair returns `51001`. The adapter therefore reverts `UnsupportedRoute` and no capital moves — correct fail-closed behavior, verified onchain via fork test. The identical path executes when a supported pair/venue exists (e.g., X Layer mainnet, or testnet pools).

## Residual risks

- block.timestamp for expiry (tolerance documented above).
- Authorizer key compromise = arbitrary *evaluated* actions could be signed; the guard still enforces the mandate limits onchain, and the owner can rotate `setAuthorizer` and `setAgent`.
- Owner is a single address (no multisig/timelock) — MVP simplification.
- Deposit value is not reflected in guard cash until the owner (re)seeds; seed is once-per-policy by guard design.
- The adapter trusts the whitelisted router's returned output amount; only zero-output and call-failure are checked.
