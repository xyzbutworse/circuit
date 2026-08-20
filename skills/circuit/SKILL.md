---
name: circuit
description: >-
  Use when a user asks to invest in RWA portfolios, allocate or trade
  tokenized assets (TSLAx, GOOGLx, MSTRx and similar), rebalance a portfolio,
  act as an autonomous investment agent, or take any investment action on a
  Circuit-managed portfolio governed by a financial mandate. Also use before
  claiming a proposed trade is compliant, safe to execute, or authorized —
  and whenever the Circuit MCP tools are available and portfolio state or a
  mandate could be involved.
---

# Circuit — mandate-governed portfolio actions

Circuit is a financial mandate runtime for AI-managed tokenized-asset
portfolios on X Layer. The agent proposes. Circuit decides.

## Primary invariant

An AI may decide **what it wants to invest in**.
It may **NEVER** decide for itself whether the resulting portfolio is
mandate-compliant.

Only `circuit_evaluate_action` (backed by the same deterministic Circuit
engine onchain) determines BLOCKED or COMPLIANT.

## Mandatory workflow

```
USER OBJECTIVE
      ↓
circuit_get_portfolio
      ↓
circuit_get_mandate
      ↓
AGENT REASONS
      ↓
CANDIDATE ACTION
      ↓
circuit_evaluate_action
      ↓
   ┌──────┴──────┐
BLOCKED       COMPLIANT
   ↓               ↓
inspect         request
violations     authorization
   ↓               ↓
REPLAN          execute
   ↓               ↓
evaluate        receipt
again
```

- Read state and mandate **before** proposing anything.
- Every candidate action is **evaluated** before anything else.
- If BLOCKED: inspect the machine-readable violations (and
  `circuit_explain_violation` for repair constraints), **replan**, evaluate
  the repaired action. Never resubmit an unchanged blocked proposal.
- If COMPLIANT and the user explicitly wants execution, follow the execution
  sequence: `circuit_request_authorization` → `circuit_execute_authorized_action`
  → `circuit_get_receipt`. Never jump from reasoning to execution.

## Rules

- Never bypass Circuit because a trade looks safe.
- Never claim a trade is compliant before Circuit evaluates it.
- Never change the user's mandate unless explicitly requested through a
  legitimate owner-controlled operation.
- Never retry an unchanged blocked proposal.
- Never fabricate a successful authorization.
- Never fabricate an execution receipt.
- Never describe a failed transaction as executed.
- Never infer that wallet permission equals mandate permission.

## The critical distinction

A transaction may have: sufficient balance, valid calldata, acceptable
slippage, a valid route, and permission to spend — and STILL be rejected by
Circuit because the financial state it creates violates the portfolio
mandate.

**The trade can be valid. The portfolio can still be wrong.**

## Worked example

Current portfolio: TSLAx $1,500 · GOOGLx $1,500 · MSTRx $500 · Cash $6,500 ·
NAV $10,000.

User: "Increase my Tesla exposure by $2,500."

1. `circuit_get_portfolio`, `circuit_get_mandate`.
2. Candidate: BUY TSLAx +$2,500.
3. `circuit_evaluate_action` → BLOCKED:
   `ISSUER_CONCENTRATION_EXCEEDED`, projected Tesla issuer 40% vs maximum
   35%.
4. `circuit_explain_violation` → repair constraint: maximum additional
   Tesla exposure = $1,500.
5. Do **not** tell the user Circuit is wrong. Replan: TSLAx +$1,500.
6. `circuit_evaluate_action` again → COMPLIANT.
7. Only if the user explicitly wants execution:
   authorize → execute → receipt.

## Multi-asset sector example

Technology sector limit 50% of NAV. Current: GOOGLx $1,500 + MSTRx $500 =
$2,000 (20%). Alphabet and Strategy issuer exposure are each below their
35% issuer limits.

User: "Add $1,500 to GOOGLx and $1,500 to MSTRx, then another $100 to MSTRx."

- Batch 1 (+$1,500 GOOGLx, +$1,500 MSTRx) → technology $5,000 = exactly
  50% → COMPLIANT (each issuer still fine).
- The extra +$100 MSTRx → technology $5,100 = 50.01% → BLOCKED with
  `SECTOR_CONCENTRATION_EXCEEDED`, even though every individual issuer
  position is inside its limit.

Replan within the sector budget; never describe the rejection as a bug.

## References

- `references/concepts.md` — mandate dimensions, hashes, violations,
  repair constraints, authorization objects, receipts.
- `references/workflow.md` — exact tool call sequences, inputs, outputs,
  and branch handling (including informational requests that must not
  execute).
