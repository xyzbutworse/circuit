import { $, esc, money, pct, short, iso, txLink, api, mountNav } from "./shared.js";

mountNav();

const kv=(k,v)=>`<div class="report-evidence-row"><span class="report-evidence-label">${esc(k)}&nbsp;</span><b class="report-evidence-value">${v}</b></div>`;
const rule=()=>`<div class="doc-rule"></div>`;
const EMPTY=(title,body)=>`<div class="empty-state"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`;

export function assembleReports(input){
  const { vault, receipts, trace, status, network, activity, okx } = input;
  const now = input.now ?? new Date().toISOString();
  const reports = [];
  const judgeReceipts = receipts?.judgeReceipts ?? [];
  const attemptReceipts = receipts?.receipts ?? [];
  const lastTrace = trace?.trace ?? null;
  const nav = vault?.ok ? (vault.mandate?.navUsd ?? 10000) : 10000;
  const issuerUsd = (name) => (vault?.ok ? (vault.issuerExposures?.[name] ?? 0) : 0);

  // ---- 01 PORTFOLIO REPORT ----
  if (vault?.ok) {
    reports.push({
      anchor:"portfolio", id:`CR-PORT-${(vault.portfolioStateHash||"").slice(2,10)||"none"}`,
      title:"PORTFOLIO REPORT", docTitle:"Portfolio / Alpha-01",
      portfolioId:vault.portfolioId, timestamp:now,
      portfolioStateHash:vault.portfolioStateHash, mandateVersion:vault.portfolioVersion, mandateHash:vault.mandate?.mandateHash,
      body:rule()
        +kv("OWNER",esc(vault.owner))
        +kv("VAULT",`<a href="https://www.okx.com/web3/explorer/xlayer-test/address/${esc(vault.addresses?.vault)}" target="_blank" rel="noopener">${esc(vault.addresses?.vault)}</a>`)
        +kv("NAV",money(vault.mandate?.navUsd))+kv("CASH",money(vault.cashUsd))
        +kv("INVESTED",money(vault.investedUsd))+kv("TURNOVER",money(vault.dailyTurnoverUsd))
        +rule()
        +Object.entries(vault.positions??{}).map(([a,n])=>kv(`POSITION ${a.toUpperCase()}`,money(n))).join("")
        +Object.entries(vault.issuerExposures??{}).map(([n,x])=>kv(`ISSUER ${n}`,money(x))).join("")
        +Object.entries(vault.sectorExposures??{}).map(([n,x])=>kv(`SECTOR ${n}`,money(x))).join(""),
    });
  } else {
    reports.push({ anchor:"portfolio", id:"CR-PORT-NONE", title:"PORTFOLIO REPORT", docTitle:"Portfolio / Unavailable", portfolioId:"portfolio-alpha-01", timestamp:now, portfolioStateHash:null, mandateVersion:null, mandateHash:null,
      body:EMPTY("NO PORTFOLIO DATA","The vault could not be reached. No report is fabricated.") });
  }

  // ---- 02 MANDATE COMPLIANCE REPORT ----
  if (vault?.ok) {
    const m=vault.mandate;
    reports.push({
      anchor:"mandate", id:`CR-MAND-${String(m?.version??0)}`,
      title:"MANDATE COMPLIANCE REPORT", docTitle:"Mandate / Compliance",
      portfolioId:vault.portfolioId, timestamp:now,
      portfolioStateHash:vault.portfolioStateHash, mandateVersion:m?.version, mandateHash:m?.mandateHash,
      body:rule()
        +Object.entries(vault.issuerExposures??{}).map(([n,x])=>{const p=x/nav*100;const lim=(m?.maxIssuerExposureBps??3500)/100;return kv(`${n} EXPOSURE`,`${pct(p)} / ${pct(lim)} ${p<=lim?"· PASS":"· FAIL"}`)}).join("")
        +Object.entries(vault.sectorExposures??{}).map(([n,x])=>{const p=x/nav*100;const lim=(m?.maxSectorExposureBps??5000)/100;return kv(`${n} SECTOR`,`${pct(p)} / ${pct(lim)} ${p<=lim?"· PASS":"· FAIL"}`)}).join("")
        +kv("TURNOVER",`${pct(vault.dailyTurnoverUsd/nav*100)} / ${pct((m?.maxDailyTurnoverBps??7000)/100)}`),
    });
  } else {
    reports.push({ anchor:"mandate", id:"CR-MAND-NONE", title:"MANDATE COMPLIANCE REPORT", docTitle:"Mandate / Unavailable", portfolioId:"portfolio-alpha-01", timestamp:now, portfolioStateHash:null, mandateVersion:null, mandateHash:null,
      body:EMPTY("NO MANDATE DATA","The mandate could not be read from the vault.") });
  }

  // ---- 03 DECISION REPORT (last blocked evaluation) ----
  const blockedAttempt = lastTrace?.attempts?.find(a => a.decision?.verdict === "BLOCKED" && a.decision?.violations?.some(v => typeof v.projectedExposureBps === "number"))
    ?? (activity?.entries ?? []).find(e => e.kind === "trace" && e.verdict === "BLOCKED" && e.attempts?.[0]?.violations?.length);
  const vio = lastTrace?.attempts?.flatMap(a => a.decision?.violations ?? []).find(v => typeof v.projectedExposureBps === "number")
    ?? blockedAttempt?.attempts?.[0]?.violations?.[0];
  if (vio && lastTrace) {
    const projected = vio.projectedExposureBps / 100;
    const limit = vio.limitBps / 100;
    const current = issuerUsd(vio.issuer) / nav * 100;
    const proposedIntent = lastTrace.attempts.find(a => a.decision?.violations?.some(v => v.code === vio.code))?.plan?.intents?.find(i => String(i.assetId).toLowerCase() === (vio.assetId ?? "tslax"));
    const proposed = proposedIntent ? `+${money(proposedIntent.notionalUsd)}` : "—";
    const repair = Math.max(0, (vio.limitBps / 10000) * nav - issuerUsd(vio.issuer));
    reports.push({
      anchor:"decision", id:`CR-DEC-${String(lastTrace.judgeReceipt?.evaluationHash ?? lastTrace.id ?? "").slice(0,16)||"none"}`,
      title:"CIRCUIT DECISION REPORT", docTitle:"Decision / Blocked",
      portfolioId:"portfolio-alpha-01", timestamp:lastTrace.endedAt ?? now,
      portfolioStateHash:lastTrace.judgeReceipt?.finalPortfolioHash ?? null, mandateVersion:lastTrace.judgeReceipt?.policyVersion ?? 1, mandateHash:vault?.mandate?.mandateHash,
      body:rule()+`<div class="gate-line block"><b>BLOCKED</b><span>&nbsp;DECISION</span></div>`
        +`<div class="big-reject"><div><div class="cap">PROJECTED · ${esc((vio.issuer||"EXPOSURE").toUpperCase())}&nbsp;</div><div class="n">${pct(projected)}&nbsp;</div></div><div><div class="cap">MANDATE MAXIMUM&nbsp;</div><div class="n" style="color:var(--muted)">${pct(limit)}&nbsp;</div></div><code>${esc(vio.code)}</code></div>`
        +rule()+`<div class="rows">
        <div class="row"><span>CURRENT&nbsp;</span><b>${pct(current)}</b></div>
        <div class="row"><span>ACTION&nbsp;</span><b>${proposed}</b></div>
        <div class="row"><span>PROJECTED&nbsp;</span><b class="bad">${pct(projected)}</b></div>
        <div class="row"><span>MAXIMUM&nbsp;</span><b>${pct(limit)}</b></div>
        </div>`
        +rule()+`<div class="rows"><div class="row"><span>REPAIR ENVELOPE&nbsp;</span><b>Maximum additional ${esc(vio.issuer??"exposure")}: ${money(repair)}</b></div></div>`
        +rule()
        +kv("PORTFOLIO STATE",esc(short(lastTrace.judgeReceipt?.finalPortfolioHash)))
        +kv("MANDATE",esc(short(vault?.mandate?.mandateHash)))
        +kv("EVALUATION",esc(short(lastTrace.judgeReceipt?.evaluationHash ?? lastTrace.attempts?.[0]?.decision?.planHash))),
    });
  } else {
    reports.push({ anchor:"decision", id:"CR-DEC-NONE", title:"CIRCUIT DECISION REPORT", docTitle:"Decision / Awaiting", portfolioId:"portfolio-alpha-01", timestamp:now, portfolioStateHash:null, mandateVersion:vault?.mandate?.version, mandateHash:vault?.mandate?.mandateHash,
      body:EMPTY("NO BLOCKED DECISION YET","Run the agent once. Circuit will document the first rejected action here with its repair envelope.") });
  }

  // ---- 04 EXECUTION REPORT ----
  const jr = judgeReceipts.at(-1) ?? lastTrace?.judgeReceipt ?? null;
  if (jr) {
    reports.push({
      anchor:"execution", id:`CR-EXEC-${String(jr.transactionHash||"").slice(2,10)||"none"}`,
      title:"CIRCUIT EXECUTION REPORT", docTitle:"Execution / Confirmed",
      portfolioId:jr.portfolioId ?? "portfolio-alpha-01", timestamp:jr.createdAt ?? now,
      portfolioStateHash:jr.finalPortfolioHash, mandateVersion:jr.policyVersion ?? 1, mandateHash:jr.mandateHash,
      body:rule()+`<div class="gate-line allow"><b>AUTHORIZED</b><span>&nbsp;EXECUTION / CONFIRMED</span></div>`
        +rule()+kv("ACTIONS",(jr.trades??[]).map(t=>`${String(t.assetId).toUpperCase()} ${t.side} ${money(t.notionalUsd)}`).join(" · ")||"—")
        +kv("PRE-TRADE STATE",esc(short(jr.previousReceiptHash)))
        +kv("POST-TRADE STATE",esc(short(jr.finalPortfolioHash)))
        +kv("MANDATE",`V${String(jr.policyVersion ?? 1).padStart(2,"0")}`)
        +rule()+kv("EVALUATION",esc(short(jr.evaluationHash)))
        +kv("AUTHORIZATION",esc(short(jr.authorizationHash)))
        +kv("X LAYER TRANSACTION",txLink(jr.transactionHash))
        +kv("RECEIPT",esc(short(jr.receiptHash))),
    });
  } else {
    reports.push({ anchor:"execution", id:"CR-EXEC-NONE", title:"CIRCUIT EXECUTION REPORT", docTitle:"Execution / Awaiting", portfolioId:"portfolio-alpha-01", timestamp:now, portfolioStateHash:null, mandateVersion:vault?.mandate?.version, mandateHash:vault?.mandate?.mandateHash,
      body:EMPTY("NO EXECUTION YET","A completed authorization will appear here with its X Layer transaction and receipt.") });
  }

  // ---- 05 AGENT TRACE REPORT ----
  if (lastTrace?.attempts?.length) {
    reports.push({
      anchor:"trace", id:`CR-TRACE-${String(lastTrace.id||"").slice(0,14)||"none"}`,
      title:"AGENT TRACE REPORT", docTitle:"Agent Trace",
      portfolioId:"portfolio-alpha-01", timestamp:lastTrace.endedAt ?? now,
      portfolioStateHash:lastTrace.judgeReceipt?.finalPortfolioHash ?? null, mandateVersion:1, mandateHash:vault?.mandate?.mandateHash,
      body:rule()+`<div class="row"><span>USER OBJECTIVE&nbsp;</span><b>${esc(lastTrace.objective||"")}</b></div>`
        +lastTrace.attempts.map(a=>`<div class="row"><span>PLAN / ${String(a.attempt).padStart(3,"0")} · ${a.plan.provider==="fixture"?"FIXTURE":`${esc(a.plan.provider).toUpperCase()} · ${esc(a.plan.model||"")}`}&nbsp;</span><b class="${a.decision.verdict==="AUTHORIZED"?"ok":"bad"}">${esc(a.decision.verdict)}</b><span class="muted">&nbsp;${a.decision.violations.map(v=>esc(v.code)).join(", ")||"no violations"}${a.plan.provenance?.generationId?` · ${esc(short(a.plan.provenance.generationId))}`:""}</span></div>`).join("")
        +rule()+(lastTrace.judgeReceipt?kv("REJECTION CODE (PLAN / 001)",esc(lastTrace.judgeReceipt.rejectionCode)):"")
        +kv("EXECUTION",lastTrace.onchain?esc(lastTrace.onchain.status):esc("not executed")),
    });
  } else {
    reports.push({ anchor:"trace", id:"CR-TRACE-NONE", title:"AGENT TRACE REPORT", docTitle:"Agent Trace / Awaiting", portfolioId:"portfolio-alpha-01", timestamp:now, portfolioStateHash:null, mandateVersion:1, mandateHash:vault?.mandate?.mandateHash,
      body:EMPTY("NO AGENT TRACE YET","The objective → plan → rejection → replan → approval sequence will be documented here.") });
  }

  // ---- 06 AUDIT REPORT ----
  reports.push({
    anchor:"audit", id:`CR-AUDIT-${attemptReceipts.length||0}`,
    title:"AUDIT REPORT", docTitle:"Audit / Receipt Chain",
    portfolioId:"portfolio-alpha-01", timestamp:now,
    portfolioStateHash:attemptReceipts.at(-1)?.afterPortfolioHash ?? null, mandateVersion:1, mandateHash:vault?.mandate?.mandateHash,
    body:rule()+kv("RECEIPTS",String(attemptReceipts.length))
      +(attemptReceipts.length?attemptReceipts.slice(-8).reverse().map(r=>`<div class="row"><span>${esc(r.verdict)} · ${esc(r.planId)}&nbsp;</span><b>${esc(short(r.receiptHash))}</b></div>`).join(""):kv("LEDGER","No attempt receipts yet.")),
  });

  // ---- 07 PROVIDER / PROVENANCE REPORT ----
  reports.push({
    anchor:"provenance", id:`CR-PROV-${String(now).slice(0,10).replace(/-/g,"")}`,
    title:"PROVIDER / PROVENANCE REPORT", docTitle:"Providers / Provenance",
    portfolioId:"portfolio-alpha-01", timestamp:now,
    portfolioStateHash:vault?.ok?vault.portfolioStateHash:null, mandateVersion:vault?.mandate?.version, mandateHash:vault?.mandate?.mandateHash,
    body:rule()
      +kv("AI",status?.ai?.configured?`${status.ai.provider} · ${status.ai.model}`:esc("UNAVAILABLE"))
      +(lastTrace?.attempts?.length?lastTrace.attempts.map(a=>kv(`AI GENERATION / ${String(a.attempt).padStart(3,"0")}`,a.plan.provenance?.metadataVerified?`${esc(a.plan.provenance.generationId)} · VERIFIED`:esc("NOT PROVEN"))).join(""):"")
      +kv("PROOF VERIFIER",lastTrace?.proofVerification?.valid?"PASS · ALL LINKS VERIFIED":lastTrace?.proofVerification?"FAIL · INCOMPLETE OR MISMATCHED":"AWAITING LIVE TRACE")
      +kv("OKX",status?.okx?.configured?`OKX Onchain OS · ${status.okx.state}`:esc("MISCONFIGURED"))
      +kv("X LAYER RPC",status?.xlayer?.connected?`LIVE #${status.xlayer.blockNumber}`:esc("OFFLINE"))
      +kv("REGISTRY",txLink(network?.contracts?.registry?.creationTxHash))
      +kv("GUARD",txLink(network?.contracts?.guard?.creationTxHash))
      +kv("BLOCKED EVALUATION PROOF",txLink(network?.proof?.blockedTradeTxHash)+` · ${esc(network?.proof?.blockedRevertReason||"")}`)
      +kv("AUTHORIZED TRANSACTION",txLink(network?.proof?.authorizedTradeTxHash))
      +kv("OKX MARKET CONTEXT",status?.okx?.configured?`${okx?.state} · ${iso(okx?.fetchedAtIso)}`:esc("MISCONFIGURED"))
      +kv("MCP",status?.mcp?.healthy?"LIVE · 8 TOOLS":esc("OFFLINE"))
      +kv("CODEX",esc(status?.mcp?.agents?.codex?.status||"UNCONFIGURED"))
      +kv("CLAUDE",esc(status?.mcp?.agents?.claude?.status||"UNCONFIGURED")),
  });

  return reports;
}

function reportCard(report){
  return `<section class="report-card" id="${esc(report.anchor)}">
    <div class="report-head"><span class="card-label">${esc(report.title)}</span>
      <div class="report-actions">
        <button data-copy="${esc(report.id)}">COPY ID</button>
        <button data-export="${esc(report.id)}">EXPORT JSON</button>
      </div>
    </div>
    <div class="doc-head">${esc(report.docTitle)}</div>
    <dl class="kv report-meta">
      <dt>REPORT ID&nbsp;</dt><dd><code>${esc(report.id)}</code></dd>
      <dt>PORTFOLIO&nbsp;</dt><dd>${esc(report.portfolioId||"—")}</dd>
      <dt>TIMESTAMP&nbsp;</dt><dd>${esc(report.timestamp)}</dd>
      <dt>STATE HASH&nbsp;</dt><dd><code>${esc(short(report.portfolioStateHash))}</code></dd>
      <dt>MANDATE&nbsp;</dt><dd>${report.mandateVersion?`V${esc(String(report.mandateVersion).padStart(2,"0"))}`:"—"} · ${esc(short(report.mandateHash))}</dd>
    </dl>
    ${report.body}
  </section>`;
}

function paintNav(reports){
  const byAnchor=new Map(reports.map(r=>[r.anchor,r]));
  document.querySelectorAll("#report-nav a").forEach(a=>{
    const anchor=a.getAttribute("href")?.slice(1);
    const status=a.querySelector(".st");
    if(!anchor||!status)return;
    if(anchor==="decision"){status.textContent=byAnchor.get("decision")?.id.endsWith("NONE")?"AWAITING":"BLOCKED";status.className="st"+(byAnchor.get("decision")?.id.endsWith("NONE")?"":"");}
    if(anchor==="execution"){status.textContent=byAnchor.get("execution")?.id.endsWith("NONE")?"AWAITING":"CONFIRMED";}
    if(anchor==="trace"){status.textContent=byAnchor.get("trace")?.id.endsWith("NONE")?"AWAITING":"LIVE";}
  });
}

async function build(){
  const root=$("#reports-root"); if(!root) return;
  root.innerHTML=`<div class="row muted">Loading reports from live Circuit state…</div>`;
  try{
    const [vault,receipts,trace,status,network,activity,okx]=await Promise.all([api.vault(),api.receipts(),api.trace(),api.status(),api.network(),api.activity(),api.okx()]);
    const reports=assembleReports({vault,receipts,trace,status,network,activity,okx});
    root.innerHTML=reports.map(reportCard).join("");
    paintNav(reports);
    root.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",()=>{navigator.clipboard?.writeText(b.dataset.copy);b.textContent="COPIED";setTimeout(()=>b.textContent="COPY ID",1200)}));
    root.querySelectorAll("[data-export]").forEach(b=>b.addEventListener("click",()=>{
      const r=reports.find(x=>x.id===b.dataset.export);
      const blob=new Blob([JSON.stringify(r,null,2)],{type:"application/json"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${r.id}.json`;a.click();
    }));
    if(location.hash){
      const anchor=location.hash.slice(1);
      const target=root.querySelector(`#${CSS.escape(anchor)}`) ?? root.querySelector(`#${CSS.escape(anchor.replace(/^trace-.*/,"trace"))}`);
      if(target)target.scrollIntoView({block:"start"});
    }
  }catch(e){root.innerHTML=`<div class="error-note"><b>REPORTS UNAVAILABLE</b>${esc(e.message)}</div>`}
}
build();
