import http from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePlan, feedbackLines } from "./dist/competition/mandate.js";
import { makeCircuitReceipt } from "./dist/competition/receipt.js";
import { demoMandate, demoMarket, demoPortfolio, violatingPlan, repairedPlan } from "./dist/competition/demo.js";
import { runPlanningLoop } from "./dist/competition/planner.js";
import { buildJudgeReceipt, verifyJudgeReceipt } from "./dist/competition/judge-receipt.js";
import { planWithOpenRouter, aiProviderInfo } from "./integrations/openrouter-agent.mjs";
import { OKX_BASE_URL, fetchOkxMarketContext, marketContextForAgent, buildLiveMarket, okxConfigured, okxFetch, getOkxCandles } from "./dist/integrations/okx.js";
import { xlayerStatus, XLAYER_TESTNET } from "./integrations/xlayer-rpc.mjs";
import { deploymentMetadata, deploymentConfig, verifyDeployment, explorerUrl } from "./integrations/deployment.mjs";
import { runOnchainJudgePhase } from "./integrations/xlayer-executor.mjs";
import { vaultStatus, authorizeActions } from "./integrations/vault.mjs";
import { evaluateAllocation } from "./dist/competition/rwa/evaluate.js";
import { createApproval, verifyApprovalFreshness, ApprovalRegistry, mandateHash, assetStateHash, portfolioStateHash } from "./dist/competition/rwa/approvals.js";
import { createDecisionReceipt, verifyReceipt } from "./dist/competition/rwa/receipt.js";
import { acmeAsset, fundAlphaMandate, alphaPortfolio, allocation } from "./dist/competition/rwa/scenario.js";
import { handleHttpRequest as handleMcpHttpRequest } from "./packages/mcp/src/transports/http.mjs";

const rwaRegistry = new ApprovalRegistry();
const rwaReceipts = new Map();

const root = fileURLToPath(new URL("./web/", import.meta.url));
const port = Number(process.env.PORT ?? 4184);
const maxReplans = Number(process.env.CIRCUIT_MAX_REPLANS ?? 2);
const aiTimeoutMs = Number(process.env.CIRCUIT_AI_TIMEOUT_MS ?? 20_000);
const receipts = [];
const traces = [];
const judgeReceipts = [];
const runs = new Map();
let okxCache = null;
const activityFile = new URL("./.data/activity.jsonl", import.meta.url);
const committedProofArtifact = await readFile(new URL("./deployments/live-openrouter-proof.json", import.meta.url), "utf8")
  .then(value => JSON.parse(value))
  .catch(() => null);
const committedTrace = committedProofArtifact?.trace
  ? { ...committedProofArtifact.trace, proofVerification: committedProofArtifact.trace.proofVerification ?? committedProofArtifact.verification }
  : null;
const committedJudgeReceipt = committedProofArtifact?.receipt ?? committedTrace?.judgeReceipt ?? null;

function appendActivity(entry) {
  return import("node:fs/promises").then(async ({ mkdir, appendFile }) => {
    try {
      await mkdir(new URL(".", activityFile), { recursive: true });
      await appendFile(activityFile, JSON.stringify(entry) + "\n");
    } catch (error) {
      console.error("[activity-persist]", error instanceof Error ? error.message : String(error));
    }
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);
}
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".svg":"image/svg+xml", ".json":"application/json; charset=utf-8" };
const deployment = {
  registry: process.env.CIRCUIT_MANDATE_REGISTRY ?? null,
  guard: process.env.CIRCUIT_PORTFOLIO_GUARD ?? null,
};
let activePortfolio = structuredClone(demoPortfolio);

function sendJson(res,status,value){
  if(res.headersSent||res.writableEnded) return;
  const body=JSON.stringify(value,(_k,v)=>typeof v==="bigint"?v.toString():v,2);
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
  res.end(body);
}
async function readBody(req){const chunks=[];for await(const c of req)chunks.push(c);return chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};}
function recordReceipt(decision, plan, portfolio, mandate, checkedAt, commit=false){
  const previousReceiptHash=receipts.at(-1)?.receiptHash;
  const receipt=makeCircuitReceipt({mandateId:mandate.id,portfolioId:portfolio.id,planId:plan.id,decision,createdAt:checkedAt,chainId:1952,...(deployment.guard?{contractAddress:deployment.guard}:{}),...(previousReceiptHash?{previousReceiptHash}:{})});
  receipts.push(receipt);
  if(commit && decision.allowed) activePortfolio = structuredClone(decision.afterState);
  return receipt;
}
function proofFor(plan, portfolio, mandate, market, checkedAt = new Date().toISOString(), commit = false){
  const decision=evaluatePlan(plan,portfolio,mandate,market,checkedAt);
  const receipt=recordReceipt(decision,plan,portfolio,mandate,checkedAt,commit);
  return {decision,receipt,violations:decision.violations,feedback:feedbackLines(decision),feedbackLines:feedbackLines(decision),committed:Boolean(commit&&decision.allowed)};
}
function demoPlanFor(ctx){
  const plan = structuredClone(ctx.violations.length > 0 ? repairedPlan : violatingPlan);
  plan.objective = ctx.objective;
  if (ctx.revisionOf) plan.revisionOf = ctx.revisionOf;
  return plan;
}
function generatePlanFor(mode, objective, run){
  return (ctx) => mode === "live"
    ? planWithOpenRouter({ mandate: demoMandate, portfolio: activePortfolio, market: run.market, objective, violations: ctx.violations, attempt: ctx.attempt, revisionOf: ctx.revisionOf, timeoutMs: aiTimeoutMs, okxMarketContext: run.okxMarketContext })
    : Promise.resolve(demoPlanFor(ctx));
}

const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url??"/",`http://${req.headers.host??"localhost"}`);
  if(url.pathname==="/mcp"||url.pathname==="/mcp/health") return handleMcpHttpRequest(req,res,{path:"/mcp",healthPaths:["/mcp/health"]});
  if(url.pathname==="/api/health") return sendJson(res,200,{ok:true,product:"CIRCUIT",version:"0.7-mandate-runtime"});
  if(url.pathname==="/api/status"){
    const chain=await xlayerStatus();
    const config=await deploymentConfig();
    const aiInfo=aiProviderInfo();
    const deployedMcp = process.env.VERCEL === "1";
    const forwardedProtocol = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
    const publicOrigin = `${forwardedProtocol}://${req.headers.host ?? "localhost"}`;
    let mcp = { url: deployedMcp ? `${publicOrigin}/mcp` : `http://127.0.0.1:${Number(process.env.CIRCUIT_MCP_PORT ?? 4185)}/mcp`, healthy: deployedMcp, transport: "streamable-http", tools: 8, agents: {} };
    if (!deployedMcp) {
      try {
        const mcpHealth = await fetch(`http://127.0.0.1:${Number(process.env.CIRCUIT_MCP_PORT ?? 4185)}/health`, { signal: AbortSignal.timeout(2000) });
        mcp.healthy = mcpHealth.ok;
      } catch {}
    }
    try { mcp.agents.codex = { status: (await readFile("./deployments/traces/codex-mcp-registered.txt", "utf8")).includes("circuit") ? "MCP_REGISTERED" : "UNKNOWN", note: "Agent run blocked by ChatGPT account usage limit (external); MCP registration verified." }; } catch { mcp.agents.codex = { status: "UNCONFIGURED" }; }
    try { const claudeInit = JSON.parse(await readFile("./deployments/traces/claude-mcp-init.json", "utf8")); mcp.agents.claude = { status: claudeInit.tools?.length >= 8 ? "MCP_CONNECTED" : "UNKNOWN", note: "Session init discovered all 8 circuit tools; full run blocked by expired claude.ai OAuth (external)." }; } catch { mcp.agents.claude = { status: "UNCONFIGURED" }; }
    return sendJson(res,200,{ai:{configured:aiInfo.configured,provider:aiInfo.label??"OpenAI Responses API",model:aiInfo.model,timeoutMs:aiTimeoutMs,maxReplans},okx:{configured:okxConfigured(),provider:"OKX Onchain OS",baseUrl:OKX_BASE_URL,state:okxCache?.state??(okxConfigured()?"UNAVAILABLE":"MISCONFIGURED"),stateDetail:okxCache?null:"not yet checked",lastFetchedAt:okxCache?.fetchedAt?new Date(okxCache.fetchedAt).toISOString():null,paymentRequired:Boolean(okxCache?.paymentRequired),endpoints:{indexPrice:"POST /api/v6/dex/index/current-price",rwaTokens:"GET /api/v6/dex/market/rwa/tokens",dexQuote:"GET /api/v6/dex/aggregator/quote"}},mcp,xlayer:{...chain,testnet:XLAYER_TESTNET,deployment:{registry:config.registry,guard:config.guard}}});
  }
  if(url.pathname==="/api/bootstrap") return sendJson(res,200,{meta:{product:"CIRCUIT",tagline:"The mandate runtime for autonomous RWA portfolios.",proofLoop:"user objective → AI plan → Circuit projects post-trade state → mandate violation → structured rejection → AI replan → re-evaluation → authorization",fixtureNotice:"Demo market values and fixture AI plans are explicitly labeled. Live providers never silently fall back."},mandate:demoMandate,market:demoMarket,portfolio:activePortfolio,maxReplans});
  if(url.pathname==="/api/agent/plan"&&req.method==="POST"){
    const body=await readBody(req); const mandate=body.mandate??demoMandate, market=body.market??demoMarket, portfolio=body.portfolio??activePortfolio, violations=Array.isArray(body.violations)?body.violations:[], objective=typeof body.objective==="string"&&body.objective.trim()?body.objective.trim():mandate.objective;
    if(body.demo===true) return sendJson(res,200,{plan:demoPlanFor({violations,revisionOf:body.revisionOf,objective}),mode:"fixture"});
    try{
      const okx = await fetchOkxMarketContext(["tslax","googlx","mstrx"]); okxCache=okx;
      const plan=await planWithOpenRouter({mandate,portfolio,market:buildLiveMarket(okx,market),objective,violations,revisionOf:body.revisionOf,timeoutMs:aiTimeoutMs,okxMarketContext:marketContextForAgent(okx)});
      return sendJson(res,200,{plan,mode:"live",okx:{state:okx.state,fetchedAt:new Date(okx.fetchedAt).toISOString(),paymentRequired:Boolean(okx.paymentRequired)}});
    }
    catch(error){const code=error&&error.code?error.code:"AI_PROVIDER_ERROR";const status=code==="AI_UNAVAILABLE"?503:code==="AI_MALFORMED_OUTPUT"?502:code==="AI_TIMEOUT"?504:502;return sendJson(res,status,{error:error instanceof Error?error.message:String(error),code});}
  }
  if(url.pathname==="/api/circuit/run"&&req.method==="POST"){
    const body=await readBody(req);
    const runToken = typeof body.runToken === "string" && body.runToken.length > 0 ? body.runToken : null;
    if (runToken && runs.get(runToken)) return sendJson(res,200,{trace:runs.get(runToken),duplicate:true});
    const mode = body.mode === "live" ? "live" : "demo";
    const objective = typeof body.objective === "string" && body.objective.trim() ? body.objective.trim() : demoMandate.objective;
    const startedAt = new Date().toISOString();
    const availableCapitalUsd = activePortfolio.cashUsd;
    const traceId = `trace-${Date.now()}`;
    let okx = null;
    let market = demoMarket;
    let okxMarketContext;
    if (mode === "live") {
      okx = await fetchOkxMarketContext(["tslax","googlx","mstrx"]);
      okxCache = okx;
      market = buildLiveMarket(okx, demoMarket);
      okxMarketContext = marketContextForAgent(okx);
    }
    const result = await runPlanningLoop({
      objective,
      portfolio: activePortfolio,
      mandate: demoMandate,
      market,
      maxReplans,
      generatePlan: generatePlanFor(mode, objective, { market, okxMarketContext }),
    });
    const traceReceipts=[];
    for(const attempt of result.attempts){
      const receipt = recordReceipt(attempt.decision, attempt.plan, activePortfolio, demoMandate, attempt.decision.checkedAt, false);
      traceReceipts.push(receipt);
    }
    let onchain = null;
    let judgeReceipt = null;
    let proofVerification = null;
    if (result.allowed && result.attempts.length >= 1) {
      const plan1 = result.attempts[0].plan;
      const plan1Decision = result.attempts[0].decision;
      const plan2 = result.attempts.at(-1).plan;
      const rejection = plan1Decision.violations[0] ?? { code: "NONE", message: "No violation.", actual: 0, limit: 0 };
      onchain = await withTimeout(runOnchainJudgePhase({
        traceId,
        objective,
        mandate: demoMandate,
        plan1,
        plan1Hash: plan1Decision.planHash,
        plan2,
        plan2Hash: result.finalDecision.planHash,
        rejectionCode: rejection.code,
        rejection,
        finalDecision: result.finalDecision,
      }), 180_000, "Onchain authorization phase");
      if (onchain.ok) {
        const readback = onchain.readback;
        activePortfolio = {
          ...activePortfolio,
          cashUsd: readback.cashUsd,
          dailyTurnoverUsd: readback.dailyTurnoverUsd,
          holdings: ["tslax","googlx","mstrx"].map(assetId => ({ assetId, notionalUsd: readback.assetUsd[assetId] })).filter(h => h.notionalUsd > 0),
          asOf: new Date().toISOString(),
        };
        judgeReceipt = buildJudgeReceipt({
          id: `judge-receipt:${traceId}`,
          chainId: 1952,
          createdAt: new Date().toISOString(),
          objective,
          plan1,
          plan1Hash: plan1Decision.planHash,
          plan2,
          plan2Hash: result.finalDecision.planHash,
          plans: result.attempts.map(attempt=>({attempt:attempt.attempt,plan:attempt.plan,planHash:attempt.decision.planHash})),
          evaluationHash: traceReceipts.at(-1).receiptHash,
          rejectionCode: rejection.code,
          rejection,
          mandateHash: onchain.mandateHash,
          policyVersion: onchain.policyVersion,
          policyKey: onchain.policyKey,
          trades: onchain.trades,
          finalPortfolioHash: result.finalDecision.afterPortfolioHash,
          evaluationReceiptHashes: traceReceipts.map(receipt => receipt.receiptHash),
          onchainReadback: onchain.readback,
          ...(traceReceipts.at(-1)?.receiptHash ? { previousReceiptHash: traceReceipts.at(-1).receiptHash } : {}),
        });
        proofVerification = verifyJudgeReceipt(judgeReceipt, {
          traceId,
          attempts: result.attempts,
          attemptReceipts: traceReceipts,
          onchain,
        });
        judgeReceipts.push(judgeReceipt);
      }
    }
    const trace={
      id: traceId,
      mode,
      objective,
      availableCapitalUsd,
      mandateId: demoMandate.id,
      portfolioId: activePortfolio.id,
      startedAt,
      endedAt: new Date().toISOString(),
      maxReplans,
      status: result.status,
      allowed: result.allowed,
      verdict: result.verdict,
      market: mode === "live" ? { provider: "OKX", state: okx?.state ?? "UNAVAILABLE", assets: market } : { provider: "fixture", state: "DEMO", assets: demoMarket },
      okx: mode === "live" && okx ? { state: okx.state, fetchedAt: new Date(okx.fetchedAt).toISOString(), provider: okx.provider, baseUrl: okx.baseUrl, entries: okx.entries, ...(okx.paymentRequired?{paymentRequired:true}:{}), ...(okx.error?{error:okx.error}:{}) } : null,
      attempts: result.attempts.map((attempt,index)=>({
        attempt: attempt.attempt,
        plan: attempt.plan,
        decision: attempt.decision,
        receipt: traceReceipts[index],
        ...(attempt.revisionOf?{revisionOf:attempt.revisionOf}:{}),
      })),
      ...(result.errorCode?{errorCode:result.errorCode}:{}),
      ...(result.errorMessage?{errorMessage:result.errorMessage}:{}),
      onchain,
      judgeReceipt,
      proofVerification,
      committed: Boolean(onchain?.ok),
      finalPortfolio: onchain?.ok ? activePortfolio : null,
    };
    traces.push(trace);
    if (mode === "live" && proofVerification?.valid) {
      const artifact = {
        artifactVersion: "circuit-openrouter-proof-v1",
        generatedAt: trace.endedAt,
        provider: "OpenRouter",
        trace,
        receipt: judgeReceipt,
        verification: proofVerification,
      };
      try {
        await mkdir(new URL("./deployments/", import.meta.url), { recursive: true });
        await writeFile(new URL("./deployments/live-openrouter-proof.json", import.meta.url), JSON.stringify(artifact, null, 2) + "\n");
      } catch (error) {
        console.error("[proof-persist]", error instanceof Error ? error.message : String(error));
      }
    }
    if (runToken) runs.set(runToken, trace);
    appendActivity({
      kind: "trace",
      ts: trace.endedAt,
      traceId: trace.id,
      mode: trace.mode,
      status: trace.status,
      verdict: trace.verdict,
      committed: trace.committed,
      attempts: trace.attempts.map(a => ({ attempt: a.attempt, planId: a.plan.id, provider: a.plan.provider, verdict: a.decision.verdict, violations: a.decision.violations.map(v => v.code) })),
      onchainStatus: trace.onchain?.status ?? null,
      evaluationHash: trace.judgeReceipt?.evaluationHash ?? null,
      authorizationHash: trace.judgeReceipt?.authorizationHash ?? null,
      txHash: trace.judgeReceipt?.transactionHash ?? null,
    });
    return sendJson(res,200,{trace});
  }
  if(url.pathname==="/api/circuit/check"&&req.method==="POST"){
    const body=await readBody(req); if(!body.plan||!body.mandate||!body.portfolio||!body.market)return sendJson(res,400,{error:"plan, portfolio, mandate and market are required"});
    return sendJson(res,200,proofFor(body.plan,body.portfolio,body.mandate,body.market,body.checkedAt??new Date().toISOString(),body.commit===true));
  }
  if(url.pathname==="/api/okx/context"){
    const result = await fetchOkxMarketContext(["tslax","googlx","mstrx"]); okxCache=result;
    return sendJson(res,200,{...result,fetchedAtIso:new Date(result.fetchedAt).toISOString(),configured:okxConfigured()});
  }
  if(url.pathname==="/api/okx/quote"&&req.method==="POST"){
    const body=await readBody(req);
    try{
      const params=new URLSearchParams({chainIndex:String(body.chainIndex??1),amount:String(body.amount??"1000000"),fromTokenAddress:String(body.fromTokenAddress??""),toTokenAddress:String(body.toTokenAddress??"")});
      const payload=await okxFetch("GET",`/api/v6/dex/aggregator/quote?${params.toString()}`,{timeoutMs:body.timeoutMs});
      if(payload.code!=="0")throw new Error(`OKX quote error ${payload.code}: ${payload.msg??"unknown"}`);
      return sendJson(res,200,{live:true,provider:"OKX",response:payload.data});
    }catch(error){
      return sendJson(res,502,{error:error instanceof Error?error.message:String(error),live:false,state:error&&error.state?error.state:"UNAVAILABLE",code:error&&error.code?error.code:"OKX_ERROR"});
    }
  }
  if(url.pathname==="/api/market"){
    const assets=await Promise.all(["tslax","googlx","mstrx"].map(async asset=>{
      const result=await getOkxCandles({asset,range:"1D"});
      return {asset,symbol:result.instrument?.symbol??asset,chainLabel:result.instrument?.chainLabel??null,chainIndex:result.instrument?.chainIndex??null,ok:result.ok,lastPrice:result.ok&&result.candles.length?result.candles.at(-1)?.close??null:null};
    }));
    return sendJson(res,200,{assets});
  }
  if(url.pathname.startsWith("/api/market/")&&url.pathname.endsWith("/candles")){
    const asset=decodeURIComponent(url.pathname.split("/")[3]??"");
    const range=["1H","4H","1D","1W","1M"].includes(String(url.searchParams.get("range"))) ? url.searchParams.get("range") : "1D";
    const result=await getOkxCandles({asset,range});
    if(!result.ok) return sendJson(res,result.code==="UNSUPPORTED_ASSET"?404:502,{error:result.message,code:result.code,asset,range,unavailable:true});
    return sendJson(res,200,{
      asset:result.instrument.asset,
      symbol:result.instrument.symbol,
      issuer:result.instrument.issuer,
      chainIndex:Number(result.instrument.chainIndex),
      chainLabel:result.instrument.chainLabel,
      range,
      bar:result.bar,
      provider:"OKX",
      updatedAt:new Date().toISOString(),
      candles:result.candles,
      unavailable:result.candles.length===0,
      note:result.candles.length===0?"MARKET HISTORY UNAVAILABLE":null,
    });
  }
  if(url.pathname==="/api/portfolio/vault") return sendJson(res,200,await vaultStatus());
  if(url.pathname==="/api/rwa/evaluate"&&req.method==="POST"){
    const body=await readBody(req);
    if(!body.asset||!body.portfolio||!body.mandate||!body.allocation)return sendJson(res,400,{error:"asset, portfolio, mandate and allocation are required"});
    const result=evaluateAllocation(body.asset,body.portfolio,body.mandate,body.allocation);
    return sendJson(res,200,result);
  }
  if(url.pathname==="/api/rwa/approve"&&req.method==="POST"){
    const body=await readBody(req);
    if(!body.asset||!body.portfolio||!body.mandate||!body.allocation)return sendJson(res,400,{error:"asset, portfolio, mandate and allocation are required"});
    const evaluation=evaluateAllocation(body.asset,body.portfolio,body.mandate,body.allocation);
    if(evaluation.decision!=="ALLOW")return sendJson(res,200,{decision:"BLOCK",reasonCodes:evaluation.reasonCodes,observed:evaluation.observed,projected:evaluation.projected});
    const approval=createApproval({asset:body.asset,portfolio:body.portfolio,mandate:body.mandate,allocation:body.allocation,evaluation});
    rwaRegistry.add(approval);
    return sendJson(res,200,{decision:"ALLOW",approvalId:approval.approvalId,approvalHash:approval.approvalHash,expiry:approval.expiry,nonce:approval.nonce});
  }
  if(url.pathname==="/api/rwa/execute"&&req.method==="POST"){
    const body=await readBody(req);
    if(!body.approvalHash)return sendJson(res,400,{error:"approvalHash is required"});
    const approval=rwaRegistry.get(body.approvalHash);
    if(!approval)return sendJson(res,404,{error:"INVALID_APPROVAL — no such approval"});
    if(!body.asset||!body.portfolio||!body.mandate||!body.allocation)return sendJson(res,400,{error:"current asset, portfolio, mandate and allocation are required"});
    const fresh=verifyApprovalFreshness(approval,body.asset,body.portfolio,body.mandate,body.allocation);
    if(!fresh.fresh)return sendJson(res,200,{status:"STALE",reason:fresh.reason,capitalMovedUsd:0});
    const outcome=rwaRegistry.execute(approval,()=>({status:"EXECUTED",txHash:`0x${"e1".repeat(32)}`,blockNumber:0}));
    return sendJson(res,200,{status:outcome.status,txHash:outcome.status==="EXECUTED"?outcome.txHash:null,approvalId:approval.approvalId});
  }
  if(url.pathname==="/api/rwa/demo"&&req.method==="POST"){
    const now=new Date().toISOString();
    const blockEvaluation=evaluateAllocation(acmeAsset,alphaPortfolio(),fundAlphaMandate,allocation(100_000));
    const blockReceipt=createDecisionReceipt({
      decisionId:`DEC-${Date.now()}-BLOCK`,chainId:1952,fundId:fundAlphaMandate.fundId,mandateId:fundAlphaMandate.mandateId,mandateVersion:fundAlphaMandate.version,
      mandateHash:mandateHash(fundAlphaMandate),assetId:acmeAsset.assetId,assetStateHash:assetStateHash(acmeAsset),portfolioStateHash:portfolioStateHash(alphaPortfolio()),
      allocationId:allocation(100_000).allocationId,allocationAmountUsd:100_000,evaluation:blockEvaluation,
    });
    const allowEvaluation=evaluateAllocation(acmeAsset,alphaPortfolio(),fundAlphaMandate,allocation(35_000));
    const approval=createApproval({asset:acmeAsset,portfolio:alphaPortfolio(),mandate:fundAlphaMandate,allocation:allocation(35_000),evaluation:allowEvaluation});
    rwaRegistry.add(approval);
    // Consequential execution attempt through the X Layer path. If the onchain
    // venue cannot execute the allocation, the refusal is real — capital stays $0.
    let execution={status:"NOT_ATTEMPTED"};
    try{
      execution=await authorizeActions([{asset:acmeAsset.assetId,assetId:acmeAsset.assetId,side:"BUY",notionalUsd:35_000,expectedSlippageBps:10}]);
    }catch(error){execution={status:"REFUSED",detail:error instanceof Error?error.message:String(error)}}
    const allowReceipt=createDecisionReceipt({
      decisionId:`DEC-${Date.now()}-ALLOW`,chainId:1952,fundId:fundAlphaMandate.fundId,mandateId:fundAlphaMandate.mandateId,mandateVersion:fundAlphaMandate.version,
      mandateHash:mandateHash(fundAlphaMandate),assetId:acmeAsset.assetId,assetStateHash:assetStateHash(acmeAsset),portfolioStateHash:portfolioStateHash(alphaPortfolio()),
      allocationId:allocation(35_000).allocationId,allocationAmountUsd:35_000,evaluation:allowEvaluation,
      approval,executionResult:execution.status==="BLOCKED"?"REFUSED":execution.status,
    });
    rwaReceipts.set(blockReceipt.receiptHash,blockReceipt);
    rwaReceipts.set(allowReceipt.receiptHash,allowReceipt);
    return sendJson(res,200,{
      asset:{assetId:acmeAsset.assetId,status:acmeAsset.verified?"VERIFIED":"NOT_VERIFIED",yieldPct:acmeAsset.yieldPct,maturityDays:acmeAsset.maturityDays,debtor:acmeAsset.debtor,evidence:"FRESH"},
      blocked:{allocationUsd:100_000,decision:blockEvaluation.decision,reasonCodes:blockEvaluation.reasonCodes,observed:blockEvaluation.observed,projected:blockEvaluation.projected,receiptHash:blockReceipt.receiptHash,capitalMovedUsd:0},
      allowed:{allocationUsd:35_000,decision:allowEvaluation.decision,projected:allowEvaluation.projected,approvalId:approval.approvalId,approvalHash:approval.approvalHash,expiry:approval.expiry,execution,receiptHash:allowReceipt.receiptHash,receiptValid:verifyReceipt(allowReceipt).valid},
      timestamp:now,
    });
  }
  if(url.pathname.startsWith("/api/rwa/receipts/")){
    const receipt=rwaReceipts.get(decodeURIComponent(url.pathname.split("/").pop()??""));
    if(!receipt)return sendJson(res,404,{error:"receipt not found"});
    return sendJson(res,200,{receipt,verification:verifyReceipt(receipt)});
  }
  if(url.pathname==="/api/portfolio/authorize"&&req.method==="POST"){
    const body=await readBody(req);
    if(!Array.isArray(body.actions)||body.actions.length===0)return sendJson(res,400,{error:"actions must be a non-empty array"});
    const result=await authorizeActions(body.actions);
    appendActivity({
      kind: "authorization",
      ts: new Date().toISOString(),
      status: result.status,
      actions: body.actions.map(a => ({ assetId: a.assetId, side: a.side, notionalUsd: a.notionalUsd })),
      violations: result.decision?.violations?.map(v => v.code) ?? null,
      evaluationHash: result.evaluationHash ?? null,
      authorizationHash: result.authorizationHash ?? null,
      txHash: result.txHash ?? null,
      detail: result.detail ?? null,
    });
    return sendJson(res,200,result);
  }
  if(url.pathname==="/api/portfolio") return sendJson(res,200,{portfolio:activePortfolio});
  if(url.pathname==="/api/activity"){
    let entries=[];
    try{
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(activityFile, "utf8");
      entries = raw.trim().split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    }catch{}
    return sendJson(res,200,{entries:entries.reverse()});
  }
  if(url.pathname==="/api/receipts") {
    const runtimeProofs=traces.filter(trace=>trace.proofVerification).map(trace=>({traceId:trace.id,...trace.proofVerification}));
    return sendJson(res,200,{receipts,judgeReceipts:judgeReceipts.length?judgeReceipts:(committedJudgeReceipt?[committedJudgeReceipt]:[]),proofVerifications:runtimeProofs.length?runtimeProofs:(committedTrace?.proofVerification?[{traceId:committedTrace.id,...committedTrace.proofVerification}]:[])});
  }
  if(url.pathname==="/api/receipts/export"){
    const receipt = judgeReceipts.at(-1)??committedJudgeReceipt;
    if(!receipt) return sendJson(res,404,{error:"No judge receipt yet. Run the proof first."});
    const trace = traces.find(item=>item.judgeReceipt?.id===receipt.id)??(committedJudgeReceipt?.id===receipt.id?committedTrace:null);
    const body = JSON.stringify({artifactVersion:"circuit-judge-proof-v1",exportedAt:new Date().toISOString(),receipt,verification:trace?.proofVerification??null,trace}, null, 2);
    res.writeHead(200,{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="${receipt.id}.json"`,"cache-control":"no-store"});
    return res.end(body);
  }
  if(url.pathname==="/api/trace") return sendJson(res,200,{trace:traces.at(-1)??committedTrace});
  if(url.pathname==="/api/session/reset"&&req.method==="POST"){receipts.splice(0,receipts.length);traces.splice(0,traces.length);judgeReceipts.splice(0,judgeReceipts.length);runs.clear();activePortfolio=structuredClone(demoPortfolio);return sendJson(res,200,{ok:true,portfolio:activePortfolio});}
  if(url.pathname==="/api/proof/network"){
    const chain = await xlayerStatus();
    const { meta, registry, guard } = await deploymentConfig();
    const verification = await verifyDeployment({ registry, guard });
    const explorer = meta.network.explorerBase;
    return sendJson(res,200,{
      network: { ...meta.network, rpcStatus: chain.connected ? "connected" : "offline", blockNumber: chain.blockNumber },
      deployer: meta.deployer,
      contracts: {
        registry: { name: meta.contracts.registry.name, address: registry, creationTxHash: meta.contracts.registry.creationTxHash, deployedAtBlock: meta.contracts.registry.deployedAtBlock, verification: verification.registry, explorerUrl: explorerUrl(explorer,"address",registry), explorerTxUrl: explorerUrl(explorer,"tx",meta.contracts.registry.creationTxHash) },
        guard: { name: meta.contracts.guard.name, address: guard, creationTxHash: meta.contracts.guard.creationTxHash, deployedAtBlock: meta.contracts.guard.deployedAtBlock, verification: verification.guard, explorerUrl: explorerUrl(explorer,"address",guard), explorerTxUrl: explorerUrl(explorer,"tx",meta.contracts.guard.creationTxHash) },
      },
      proof: {
        mandateTxHash: meta.proof.mandateTxHash,
        mandateTxExplorerUrl: explorerUrl(explorer,"tx",meta.proof.mandateTxHash),
        blockedTradeTxHash: meta.proof.blockedTradeTxHash,
        blockedTradeTxExplorerUrl: explorerUrl(explorer,"tx",meta.proof.blockedTradeTxHash),
        blockedRevertReason: meta.proof.blockedRevertReason,
        authorizedTradeTxHash: meta.proof.authorizedTradeTxHash,
        authorizedTradeTxExplorerUrl: explorerUrl(explorer,"tx",meta.proof.authorizedTradeTxHash),
        authorizationHash: meta.proof.authorizationHash,
        completedAt: meta.proof.completedAt,
      },
      build: meta.build,
      live: verification.live,
    });
  }
  if(url.pathname==="/api/proof") return sendJson(res,200,{chainId:1952,registry:deployment.registry,guard:deployment.guard,receipts,lastTrace:traces.at(-1)??committedTrace,portfolio:activePortfolio,proofStatus:deployment.guard?"deployment-configured":"deployment-pending"});

  let path=url.pathname==="/"?"/index.html":url.pathname; path=normalize(path).replace(/^(\.\.(\/|\\|$))+/,'');
  if(!extname(path)) path = `${path}.html`;
  const file=join(root,path);
  if(!file.startsWith(root)){if(!res.headersSent)res.writeHead(403);return res.end("Forbidden");}
  try{const info=await stat(file);if(!info.isFile())throw new Error("not-file");const content=await readFile(file);res.writeHead(200,{"content-type":mime[extname(file)]??"application/octet-stream"});return res.end(content);}catch{const content=await readFile(join(root,"index.html"));res.writeHead(200,{"content-type":"text/html; charset=utf-8"});return res.end(content);}
}catch(error){sendJson(res,500,{error:error instanceof Error?error.message:"Unknown server error"});}});

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  server.listen(port,"127.0.0.1",()=>console.log(`CIRCUIT → http://127.0.0.1:${port}`));
}

export default server;
