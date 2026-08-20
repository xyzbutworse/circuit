# Circuit workflow — exact sequences

## 1. Informational requests (no execution)

When the user only asks about the portfolio, mandate, or what would happen:

1. `circuit_get_portfolio { "portfolioId": "alpha-01" }`
2. `circuit_get_mandate { "portfolioId": "alpha-01" }`
3. If they ask "what if": `circuit_project_action` or
   `circuit_evaluate_action` with the candidate actions.

Do **not** request authorization. Do **not** execute anything.

## 2. Blocked → repair → compliant

1. Read state + mandate (above).
2. Form candidate actions (1–6 actions; each has `asset`, `assetId`,
   `side` BUY/SELL, `notionalUsd`, optional `expectedSlippageBps`).
3. `circuit_evaluate_action` → `decision: "BLOCKED"`.
4. Inspect `violations`. Optionally call `circuit_explain_violation` with
   the violation object for repair constraints.
5. Replan. The repaired plan must differ from the blocked one — never
   resubmit an unchanged proposal.
6. `circuit_evaluate_action` again → `decision: "COMPLIANT"`.
7. Report the compliant plan with its `evaluationHash`. Stop unless the
   user explicitly asks to execute.

## 3. Compliant → authorization → execution → receipt

Only when the user explicitly wants the investment executed:

1. You already have the COMPLIANT evaluation result. Save:
   `portfolioStateHash`, `mandateVersion`, `evaluationHash`, and the exact
   `actions` array.
2. `circuit_request_authorization` with those exact values. BLOCKED or
   stale inputs are rejected — fix nothing silently, re-evaluate instead.
3. Keep the returned `authorizationHash` + `expiry`. Authorizations are
   short-lived.
4. `circuit_execute_authorized_action` with `portfolioId` +
   `authorizationHash`.
   - `EXECUTED` → continue to step 5.
   - Any other status (e.g. `EXECUTION_UNSUPPORTED`, `REPLAYED`,
     `STALE_STATE`, `PAUSED`, `EXPIRED`) → report it verbatim. It is NOT
     execution. Never fabricate a success.
5. `circuit_get_receipt` with the receipt id (or use the receipt returned
   by the execution). Report the receipt fields (tx hash, hashes,
   timestamps) to the user.
6. Optionally re-read `circuit_get_portfolio` to confirm the updated state.

## 4. State changes invalidate prior work

- After any successful execution, portfolio state changes: old evaluations
  and authorizations are stale by design.
- If the mandate version changes (owner operation), everything prior is
  stale.
- Re-run the workflow from step 1 — never reuse old hashes.

## 5. Error handling

- `STALE_STATE` / `STALE_MANDATE` / `STALE_EVALUATION`: re-read state and
  re-evaluate. Do not retry the same request.
- `BLOCKED`: replan using violations, or report that the objective cannot
  be met within the mandate.
- `ONCHAIN_UNAVAILABLE` / `VAULT_UNAVAILABLE`: fail closed — report that
  Circuit could not verify state; do not proceed to execution.
- `EXECUTION_UNSUPPORTED`: the venue cannot execute this route. Report it
  honestly; do not claim a trade happened.

## 6. Authority boundaries

- The user's wallet being connected is not permission to trade.
- Wallet permission ≠ mandate permission.
- Mandate changes (limits, allowed assets, pause) are owner operations
  through the vault — never something the agent performs or claims to
  perform on the user's behalf unless the user explicitly drives a
  legitimate owner-controlled flow.
