import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCircuitCore, mapPortfolioId } from "./core.mjs";
import {
  portfolioIdSchema,
  projectSchema,
  evaluateSchema,
  explainSchema,
  requestAuthorizationSchema,
  executeSchema,
  getReceiptSchema,
} from "./schemas.mjs";

export const CIRCUIT_MCP_INSTRUCTIONS = `Circuit is a financial mandate runtime.

Agents may reason and propose portfolio actions freely.

Before changing a managed portfolio:
1. Read portfolio state.
2. Read active mandate.
3. Evaluate the proposed action.
4. If BLOCKED, use Circuit violations to replan.
5. Evaluate the repaired action.
6. Request authorization only after a compliant evaluation.
7. Execute only through Circuit's authorized execution path.
8. Return the Circuit receipt.

Never treat model reasoning as authorization.`;

export function buildCircuitMcpServer(options = {}) {
  const core = options.core ?? createCircuitCore(options);
  const auth = options.auth ?? null;
  const logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)));

  const server = new McpServer(
    { name: "circuit", version: "1.0.0" },
    { instructions: CIRCUIT_MCP_INSTRUCTIONS }
  );

  function ctxFor(input, meta) {
    return { requestId: meta?.requestId ?? null, caller: meta?.caller ?? null };
  }

  async function guard(caller, portfolioId, requestId) {
    if (auth) {
      if (!auth.allowRequest(caller.name)) return { error: "RATE_LIMITED: too many requests." };
      if (!auth.authorizePortfolio(caller, mapPortfolioId(portfolioId))) {
        return { error: "FORBIDDEN: this caller is not authorized for this portfolio." };
      }
    }
    return { ok: true };
  }

  async function run(tool, caller, requestId, portfolioId, fn) {
    const started = Date.now();
    try {
      const g = await guard(caller, portfolioId, requestId);
      if (g.error) return { isError: true, content: [{ type: "text", text: g.error }] };
      const result = await fn();
      logger({ requestId, tool, portfolioId: mapPortfolioId(portfolioId), callerId: caller.name, decision: result.ok ? result.decision ?? "OK" : result.status ?? "ERROR", latencyMs: Date.now() - started, ids: { evaluationHash: result.evaluationHash, authorizationHash: result.authorizationHash ?? result.receipt?.authorizationHash, txHash: result.txHash ?? result.receipt?.txHash } });
      if (result.ok === false) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ status: result.status, detail: result.detail, violations: result.violations, note: result.note }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      logger({ requestId, tool, portfolioId: mapPortfolioId(portfolioId), callerId: caller?.name, decision: "EXCEPTION", latencyMs: Date.now() - started });
      return { isError: true, content: [{ type: "text", text: `INTERNAL_ERROR: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  }

  server.registerTool("circuit_get_portfolio", {
    title: "Read Circuit portfolio state",
    description: "Read-only. Returns the authoritative onchain portfolio state: owner, vault, network, NAV, cash, positions, issuer/sector exposures, turnover, portfolioStateHash and portfolioVersion.",
    inputSchema: portfolioIdSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input, extra) => {
    const caller = extra?.authInfo?.caller ?? extra?._meta?.caller ?? { name: "anonymous", portfolios: ["*"] };
    return run("circuit_get_portfolio", caller, extra?.requestId ?? null, input.portfolioId, () => core.getPortfolio(mapPortfolioId(input.portfolioId)));
  });

  server.registerTool("circuit_get_mandate", {
    title: "Read the active Circuit mandate",
    description: "Read-only. Returns mandate id, version, allowed assets, issuer/sector limits, turnover rules, market restrictions and mandate hash.",
    inputSchema: portfolioIdSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input, extra) => {
    const caller = extra?.authInfo?.caller ?? extra?._meta?.caller ?? { name: "anonymous", portfolios: ["*"] };
    return run("circuit_get_mandate", caller, extra?.requestId ?? null, input.portfolioId, () => core.getMandate(mapPortfolioId(input.portfolioId)));
  });

  server.registerTool("circuit_project_action", {
    title: "Project a portfolio action without executing",
    description: "Read-only. Returns the projected future portfolio for the given actions. Nothing is authorized or mutated.",
    inputSchema: projectSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input, extra) => {
    const caller = extra?.authInfo?.caller ?? extra?._meta?.caller ?? { name: "anonymous", portfolios: ["*"] };
    return run("circuit_project_action", caller, extra?.requestId ?? null, input.portfolioId, () => core.project(mapPortfolioId(input.portfolioId), input.actions));
  });

  server.registerTool("circuit_evaluate_action", {
    title: "Evaluate an action against the Circuit mandate",
    description: "Read-only. The flagship tool: runs the same deterministic Circuit engine as the web application and returns decision, hashes and machine-readable violations. Never authorizes.",
    inputSchema: evaluateSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input, extra) => {
    const caller = extra?.authInfo?.caller ?? extra?._meta?.caller ?? { name: "anonymous", portfolios: ["*"] };
    return run("circuit_evaluate_action", caller, extra?.requestId ?? null, input.portfolioId, () => core.evaluate(mapPortfolioId(input.portfolioId), input.actions));
  });

  server.registerTool("circuit_explain_violation", {
    title: "Explain a Circuit violation with repair constraints",
    description: "Read-only. Deterministic structured explanation + repair constraints. No LLM involved.",
    inputSchema: explainSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input, extra) => {
    const caller = extra?.authInfo?.caller ?? extra?._meta?.caller ?? { name: "anonymous", portfolios: ["*"] };
    return run("circuit_explain_violation", caller, extra?.requestId ?? null, input.portfolioId, () => core.explain(mapPortfolioId(input.portfolioId), input.violation));
  });

  server.registerTool("circuit_request_authorization", {
    title: "Request a short-lived Circuit authorization",
    description: "Consequential. Refreshes authoritative state, verifies hashes/versions, re-evaluates the actions, and returns a signed short-lived authorization bound to the exact action hash. The agent cannot supply its own compliance verdict.",
    inputSchema: requestAuthorizationSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async (input, extra) => {
    const caller = extra?.authInfo?.caller ?? extra?._meta?.caller ?? { name: "anonymous", portfolios: ["*"] };
    return run("circuit_request_authorization", caller, extra?.requestId ?? null, input.portfolioId, () => core.requestAuthorization({
      portfolioId: mapPortfolioId(input.portfolioId),
      actions: input.actions,
      portfolioStateHash: input.portfolioStateHash,
      mandateVersion: input.mandateVersion,
      evaluationHash: input.evaluationHash,
    }));
  });

  server.registerTool("circuit_execute_authorized_action", {
    title: "Execute a Circuit-authorized action on X Layer",
    description: "Highly consequential. Executes ONLY an authorization already created by Circuit: verifies unused/expiry/version/state/actions, calls the guarded CircuitPortfolioVault path, captures the X Layer transaction, marks the authorization consumed and returns a Circuit receipt.",
    inputSchema: executeSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async (input, extra) => {
    const caller = extra?.authInfo?.caller ?? extra?._meta?.caller ?? { name: "anonymous", portfolios: ["*"] };
    return run("circuit_execute_authorized_action", caller, extra?.requestId ?? null, input.portfolioId, () => core.executeAuthorizedAction({
      portfolioId: mapPortfolioId(input.portfolioId),
      authorizationHash: input.authorizationHash,
      authorization: input.authorization,
      actions: input.actions,
    }));
  });

  server.registerTool("circuit_get_receipt", {
    title: "Get a Circuit audit receipt",
    description: "Read-only. Returns the linked receipt for a completed authorization/execution: portfolio, owner, mandate hash/version, pre-state hash, plan hash, evaluation hash, authorization hash, execution tx, post-state hash, timestamp.",
    inputSchema: getReceiptSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input, extra) => {
    const caller = extra?.authInfo?.caller ?? extra?._meta?.caller ?? { name: "anonymous", portfolios: ["*"] };
    return run("circuit_get_receipt", caller, extra?.requestId ?? null, "alpha-01", () => core.getReceipt(input.receiptId));
  });

  return server;
}
