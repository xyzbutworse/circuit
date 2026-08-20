# Forge 0.6 — Circuit proof contract

## Core hypothesis

> If an AI agent can propose a technically plausible RWA trade, Circuit can prove that the resulting portfolio would violate a stateful financial mandate, return machine-readable reasons, accept a compliant replan, and reproduce the stateful boundary on X Layer, then the mandate-runtime concept is proven.

## Minimum Complete Proof Loop

```text
real user objective / portfolio
→ AI proposal
→ deterministic post-state simulation
→ stateful mandate rejection
→ machine-readable feedback
→ AI replan
→ deterministic authorization
→ X Layer portfolio guard
→ inspectable receipt / transaction proof
```

## Organizer alignment

| Criterion | Build element | Demo moment | Proof |
|---|---|---|---|
| AI application | structured portfolio planning agent | plan + replan | provider-tagged plan payload |
| Innovation | stateful post-trade mandate runtime | valid trade becomes invalid future state | deterministic trace |
| Product completeness | one complete vertical loop | start → block → replan → authorize | receipt ledger |
| User value | prevents mandate drift by autonomous capital | issuer concentration blocked | violation code + state diff |
| X Layer | stateful PortfolioGuard | rejected / authorized calls | testnet txs after deployment |
| Growth potential | reusable mandate / asset model | multiple state dimensions | typed policy engine |
| Ecosystem contribution | safer agentic RWA portfolio operation | RWA basket | X Layer guard + OKX adapter |
| AI-RWA | agent plans tokenized equities | TSLAx / GOOGLx / MSTRx fixture/live path | market provenance |

## Sponsor causality

The final proof is incomplete without X Layer because the public stateful authorization boundary does not exist. Removing the X Layer guard reduces the project to an offchain simulator.

OKX Onchain OS is used for live market / quote context when credentials and supported token addresses are configured. Demo fixtures are never represented as OKX results.

## Proof debt — blocking before submission

- [ ] compile Solidity with pinned Foundry toolchain
- [ ] run all Foundry tests
- [ ] deploy registry + guard to X Layer Testnet
- [ ] capture one stateful rejection and compliant authorization sequence
- [ ] configure and capture a real live AI run
- [ ] configure and capture a real OKX call that participates in the workflow
- [ ] replace all deployment placeholders with real addresses / explorer proof

## Feature debt — acceptable

- only one portfolio / agent in the PoC
- only three RWA examples
- no institution admin / RBAC
- no multi-chain support
- no production oracle network
- no generalized security master
- no portfolio accounting beyond mandate-relevant state

## Judge reconstruction

After the demo, the judge should be able to say:

> The transaction was not inherently unsafe. Circuit rejected it because the resulting portfolio would violate the agent's issuer-concentration mandate. The agent replanned, Circuit authorized the compliant future state, and X Layer preserved that mandate boundary onchain.
