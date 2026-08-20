# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

CIRCUIT serves autonomous-finance builders, portfolio operators, and hackathon judges evaluating whether an AI-managed portfolio has a credible authorization boundary.

## Product Purpose

CIRCUIT evaluates the portfolio state an AI action would create. It blocks actions outside the active mandate and issues state-bound authorization only for compliant actions.

## Positioning

Asset verification answers whether an asset is real. CIRCUIT answers whether a specific fund should buy a specific amount under current asset, portfolio, and mandate state.

## Operating Context

Users review current portfolio state, agent proposals, projected exposure, mandate violations, approval freshness, X Layer execution, and linked receipts. External agents access the same workflow through MCP tools.

## Capabilities and Constraints

- Deterministic post-trade projection and mandate evaluation.
- Structured BLOCK and ALLOW decisions with repair feedback.
- Approvals bound to asset, portfolio, mandate, allocation, chain, nonce, and expiry.
- X Layer Testnet execution and receipt evidence.
- The canonical RWA scenario is synthetic and testnet amounts do not represent USD balances.
- The competition build is feature-frozen. Reproducibility fixes and landing-page presentation work remain in scope.

## Brand Commitments

- Product name: CIRCUIT.
- Voice: direct, technical, evidence-led, and honest about live versus synthetic proof.
- The landing page uses a bright industrial product-photography direction with chalk white, charcoal, and one amber-red signal color.
- Avoid invented commercial claims, customer logos, and production-custody claims.

## Evidence on Hand

- Canonical scenario and deterministic tests in `src/competition/rwa/` and `tests/rwa.test.mjs`.
- Live X Layer proof in `artifacts/xlayer/latest.json`.
- Deployment and transaction evidence indexed in `docs/EVIDENCE.md`.
- Product screenshot reference supplied by the user on 2026-08-20.
- Original CIRCUIT hero image at `web/assets/circuit-mandate-console.png`.

## Product Principles

- AI proposes. CIRCUIT authorizes.
- Evaluate the resulting portfolio, not the trade in isolation.
- Fail closed when provider, state, or authorization evidence is unavailable.
- Prove execution and refusal through inspectable artifacts.
- Label synthetic fixtures and testnet values without ambiguity.
