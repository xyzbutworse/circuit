# Circuit / Build X submission checklist

Status legend: `DONE` proven with artifacts · `OPEN` needs organizer-side action · `NEEDS KEY` implemented, blocked on owner credentials (fail-closed, never mocked).

## Hard eligibility

- [ ] AI is materially incorporated into the product (NEEDS KEY) — OpenRouter integration and generation verification are implemented; a fresh `deployments/live-openrouter-proof.json` requires `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. The prior OpenCode Go trace remains historical evidence only.
- [x] X Layer Testnet deployment exists during the hackathon — registry + guard deployed, bytecode-verified (DONE)
- [ ] dedicated Circuit X account exists and is active (OPEN)
- [ ] submission post tags `@XLayerOfficial` (OPEN)
- [ ] live project URL works in a fresh browser — local `http://127.0.0.1:4184` works; public host TBD (OPEN)
- [ ] public GitHub repository works from a clean clone — clean-clone verification passed locally; repo not yet published (OPEN)

## Minimum Complete Proof Loop

- [x] current portfolio is visible
- [x] user objective is editable and fed to the planner
- [x] OKX Onchain OS market context participates in the live agent workflow — live authenticated quotes captured (TSLAx $341.48 / GOOGLx $347.29 / MSTRx $93.16, `deployments/live-judge-trace.json`)
- [ ] OpenRouter agent proposes structured trade intents (NEEDS KEY) — implementation and tamper tests pass; fresh provider evidence is pending credentials.
- [x] Circuit projects post-trade state
- [x] initial action violates issuer concentration despite being individually plausible — 40% vs 35%
- [x] machine-readable violation feedback exists (`code`, `issuer`, `projectedExposureBps`, `limitBps`)
- [x] repaired plan is deterministically authorized
- [x] onchain X Layer stateful guard blocks the same trade (`ExecutionDenied(7)`, tx `0x0afb…081b`) and authorizes the repaired plan (tx `0x5549…f16f`, event + authorization hash)
- [x] receipts bind objective, plans, rejection, mandate, policy version, intent, authorization, transaction and final portfolio hashes; exportable JSON
- [ ] live OpenRouter run with verified provider output (NEEDS KEY) — target artifact: `deployments/live-openrouter-proof.json`
- [ ] fresh OKX + OpenRouter + X Layer chain captured together (NEEDS KEY) — historical OpenCode proof stays labeled separately.

## Judge proof surface

- [x] demo data explicitly labeled (`FIXTURE AGENT / DEMO ONLY`, `FIXTURE MARKET DATA`)
- [x] live AI never silently falls back — `AI UNAVAILABLE` fail-closed
- [x] live OKX never silently falls back — `MISCONFIGURED` / `UNAVAILABLE` / `UNSUPPORTED` per asset
- [x] undeployed contracts display `PENDING`
- [x] deployed registry explorer link visible (`/api/proof/network`)
- [x] deployed guard explorer link visible
- [x] failed X Layer authorization evidence captured (status 0x0 tx + RPC trace + decoded revert)
- [x] successful X Layer authorization transactions visible (3 trades, blocks, auth hash)
- [x] "X LAYER TESTNET — LIVE" appears only after runtime bytecode checks pass
- [x] real OKX provenance in a judge run (`deployments/live-judge-trace.json`, LIVE quotes in trace + provider panel)

## Final repo verification

```bash
npm install
npm run typecheck
npm test
npm run build

cd contracts
forge fmt --check
forge build
forge test -vvv
```

The current Node suite contains 129 tests. The four configured live X Layer checks and the 126-test non-live run passed on 2026-08-20. The contract suite contains 115 tests.

Then verify:

- [x] no secrets committed (deployer key only in gitignored `.env`)
- [x] no console errors
- [x] no fake metrics
- [x] no stale positioning copy; differentiation is the headline
- [x] no claim of live integration when credentials are absent
- [x] README addresses match deployment exactly
- [x] site works on common laptop and mobile sizes (media queries; no browser screenshot captured yet)

## Submission assets

- [x] project name — Circuit
- [x] concise project description (below)
- [ ] live product URL (OPEN)
- [ ] GitHub URL (OPEN)
- [ ] email (OPEN)
- [ ] Telegram (OPEN)
- [ ] Circuit X handle (OPEN)
- [ ] required X submission post URL (OPEN)

## Final project description

**Circuit — a mandate runtime for AI-managed tokenized-asset portfolios on X Layer.**

Wallet permissions control what an agent can spend. Circuit controls the financial state an agent is allowed to create. When an AI proposes a trade, Circuit applies it to the current portfolio first, projects the resulting asset / issuer / sector / invested-capital / cash / turnover state, and authorizes only the trades whose future state stays inside the portfolio mandate — onchain, on X Layer.

A trade may be technically valid and still create a portfolio state that violates its financial mandate. Circuit evaluates the state the agent is about to create.

Demo: a $10,000 NAV portfolio holding $1,500 TSLAx (15%). The AI proposes buying $2,500 more TSLAx — individually plausible. Circuit projects Tesla issuer exposure of 40% against a 35% mandate ceiling and blocks it with machine-readable feedback (`ISSUER_CONCENTRATION_EXCEEDED`, 4000bps/3500bps). The AI replans (+$1,500), Circuit re-evaluates, the X Layer portfolio guard authorizes the exact replanned trades onchain, and one linked receipt binds objective → plans → rejection → mandate → authorization → final state.

## Verdict

**NEEDS OPENROUTER PROOF RUN.** The OpenRouter adapter, generation provenance, receipt verifier, deterministic evaluator, and X Layer path are implemented. A fresh OpenRouter generation and linked X Layer artifact remain pending `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. Historical OpenCode Go evidence does not satisfy the new provider claim.
