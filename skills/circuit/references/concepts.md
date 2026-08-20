# Circuit concepts

Reference for the Circuit MCP tools. Circuit owns STATE, PROJECT, EVALUATE,
AUTHORIZE, EXECUTE AUTHORIZED ACTION, PROVE. The agent owns REASON, PLAN,
REPLAN.

## Portfolio state

- `portfolioId` — e.g. `"alpha-01"` (maps to the onchain policy key).
- `portfolioStateHash` — hash of the authoritative onchain state (positions,
  cash, turnover, seed flag). Any state change invalidates prior
  evaluations/authorizations.
- `portfolioVersion` / `mandateVersion` — version of the active mandate.
- `circuit_get_portfolio` returns owner, vault, network, NAV, cash,
  positions, issuer exposures, sector exposures, daily turnover,
  `portfolioStateHash`, `portfolioVersion`. Read-only; call it before
  proposing and after every execution.

## Mandate

- `circuit_get_mandate` returns mandate id/version/hash, allowed assets,
  issuer limits, sector limits, turnover rules, and market restrictions
  (slippage, reference freshness, closed-market and material-event caps).
- Mandate dimensions enforced by the engine (all in bps unless noted):
  asset exposure / NAV, issuer concentration / NAV, sector concentration /
  NAV, invested capital / NAV, daily turnover / NAV, expected slippage,
  reference freshness, closed-market new-exposure cap, material-event
  new-exposure cap, available cash, plus the allowed asset universe.

## Evaluation

- `circuit_evaluate_action` is the single source of truth for BLOCKED /
  COMPLIANT. It returns:
  - `decision`: `"BLOCKED"` or `"COMPLIANT"`
  - `currentStateHash`, `projectedStateHash`
  - `mandateHash`, `mandateVersion`
  - `evaluationHash` — deterministic binding of portfolio + mandate +
    state + actions; keep it for the authorization request
  - `violations`: machine-readable, e.g.
    `{"code":"ISSUER_CONCENTRATION_EXCEEDED","issuer":"Tesla, Inc.",
    "projectedBps":4000,"maximumBps":3500}`
- The same evaluation hash must be produced by any caller for the same
  portfolio + mandate + actions — never trust your own re-computation.

## Repair constraints

- `circuit_explain_violation` returns deterministic structured repair info
  (violated rule, current/projected/maximum values, contributing limits).
  For concentration violations it includes
  `repairConstraints.maximumAdditionalIssuerExposureUsd` /
  `maximumAdditionalSectorExposureUsd`. No LLM is involved.

## Authorization

- `circuit_request_authorization` is consequential. Input: `portfolioId`,
  exact `actions`, `portfolioStateHash`, `mandateVersion`, `evaluationHash`
  (from your own evaluation call). Circuit refreshes onchain state,
  verifies the hashes/version, re-evaluates the actions, rejects BLOCKED
  and stale evaluations, then returns a short-lived signed
  `authorizationHash` + `expiry` bound to the exact action hash.
- The agent cannot supply its own compliance verdict — there is no
  `"authorized": true` input anywhere.

## Execution

- `circuit_execute_authorized_action` executes only an authorization already
  created by Circuit. It verifies unused/expiry/version/state/actions, then
  calls the guarded `CircuitPortfolioVault` on X Layer and captures the
  transaction.
- Outcomes are explicit: `EXECUTED` (with tx hash + receipt),
  `EXECUTION_UNSUPPORTED` (venue has no route — e.g. X Layer Testnet
  currently has no DEX pair), `STALE_STATE`, `STALE_MANDATE`, `EXPIRED`,
  `REPLAYED`, `ACTION_MISMATCH`, `PAUSED`, `ONCHAIN_UNAVAILABLE`. Anything
  other than `EXECUTED` is NOT success. Never describe it as executed.

## Receipts

- `circuit_get_receipt` returns the linked audit receipt: portfolio, owner,
  mandate hash/version, pre-state hash, plan/action hash, evaluation hash,
  authorization hash, execution tx, post-state hash, timestamp, receiptHash.
- Return the receipt to the user after every completed execution.
