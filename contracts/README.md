# Circuit / X Layer proof contracts

The onchain proof is intentionally stateful.

`CircuitMandateRegistry` stores a versioned portfolio mandate plus the asset → issuer → sector classification required to evaluate concentration. `CircuitPortfolioGuard` stores authorized portfolio exposure by asset, issuer and sector, plus cash and daily turnover. `authorizeTrade()` projects the next state and reverts if that state breaches any mandate limit — asset, issuer, sector, invested capital, daily turnover, available cash, slippage, reference freshness, closed-market and material-event caps for new exposure.

This is deliberately different from a per-transaction spending cap. The demo trade can be valid in isolation and still fail because of what it would make the portfolio become.

## Mandate dimensions enforced onchain

- asset exposure / NAV
- issuer concentration / NAV
- sector concentration / NAV
- total invested capital / NAV
- daily turnover / NAV (UTC day rollover)
- available cash (BUY only; SELL credits cash)
- expected slippage (publisher-attested)
- reference freshness (publisher-attested; BUY only)
- closed-market new-exposure cap (publisher-attested; BUY only)
- material-event new-exposure cap (publisher-attested; BUY only)
- mandate validity window and enabled flag
- asset eligibility (registered + enabled)
- strict version ordering per policy key
- one-time portfolio seeding that must itself satisfy the mandate

Every `authorizeTrade` is replay-protected by a consumed `intentHash`, reverts atomically on any violation and returns a deterministic authorization hash binding the mandate version and the resulting state. See `SECURITY.md` for the full trust model.

## The judge story

1. register TSLAx / GOOGLx / MSTRx economic buckets;
2. publish the mandate;
3. seed current portfolio state (TSLAx $1,500 = 15% of NAV, cash $6,500, turnover $500);
4. attempt TSLAx +$2,500 — **reverted**: Tesla issuer exposure would become 40% of NAV against a 35% limit;
5. authorize a repaired TSLAx +$1,500 — projected Tesla exposure 30% → **authorized**;
6. authorize GOOGLx +$1,500;
7. authorize MSTRx +$1,500, ending with Technology exposure exactly at the 50% sector ceiling.

## Verification

```bash
forge fmt --check
forge build
forge test -vvv
```

67 tests cover the full matrix in `test/` — see `SECURITY.md` §8 for the list. The critical boundary test proves 35.00% passes and 35.01% fails.

## Deployment

```bash
export PRIVATE_KEY=...
./scripts/deploy-xlayer-testnet.sh
./scripts/prove-xlayer.sh
```

No deployment is claimed until real addresses are set in `CIRCUIT_MANDATE_REGISTRY` and `CIRCUIT_PORTFOLIO_GUARD`.
