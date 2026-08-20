# Circuit MCP

Circuit exposes its mandate runtime to external agents (Codex / Claude / any MCP client) as a thin, stateless interface. **No Circuit business logic lives in this package** — every tool delegates to the exact same engine, vault and receipt modules used by the web application.

```text
Codex / Claude / external agent
            ↓
        CIRCUIT MCP
            ↓
        Circuit Core            (packages/mcp/src/core.mjs — thin adapter)
            ↓
    Portfolio + Mandate        (dist/competition/* + integrations/vault.mjs)
            ↓
        Authorization          (EIP-712, signed by the Circuit authorizer)
            ↓
 CircuitPortfolioVault        (X Layer Testnet, guarded execution)
            ↓
       X Layer / OKX
```

## Tools

| Tool | Effect |
| --- | --- |
| `circuit_get_portfolio` | read-only: owner, vault, network, NAV, cash, positions, issuer/sector exposures, turnover, `portfolioStateHash`, `portfolioVersion` |
| `circuit_get_mandate` | read-only: mandate id/version, allowed assets, issuer/sector limits, turnover rules, market restrictions, mandate hash |
| `circuit_project_action` | read-only: projected future portfolio, no mutation |
| `circuit_evaluate_action` | read-only: same deterministic engine as the web app → `decision`, `currentStateHash`, `projectedStateHash`, `mandateHash`, `mandateVersion`, `evaluationHash`, machine-readable `violations` |
| `circuit_explain_violation` | read-only: deterministic structured repair constraints (no LLM) |
| `circuit_request_authorization` | consequential: re-verifies hashes/version, re-evaluates, returns a short-lived signed authorization bound to the exact action hash |
| `circuit_execute_authorized_action` | highly consequential: verifies unused/expiry/version/state/actions, executes through the guarded `CircuitPortfolioVault`, captures the X Layer tx, marks consumed, returns the Circuit receipt |
| `circuit_get_receipt` | read-only: linked receipt (owner, mandate, pre/post state hashes, plan/evaluation/authorization hashes, tx, timestamp) |

The calling agent owns REASON, PLAN, REPLAN. Circuit owns STATE, PROJECT, EVALUATE, AUTHORIZE, EXECUTE, PROVE.

## Setup — hosted (HTTP, stateless)

```bash
# auth tokens → caller portfolios (JSON env)
export CIRCUIT_MCP_USERS='{"judge-token":{"name":"judge","portfolios":["alpha-01"]}}'
# publisher key signs authorizations (same key that deploys the vault)
export CIRCUIT_PUBLISHER_KEY=...

npm run mcp:http
# → CIRCUIT MCP (HTTP, stateless) → http://127.0.0.1:4185/mcp
```

Client configuration (Claude Desktop / Codex):

```json
{
  "mcpServers": {
    "circuit": {
      "url": "http://127.0.0.1:4185/mcp",
      "headers": { "Authorization": "Bearer judge-token" }
    }
  }
}
```

Every request is handled by a fresh stateless transport (per the current MCP Streamable-HTTP spec). No MCP session state is used for portfolio, mandate, evaluation or authorization state — every consequential request explicitly carries `portfolioId`, `portfolioStateHash`, `mandateVersion` and `evaluationHash`, and everything is re-verified against onchain state.

## Setup — local (STDIO)

```bash
npm run mcp            # stdio transport, for local agent clients
```

## Security

- Remote users authenticate with bearer tokens; tokens are scoped to portfolios (403 otherwise); per-caller rate limiting.
- Read tools never mutate state. Execution tools accept no client-supplied verdict field — there is no `authorized: true` anywhere.
- Fail closed on: stale portfolio, stale mandate, stale evaluation, expired authorization, mismatching actions, paused vault, unavailable X Layer state, replay (onchain `consumedAuthorizations` + server store).
- No private keys, OKX credentials or execution secrets are exposed or logged. Logs carry requestId, tool, portfolioId, callerId, decision, latency and proof identifiers only.
- Venue truth: OKX DEX has no swap pair on X Layer Testnet, so execution reverts `UnsupportedRoute` in the vault — capital never moves and no success is faked.

## Tests

```bash
npm test   # includes packages/mcp/test/*.test.mjs (29 MCP tests: discovery, schemas,
           # non-mutation, engine parity, blocked/expired/stale/replay/ACL, HTTP auth,
           # live vault reach + receipt, deterministic parity across callers)
```
