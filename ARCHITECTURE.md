# Circuit architecture

## Trust boundary

Circuit separates probabilistic planning from deterministic authorization.

```text
                    PORTFOLIO MANDATE
                           │
                           ▼
CURRENT PORTFOLIO ──► CIRCUIT STATE ENGINE ◄── MARKET CONTEXT
                           ▲
                           │
                     AI TRADE PLAN
                           │
                           ▼
                    PROJECTED STATE
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
          BLOCKED                    AUTHORIZED
             │                           │
   structured violations                ▼
             │                  X LAYER PORTFOLIO GUARD
             ▼                           │
          AI REPLAN                state advances
```

The AI cannot set `AUTHORIZED`. It only returns structured trade intents. The same deterministic evaluator handles fixture plans and live-model plans.

Live AI requests use OpenRouter's OpenAI-compatible chat endpoint (`integrations/openrouter-agent.mjs`). Every returned plan stores the OpenRouter generation ID, requested and resolved model, upstream provider when reported, request hash, exact completion hash, normalized output hash, token counts, and generation-metadata verification time. Missing credentials, missing generation IDs, malformed JSON, or unverifiable generation metadata fail closed. OpenCode Go artifacts under `deployments/` are historical and do not satisfy the current OpenRouter proof claim.

The live loop is orchestrated server-side (`src/competition/planner.ts`): user objective → plan → Circuit projection → structured rejection → bounded replan → re-evaluation. The first pass receives no Circuit verdict and no mandate limits. Rejections are machine-readable (`code`, named bucket, `projectedExposureBps`, `limitBps`). Only the final authorized decision commits portfolio state; the full run is stored as a planning trace.

Live market data comes from OKX Onchain OS (`src/integrations/okx.ts`). Authenticated requests (`OK-ACCESS-*` HMAC headers) feed normalized `MarketContext` objects — index price, DEX-derived expected slippage and RWA liquidity for TSLAx / GOOGLx / MSTRx — into both the AI planner payload and Circuit's evaluator (prices, reference freshness, market session). Provider state is explicit per asset: `LIVE`, `UNAVAILABLE`, `MISCONFIGURED`, `UNSUPPORTED`. Assets with no OKX reference are unsupported, never fabricated; missing credentials are misconfigured; fixture market data exists only in labeled demo mode. The raw normalized response is stored in the planning trace and rendered in the proof panel.

## Financial state

A portfolio contains NAV, cash, holdings and daily turnover. Asset metadata maps every supported instrument to an issuer and sector. Circuit projects BUY / SELL intents into a future portfolio and recomputes exposure buckets.

The initial PoC intentionally uses one RWA family and three assets rather than pretending to solve every instrument class.

## Deterministic constraints

Circuit currently evaluates:

- allowed asset / asset class
- available cash / sellable position
- expected slippage
- reference freshness
- closed-market buy cap
- material-event buy cap
- asset / NAV exposure
- issuer / NAV exposure
- sector / NAV exposure
- invested capital / NAV
- daily turnover / NAV

## Onchain proof

The X Layer contracts prove the novel part of the concept rather than reimplement every offchain market-data rule.

`CircuitMandateRegistry` publishes:

- mandate hash + version
- NAV
- asset / issuer / sector / invested / turnover ceilings
- asset → issuer → sector profiles

`CircuitPortfolioGuard` maintains the last authorized exposure state for a policy key — asset / issuer / sector buckets, invested capital, cash and daily turnover. A trade call projects the next onchain exposure state, rejects mandate violations and updates state only on authorization. Onchain-enforced dimensions: concentration ceilings, invested/turnover limits, available cash, expected slippage, and publisher-attested market-condition caps (reference freshness, closed-market, material-event) for new exposure. Trade intents are replay-protected by a consumed-intent hash and produce a deterministic authorization hash; versions are strictly monotonic per policy key.

Dynamic facts such as reference freshness and material events remain attested by the publisher onchain because they require oracle / attestation infrastructure. They are enforced by the guard as mandate limits over that context; the attestation trust boundary is documented in `contracts/SECURITY.md`. Verified: `forge fmt --check`, `forge build`, `forge test -vvv` (67 tests), including the critical boundary proof — TSLA 15% → +$2,500 → projected 40% vs 35% → revert → +$1,500 → 30% → authorized.

## Proof receipt

Every evaluation produces hashes for:

- mandate
- plan
- before portfolio
- after portfolio
- prior receipt

The judge receipt also binds every OpenRouter generation, every evaluation receipt hash, each X Layer intent and transaction, and the onchain readback hash. `verifyJudgeReceipt` recomputes those links. The proof interface reports `PROVEN` only when the relevant verifier checks pass.

The receipt is an audit surface, not a claim that an offchain decision is itself blockchain-final.

## Failure posture

- missing live AI key → `AI_UNAVAILABLE`, no fixture fallback, no state commit
- AI timeout / provider failure → `AI_TIMEOUT` / `AI_PROVIDER_ERROR`, run aborts fail-closed
- malformed AI output → `AI_MALFORMED_OUTPUT`, run aborts fail-closed
- missing OKX credentials → market context `MISCONFIGURED`, no fixture substitution
- OKX network failure / timeout / x402 payment → market context `UNAVAILABLE`
- asset without an OKX reference → `UNSUPPORTED`, excluded from the tradable universe
- blocked plan → structured violation feedback → replan (bounded by the attempt budget)
- attempt budget exhausted → `EXHAUSTED`, portfolio state does not commit
- unknown asset → blocked
- stale reference → blocked for new exposure
- missing X Layer deployment → UI says pending
- RPC failure → status says offline
- authorized plan → only then may session state advance
- every run persists a complete planning trace for the proof screen
