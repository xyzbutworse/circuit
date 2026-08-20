import { $, esc, short, txLink, api, mountNav } from "./shared.js";

mountNav();

async function render(){
  try{
    const [status,network,vault,receipts,trace,okx]=await Promise.all([api.status(),api.network(),api.vault(),api.receipts(),api.trace(),api.okx()]);

    const items=[
      ["AI PLANNER",status.ai?.configured,`${status.ai?.provider} · ${status.ai?.model||"MODEL REQUIRED"}`],
      ["OKX ONCHAIN OS",status.okx?.configured&&okx.state==="LIVE",`STATE ${okx.state??status.okx?.state??"?"}`],
      ["X LAYER RPC",Boolean(status.xlayer?.connected),`CHAIN 1952 · BLOCK #${status.xlayer?.blockNumber??"—"}`],
      ["CircuitMandateRegistry",["verified","deployed"].includes(network.contracts?.registry?.verification?.status),short(network.contracts?.registry?.address)],
      ["CircuitPortfolioGuard",["verified","deployed"].includes(network.contracts?.guard?.verification?.status),short(network.contracts?.guard?.address)],
      ["CircuitPortfolioVault",Boolean(vault.ok),short(vault.addresses?.vault)],
      ["EXECUTION ADAPTER",Boolean(vault.ok&&vault.adapter),short(vault.adapter)],
      ["MCP",Boolean(status.mcp?.healthy),"8 TOOLS · HTTP + STDIO"],
      ["CODEX",status.mcp?.agents?.codex?.status==="MCP_REGISTERED",status.mcp?.agents?.codex?.status??"?"],
      ["CLAUDE",status.mcp?.agents?.claude?.status==="MCP_CONNECTED",status.mcp?.agents?.claude?.status??"?"],
    ];
    $("#ps-grid").innerHTML=items.map(([name,ok,detail],i)=>`<div class="audit-row"><b>${esc(name)}</b><b class="${ok?"ok":"bad"}">${ok?"LIVE":"—"}</b><small>${esc(detail)}</small></div>`).join("");

    const d=network.contracts||{};
    $("#ps-deployments").innerHTML=[
      row("/01","CircuitMandateRegistry",d.registry?.address,`<a href="https://www.okx.com/web3/explorer/xlayer-test/address/${esc(d.registry?.address||"")}" target="_blank" rel="noopener">VIEW →</a>`),
      row("/02","CircuitPortfolioGuard",d.guard?.address,`<a href="https://www.okx.com/web3/explorer/xlayer-test/address/${esc(d.guard?.address||"")}" target="_blank" rel="noopener">VIEW →</a>`),
      row("/03","CircuitPortfolioVault",vault.addresses?.vault,`<a href="https://www.okx.com/web3/explorer/xlayer-test/address/${esc(vault.addresses?.vault||"")}" target="_blank" rel="noopener">VIEW →</a>`),
      row("/04","CircuitExecutionAdapter",vault.adapter,`<a href="https://www.okx.com/web3/explorer/xlayer-test/address/${esc(vault.adapter||"")}" target="_blank" rel="noopener">VIEW →</a>`),
    ].join("");

    const p=network.proof||{};
    $("#ps-txs").innerHTML=[
      row("/001","BLOCKED EVALUATION",p.blockedRevertReason??esc("—"),txLink(p.blockedTradeTxHash)),
      row("/002","COMPLIANT REPLAN · AUTHORIZATION",p.authorizationHash?short(p.authorizationHash):esc("—"),txLink(p.authorizedTradeTxHash)),
      row("/003","MANDATE PUBLICATION",esc("—"),txLink(p.mandateTxHash)),
      row("/004","LATEST EXECUTION",trace.trace?.judgeReceipt?`${trace.trace.judgeReceipt.rejectionCode}`:esc("none yet"),txLink(trace.trace?.judgeReceipt?.transactionHash)),
    ].join("");

    const jr=(receipts.judgeReceipts||[]).at(-1)||trace.trace?.judgeReceipt;
    $("#ps-receipt").innerHTML=jr?[
      row("/005","CIRCUIT RECEIPT",jr.rejectionCode||jr.verdict||esc("—"),`<code>${esc(short(jr.receiptHash))}</code>`),
      row("","EVALUATION",esc(short(jr.evaluationHash)),""),
      row("","AUTHORIZATION",esc(short(jr.authorizationHash)),txLink(jr.transactionHash)),
      row("","EXPORT",`<a href="/api/receipts/export" download style="border-bottom:1px solid var(--ink);text-decoration:none">DOWNLOAD JSON</a>`,""),
    ].join(""):`<div class="row muted">No judge receipt yet — run the agent once.</div>`;

    $("#ps-tests").innerHTML=[
      row("/006","OFFCHAIN TESTS","RUN npm test","deterministic engine + MCP + provider proof"),
      row("/007","CONTRACT TESTS","SEE EVIDENCE INDEX","vault / guard / registry security suite"),
      row("/008","PARITY","SEE PARITY ARTIFACT","Web REST = MCP = engine"),
    ].join("");

    const proofChecks=trace.trace?.proofVerification?.checks||[];
    const check=(...ids)=>ids.length>0&&ids.every(id=>proofChecks.find(item=>item.id===id)?.valid===true);
    const claims=[
      {label:"A human-funded vault exists",ok:Boolean(vault.ok&&vault.funded),detail:"vault funding readback"},
      {label:"The blocked trade reverted onchain",ok:Boolean(p.blockedTradeTxHash&&p.blockedRevertReason),detail:"revert transaction + reason"},
      {label:"A repaired plan was authorized",ok:Boolean(p.authorizedTradeTxHash&&p.authorizationHash),detail:"authorization + transaction"},
      {label:"Real AI produced the plans",ok:check("OPENROUTER_GENERATIONS","AI_EVIDENCE_LINKS","PLAN_HASHES"),detail:proofChecks.find(item=>item.id==="OPENROUTER_GENERATIONS")?.detail||"no verified OpenRouter generation"},
      {label:"OKX market data fed the planner",ok:status.okx?.configured&&okx.state==="LIVE"&&trace.trace?.market?.provider==="OKX"&&trace.trace?.attempts?.length>0,detail:"live trace market source + evaluated plan"},
      {label:"Receipts link evaluation → tx → state",ok:check("JUDGE_RECEIPT_HASH","EVALUATION_RECEIPTS","EVALUATION_CHAIN","ONCHAIN_TRANSACTIONS","ONCHAIN_READBACK","HEADLINE_TRANSACTION"),detail:"receipt verifier checks"},
      {label:"Agent cannot bypass the vault",ok:check("ONCHAIN_TRANSACTIONS","ONCHAIN_READBACK"),detail:"guard authorization + state readback"},
    ];
    $("#ps-claims").innerHTML=claims.map((claim,i)=>`<div class="audit-row"><b>${esc(claim.label)}</b><b class="${claim.ok?"ok":"bad"}">${claim.ok?"PROVEN":"NOT PROVEN"}</b><small>/00${i+1} · ${esc(claim.detail)}</small></div>`).join("");
  }catch(e){$("#ps-grid").innerHTML=`<div class="row muted">${esc(e.message)}</div>`}
}
const row=(idx,label,value,link)=>`<div class="audit-row"><b><span class="muted">${esc(idx)}</span>&nbsp;${esc(label)}</b><b>${value}</b><small>&nbsp;${link||""}</small></div>`;
render();
