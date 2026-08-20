# CIRCUIT — 90-Second Judge Demo

One screen: the three-act proof output (or `/gate` + the live proof console). No dashboard tour. The narration follows the on-chain proof exactly — every claimed number is visible in `artifacts/xlayer/latest.json`.

Prereqs: `npm run prove:xlayer` already executed; show the terminal output or `artifacts/xlayer/latest.json` on the side.

---

## 0–15 sec — The different question

**Say (pointing at ACME-INV-8842):**

> This RWA is verified. Passport PASS-8842, 11.2% yield, 74-day maturity, collateralized, evidence fresh. Verification passed.
>
> CIRCUIT asks a different question: should this fund buy this much of it right now?

Stop. Let the phrase land. Do not touch the keyboard.

## 15–35 sec — ACT 1: the $100k proposal

**Interact:** run the $100,000 proposal (engine, not a slide — `node scripts/circuit.mjs verify` or the live proof `ACT 1`).

**Say:**

> $100,000 into ACME. The portfolio is 14.1% exposed to this debtor today. CIRCUIT projects the post-trade portfolio: 28.4% — above the mandate's 20% debtor ceiling.
>
> No approval is created. And the chain agrees — the gate refuses an expired commitment with `ExpiredApproval`.

```text
BLOCK
CAPITAL MOVED: 0
```

**Do not** describe the asset as bad. Errors live in the future state, not the asset.

## 35–55 sec — ACT 2: the $35k proposal

**Interact:** run the $35,000 proposal (`ACT 2` of the live proof).

**Say:**

> $35,000. Projected debtor exposure: 19.1% — inside the mandate. Every rule passes.
>
> CIRCUIT issues a state-bound approval — bound to this asset's economic state, this portfolio state, this mandate version, this amount, nonce, expiry. Then it sends the real transaction.

**Show** the on-chain result:

```text
Execution tx: 0xb9a7…2f21   (block 38732492)
Allocation state: 5000000000000 → 6000000000000 wei
State readback integrity: true
```

> A real X Layer Testnet transaction. The allocation state changed on-chain. Post-state read back and verified.

What changed: the *authorization*, not just the asset.

## 55–75 sec — ACT 3: the stale approval

**Interact:** show the stale-approval act (`ACT 3`).

**Say:**

> Same fund, same asset, same amount — but now the asset's economic state changed: a dispute flag. The approval from a moment ago was valid *for the state that produced it*.
>
> The reuse attempt is rejected before sending:

```text
EconomicStateChanged
CAPITAL MOVED: 0
```

**Emphasize:** the off-chain runtime rejects it **and** the chain itself reverts — both layers, independently.

## 75–90 sec — Receipt + close

**Interact:** open `artifacts/xlayer/latest.json` (or `receipts/allow.json`) — three linked receipts, sha256, all valid. Point at `receipts.*Valid: true`.

**Say:**

> Three receipts, hash-linked, tamper-evident. The asset was still real. The authorization was no longer true.

Stop.

---

## Rules of the demo

- Every number spoken is in `artifacts/xlayer/latest.json` or `npm run verify` output. If a number scrolls by, repeat it from the artifact, not from memory.
- Never call the fixture a real receivable. One sentence: "ACME-INV-8842 is a competition fixture — all live amounts are testnet units."
- Never claim a dashboard feature. The proof is scripts and artifacts.
- If a judge asks "what would a bigger allocation do?" — run the proposal, don't argue.