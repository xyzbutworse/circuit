# Circuit — X Layer Testnet deployment evidence

Network: X Layer Testnet (Terigon) · chainId 1952
RPC: https://testrpc.xlayer.tech/terigon (official, per OKX X Layer docs)
Explorer: https://www.okx.com/web3/explorer/xlayer-test
Deployer: 0xB2F3c78c66B50589c7dD8bC2A937994d3F24eE21

## Deployments

| Contract | Address | Creation tx | Block |
| --- | --- | --- | --- |
| CircuitMandateRegistry | 0x4FE654814808d4DeB73D77e30815c2f23b969B9b | 0x6bc6865dd5f8e6c71d0256af5fc844e1e74965dcdf23593f522114479566ac5d | 38290806 |
| CircuitPortfolioGuard | 0x41992657dAd81F89e61A29887b9bdd1F7cE9Ff77 | 0x1ae3f93e8524e8a6246619a4bdd544b3b27343bf7c2980627529513cf1432ce7 | 38290818 |

Explorer:
- Registry: https://www.okx.com/web3/explorer/xlayer-test/address/0x4FE654814808d4DeB73D77e30815c2f23b969B9b
- Guard: https://www.okx.com/web3/explorer/xlayer-test/address/0x41992657dAd81F89e61A29887b9bdd1F7cE9Ff77

## Setup

- Assets registered (issuer → sector):
  - TSLAx → tesla → automotive (tx 0xc7236b002d91e16df7fc65edbce6d8c68eece4f3d75ebaae4ff1bc198f8570e1)
  - GOOGLx → alphabet → technology (tx 0x1d9cbabc70d36bdc94174ef8cca4775bc5bee2eebd2ba3263015aa5ff12fdd5d)
  - MSTRx → strategy → technology (tx 0x0ea28f0c2566910aa1e020696dc65b318cef5cda6c09f9d1c06bd19ce066afc7)
- Mandate published v1 (tx 0x22da2246e733dcc0f09be905442850275b460f6012dde6cb6593154ce404831c):
  - max issuer concentration: 35%
  - max sector (technology) exposure: 50%
  - allowed assets: TSLAx / GOOGLx / MSTRx (registered + enabled in the registry)
  - plus: asset 45%, invested 95%, turnover 70%, slippage 100bps, reference freshness 1800s, closed-market buy cap $1,000, material-event buy cap $500
- Portfolio seeded (tx 0x22c04c2e6867fd94f01a7e7823156ddda4868967c0945086f96f62ccd31ad50c):
  TSLAx $1,500 / GOOGLx $1,500 / MSTRx $500 / cash $6,500 / turnover $500 (NAV $10,000)

## Proof A — valid transaction, invalid mandate state

Trade: authorizeTrade(TSLAx, BUY, $2,500, ctx slippage 42bps / freshness 240s / market open / no material event)

| Item | Value |
| --- | --- |
| Tx | 0x0afbbb5c5663bb5ac61673929d5fdb0e0c8fc893eb756fc9527e7ac9df35081b |
| Status | 0x0 (reverted) — block 38286588 |
| Revert | ExecutionDenied(uint8) selector 0x35cf4f19, arg 7 = REASON_ISSUER_EXPOSURE |
| Why | Tesla issuer exposure would become 40% of NAV (projected $4,000) vs 35% mandate ceiling |
| RPC trace | guard → STATICCALL registry.getMandate → STATICCALL registry.getAsset → revert (callTracer, see trace-proof-a-blocked.json) |
| Explorer | https://www.okx.com/web3/explorer/xlayer-test/tx/0x0afbbb5c5663bb5ac61673929d5fdb0e0c8fc893eb756fc9527e7ac9df35081b |

Pre-trade state: TSLAx $1,500 (15% of NAV). Projected: 40% > 35% → REVERT. State unchanged.

## Proof B — replanned compliant action

Trade: authorizeTrade(TSLAx, BUY, $1,500, ctx slippage 39bps / freshness 240s)

| Item | Value |
| --- | --- |
| Tx | 0x5549e8cc24701fc28e6de10f3ac7d6ce0da56b0152bbd8ea573a95ba57b2f16f |
| Status | 0x1 (success) — block 38290991 |
| Event | TradeAuthorized (topic0 0xdbc60da8), 1 log emitted |
| Authorization hash | 0x07f05fe2285e8e78fd57f8215be1d29b83faabc0b401452587627b57bbe1723f |
| Explorer | https://www.okx.com/web3/explorer/xlayer-test/tx/0x5549e8cc24701fc28e6de10f3ac7d6ce0da56b0152bbd8ea573a95ba57b2f16f |

Resulting state: TSLAx $3,000 (30%), Tesla issuer $3,000 (30%), cash $5,000.

## Completion sequence (competition proof)

- GOOGLx +$1,500 (tx 0x1c9bc09468ebbeac3f0e847463e14c60f42cf2c81bfb553ac4bf0bce52422944, block 38291021)
- MSTRx +$1,500 (tx 0xbc01ebb207f28da24e39f61899515d45f93ba91873882375b9abb5d56c9687c1, block 38291034)
- Final state (block 38291052): technology sector $5,000 = exactly 50% of NAV (boundary), invested $8,000 (80%), cash $2,000, daily turnover $5,000 (50%).

## Runtime verification

`GET /api/proof/network` verifies runtime bytecode at both addresses against the audited
build artifacts (keccak of deployed bytecode). `live: true` only when both match.
