import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { okxwallet: null, ethereum: null };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const stubEl = () => ({
  classList:{add(){},remove(){},toggle(){}}, style:{}, dataset:{},
  addEventListener(){}, removeEventListener(){}, contains(){ return true; },
  set innerHTML(_v){}, get innerHTML(){ return ""; },
  textContent:"", hidden:false, title:"", prepend(){}, querySelector(){ return stubEl(); }, querySelectorAll(){ return []; },
  scrollIntoView(){},
});
globalThis.document = {
  querySelector: () => stubEl(), querySelectorAll: () => [], addEventListener: () => {},
  createElement: () => stubEl(),
  body: { prepend() {} },
};
globalThis.location = { pathname: "/reports", hash: "" };
Object.defineProperty(globalThis, "navigator", { value: { clipboard: null }, configurable: true });

const { assembleReports } = await import("../web/js/reports.js");

function fixture({ withExecution = true, withBlocked = true } = {}) {
  const violation = withBlocked
    ? [{ code: "ISSUER_CONCENTRATION_EXCEEDED", issuer: "Tesla, Inc.", assetId: "tslax", projectedExposureBps: 4000, limitBps: 3500, message: "Tesla, Inc. exposure would become 40.0% of NAV." }]
    : [];
  const attempts = [
    { attempt: 1, plan: { id: "plan-001", provider: "fixture", model: null, intents: [{ assetId: "tslax", symbol: "TSLAx", side: "BUY", notionalUsd: 2500 }] }, decision: { verdict: "BLOCKED", violations: violation } },
    { attempt: 2, plan: { id: "plan-002", provider: "fixture", model: null, intents: [{ assetId: "tslax", symbol: "TSLAx", side: "BUY", notionalUsd: 1500 }] }, decision: { verdict: "AUTHORIZED", violations: [] } },
  ];
  const judgeReceipt = withExecution
    ? {
        id: "judge-receipt:t1", rejectionCode: "ISSUER_CONCENTRATION_EXCEEDED",
        evaluationHash: "0x" + "e1".repeat(32), authorizationHash: "0x" + "a1".repeat(32),
        transactionHash: "0x" + "c1".repeat(32), receiptHash: "sha256:r1", previousReceiptHash: "sha256:p1",
        finalPortfolioHash: "sha256:f1", policyVersion: 1, mandateHash: "0x" + "77".repeat(32), createdAt: "2026-08-15T04:00:00.000Z",
        trades: [{ assetId: "tslax", side: "BUY", notionalUsd: 1500 }],
      }
    : null;
  const trace = {
    id: "trace-x", endedAt: "2026-08-15T04:01:00.000Z", objective: "Allocate another $4,500. Favor Tesla exposure.",
    attempts, onchain: withExecution ? { status: "ONCHAIN_AUTHORIZED" } : null,
    judgeReceipt,
  };
  const vault = {
    ok: true, portfolioId: "portfolio-alpha-01", owner: "0xowner",
    addresses: { vault: "0x" + "11".repeat(20) }, paused: false, seeded: true, funded: true,
    mandate: { version: 7, enabled: true, exists: true, navUsd: 10000, mandateHash: "0x" + "77".repeat(32),
      maxIssuerExposureBps: 3500, maxSectorExposureBps: 5000, maxDailyTurnoverBps: 7000 },
    cashUsd: 2000, dailyTurnoverUsd: 5000, investedUsd: 8000,
    positions: { tslax: 3000, googlx: 3000, mstrx: 2000 },
    issuerExposures: { "Tesla, Inc.": 3000, "Alphabet Inc.": 3000, "Strategy Inc.": 2000 },
    sectorExposures: { automotive: 3000, technology: 5000 },
    portfolioStateHash: "0x" + "ab".repeat(32), portfolioVersion: 7,
  };
  return {
    vault, receipts: { receipts: [{ verdict: "BLOCKED", planId: "plan-001", receiptHash: "sha256:x" }], judgeReceipts: judgeReceipt ? [judgeReceipt] : [] },
    trace: { trace }, status: { ai: { configured: true, provider: "OpenRouter", model: "openai/gpt-5" }, okx: { configured: true, state: "LIVE" }, xlayer: { connected: true, blockNumber: 123 }, mcp: { healthy: true, agents: { codex: { status: "MCP_REGISTERED" }, claude: { status: "MCP_CONNECTED" } } } },
    network: { contracts: { registry: { creationTxHash: "0x" + "aa".repeat(32) }, guard: { creationTxHash: "0x" + "bb".repeat(32) } }, proof: { blockedTradeTxHash: "0x" + "cc".repeat(32), blockedRevertReason: "ExecutionDenied(7)", authorizedTradeTxHash: "0x" + "dd".repeat(32) } },
    activity: { entries: [] }, okx: { state: "LIVE", fetchedAtIso: "2026-08-15T04:00:00.000Z" },
    now: "2026-08-15T04:02:00.000Z",
  };
}

test("assembleReports always produces exactly seven reports", () => {
  const reports = assembleReports(fixture());
  assert.equal(reports.length, 7);
  assert.deepEqual(reports.map(r => r.anchor), ["portfolio","mandate","decision","execution","trace","audit","provenance"]);
});

test("decision report derives real numbers from the violation and portfolio", () => {
  const reports = assembleReports(fixture());
  const decision = reports.find(r => r.anchor === "decision");
  assert.match(decision.body, /BLOCKED/);
  assert.match(decision.body, /40\.0%/);
  assert.match(decision.body, /35\.0%/);
  assert.match(decision.body, /ISSUER_CONCENTRATION_EXCEEDED/);
  assert.match(decision.body, /REPAIR ENVELOPE/);
  assert.match(decision.body, /\$500/, "repair = 35%*10000 - 3000 = $500");
  assert.match(decision.body, /CURRENT/);
  assert.match(decision.body, /\+\$2,500/);
});

test("execution report carries the X Layer transaction and receipt hashes", () => {
  const reports = assembleReports(fixture());
  const execution = reports.find(r => r.anchor === "execution");
  assert.match(execution.body, /AUTHORIZED/);
  assert.match(execution.body, /c1c1c1/);
  assert.match(execution.body, /X LAYER TRANSACTION/);
});

test("agent trace report documents the rejection and the approval", () => {
  const reports = assembleReports(fixture());
  const trace = reports.find(r => r.anchor === "trace");
  assert.match(trace.body, /USER OBJECTIVE/);
  assert.match(trace.body, /BLOCKED/);
  assert.match(trace.body, /AUTHORIZED/);
  assert.match(trace.body, /PLAN \/ 001/);
});

test("missing data yields honest empty states, never fabricated reports", () => {
  const f = fixture({ withExecution: false, withBlocked: false });
  f.trace.trace.attempts = [];
  f.trace.trace.judgeReceipt = null;
  const reports = assembleReports(f);
  assert.equal(reports.length, 7);
  const decision = reports.find(r => r.anchor === "decision");
  const execution = reports.find(r => r.anchor === "execution");
  const trace = reports.find(r => r.anchor === "trace");
  assert.match(decision.body, /NO BLOCKED DECISION YET/);
  assert.match(execution.body, /NO EXECUTION YET/);
  assert.match(trace.body, /NO AGENT TRACE YET/);
  assert.ok(!decision.body.includes("40.0%"), "no fabricated numbers");
});

test("vault unavailable still renders all seven reports without throwing", () => {
  const f = fixture();
  f.vault = { ok: false, detail: "RPC offline" };
  const reports = assembleReports(f);
  assert.equal(reports.length, 7);
  assert.match(reports.find(r => r.anchor === "portfolio").body, /NO PORTFOLIO DATA/);
});

test("report ids are unique and versioned", () => {
  const reports = assembleReports(fixture());
  const ids = reports.map(r => r.id);
  assert.equal(new Set(ids).size, 7);
  assert.match(reports.find(r => r.anchor === "mandate").id, /CR-MAND-7/);
});

test("labels and values are separated with spaces for clean text rendering", () => {
  const reports = assembleReports(fixture());
  const decision = reports.find(r => r.anchor === "decision");
  const execution = reports.find(r => r.anchor === "execution");
  const trace = reports.find(r => r.anchor === "trace");
  // label trailing separator present
  assert.ok(decision.body.includes("PORTFOLIO STATE&nbsp;"), "decision metadata labels must end with a separator");
  assert.ok(decision.body.includes("CURRENT&nbsp;"), "decision rows must separate labels");
  assert.ok(decision.body.includes("REPAIR ENVELOPE&nbsp;"));
  assert.ok(execution.body.includes("X LAYER TRANSACTION"));
  // no double dollar anywhere in reports
  assert.ok(!reports.some(r => r.body.includes("$$")), "no double-dollar amounts");
  assert.ok(execution.body.includes("TSLAX BUY $1,500"), "execution actions must be single-dollar");
  // trace plan rows separate label from verdict
  assert.ok(trace.body.includes("FIXTURE&nbsp;"));
  assert.ok(trace.body.includes("USER OBJECTIVE&nbsp;"));
});
