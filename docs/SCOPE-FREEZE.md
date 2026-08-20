# CIRCUIT — Scope Freeze (competition build)

Effective: 2026-08-20, after the reproducibility pass. The competition build is **frozen** for submission.

## In scope (frozen)

The repository as packaged in this pass: mandate engine, post-trade projection, state-bound approvals, chained receipts, corpora (29 dev + 8 holdout), Foundry contracts (registry / guard / vault / adapter / demo RWA vehicle), live three-act proof on X Layer Testnet, README + evidence index + status + demo notes.

## Post-competition work (explicitly NOT in this build)

The following are out of scope unless a real defect in the shipped proof requires them:

- additional mandate families
- cron monitoring
- alerting
- production indexers
- more RWA types
- additional portfolio dashboards
- generic liquidity infrastructure
- analytics
- governance
- production custody
- extra integrations

## Rules for the freeze

1. No new product features.
2. No new mandate families.
3. No monitoring / dashboards / analytics / speculative production features.
4. No refactors of working core logic unless a reproducibility test exposes a real defect.
5. Fixes must be limited to reproducibility defects and must re-run the full matrix (check → verify → forge test → prove:xlayer) before unfreezing the affected artifact.