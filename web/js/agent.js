import { $, $$, esc, money, pct, short, api, getJSON, postJSON, mountNav, bust, empty, wallet, onPageCleanup } from "./shared.js";

mountNav();
let mode="demo",working=false,lastTrace=null,currentVault=null;

// Clear transient authorization/execution UI when the wallet disconnects.
const unsubscribeWallet = wallet.subscribe(state=>{
  if(state.status==="disconnected"){
    $("#a-exec").hidden=true;
    $("#a-execute").hidden=true;
    $("#a-exec-body").innerHTML="";
  }
});
onPageCleanup(unsubscribeWallet);

function stage(name){let hit=false;$$('.stage').forEach(el=>{if(el.dataset.stage===name){hit=true;el.classList.add('active');el.classList.remove('done')}else if(!hit){el.classList.add('done');el.classList.remove('active')}else{el.classList.remove('active','done')}})}

async function loadCurrent(){
  try{
    const v=await api.vault(); currentVault=v;
    if(!v.ok){$("#a-current").innerHTML=`<div class="row muted">Vault unavailable — ${esc(v.detail||"")}</div>`;return}
    const nav=v.mandate?.navUsd||1;
    const rows=[
      `<div class="row"><span>NET ASSET VALUE&nbsp;</span><b>${money(nav)}</b></div>`,
      `<div class="row"><span>AVAILABLE CAPITAL&nbsp;</span><b>${money(v.cashUsd)}</b></div>`,
      ...Object.entries(v.positions||{}).filter(([,n])=>n>0).map(([a,n])=>`<div class="row"><span>${esc(a.toUpperCase())}&nbsp;</span><b>${money(n)}</b><span class="muted">&nbsp;${pct(n/nav*100)}</span></div>`),
      `<div class="row"><span>DAILY TURNOVER&nbsp;</span><b>${money(v.dailyTurnoverUsd)}</b></div>`,
    ];
    $("#a-current").innerHTML=rows.join("");
  }catch(e){$("#a-current").innerHTML=`<div class="row muted">${esc(e.message)}</div>`}
}

async function loadMarket(){
  try{
    const [s,boot]=await Promise.all([api.status(),api.bootstrap()]);
    if(mode==="live"&&s.okx?.configured){
      const okx=await api.okx();
      $("#a-market-src").textContent="OKX ONCHAIN OS · LIVE";
      $("#a-market").innerHTML=Object.entries(okx.entries||{}).map(([id,e])=>{
        const c=e.context;
        return `<div class="row"><span>${esc(e.context?.asset||id)} · ${esc(e.state)}&nbsp;</span><b>${c?.price?`$${Number(c.price).toFixed(2)}`:esc("—")}</b><span class="muted">&nbsp;${typeof c?.referenceAgeSeconds==="number"?`${c.referenceAgeSeconds}s`:""}</span></div>`;
      }).join("")||`<div class="row muted">No OKX context.</div>`;
    }else{
      $("#a-market-src").textContent="FIXTURE · DEMO";
      $("#a-market").innerHTML=(boot.market||[]).map(a=>`<div class="row"><span>${esc(a.symbol)} · FIXTURE&nbsp;</span><b>$${Number(a.priceUsd||0).toFixed(2)}</b><span class="muted">&nbsp;${esc(a.marketSession)}</span></div>`).join("");
    }
  }catch(e){$("#a-market").innerHTML=`<div class="row muted">${esc(e.message)}</div>`}
}

function issuerCompare(d){
  const v=d.violations.find(x=>typeof x.projectedExposureBps==="number");
  if(!v)return"";
  const current=((v.projectedExposureBps/100)-((v.projectedExposureBps-v.limitBps)/100));
  const label=(v.issuer||v.sector||v.assetSymbol||"EXPOSURE").toUpperCase();
  return `<div class="compare-table">
    <div><span>CURRENT</span><b>${pct(current)}</b></div>
    <div class="bad"><span>PROJECTED</span><b>${pct(v.projectedExposureBps/100)}</b></div>
    <div class="lim"><span>MANDATE</span><b>${pct(v.limitBps/100)}</b></div>
  </div><div class="rows"><div class="row"><span>${esc(label)}</span><b class="bad">${esc(v.code)}</b></div></div>`;
}

function verdictCard(result,label){
  const d=result.decision;const node=$("#a-verdict");node.hidden=false;
  const violations=d.violations.map(v=>{
    if(typeof v.projectedExposureBps==="number"){
      return `<div class="big-reject"><div><div class="cap">PROJECTED</div><div class="n">${pct(v.projectedExposureBps/100)}</div></div><div><div class="cap">PERMITTED</div><div class="n" style="color:var(--muted)">${pct(v.limitBps/100)}</div></div><code>${esc(v.code)}</code></div>`;
    }
    return `<div class="violation"><div class="row"><span>${esc(v.code)}</span><b>${esc(v.message||"")}</b></div></div>`;
  }).join("");
  $("#a-verdict-body").innerHTML=`<div class="gate-line ${d.allowed?"allow":"block"}"><b>${d.verdict}</b><span>CIRCUIT / ${esc(label)}</span></div>${d.allowed?`<div class="row ok">Every resulting exposure remains inside the active financial mandate.</div>`:violations}${d.allowed?"":issuerCompare(d)}`;
}

function renderPlan(plan,label){
  const source=plan.provider==="fixture"?"FIXTURE":`${esc(plan.provider).toUpperCase()} · ${esc(plan.model||"")}`;
  const generation=plan.provenance?.generationId?`<div class="row"><span>GENERATION&nbsp;</span><b>${esc(plan.provenance.generationId)}</b><span class="muted">&nbsp;${plan.provenance.metadataVerified?"METADATA VERIFIED":"NOT VERIFIED"}</span></div>`:"";
  $("#a-plan").innerHTML=`<div class="row"><span>${esc(label)} · ${esc(plan.id)}&nbsp;</span><b>${source}</b></div>${generation}${plan.intents.map(i=>`<div class="row"><span>${esc(i.side)} ${esc(i.symbol)}&nbsp;</span><b>${money(i.notionalUsd)}</b><span class="muted">&nbsp;${esc(i.rationale||"")}</span></div>`).join("")}`;
}

function renderProjection(decision){
  const after=decision.after;
  $("#a-projected").innerHTML=[
    `<div class="row"><span>NET ASSET VALUE</span><b>${money(10000)}</b></div>`,
    `<div class="row"><span>AVAILABLE CAPITAL</span><b>${money(after.cashUsd)}</b></div>`,
    ...Object.entries(after.assetUsd).filter(([,n])=>n>0).map(([a,n])=>`<div class="row"><span>${esc(a.toUpperCase())}</span><b>${money(n)}</b></div>`),
    `<div class="row"><span>DAILY TURNOVER</span><b>${money(after.dailyTurnoverUsd)}</b></div>`,
  ].join("");
}

function renderReplanDiff(plan1,plan2,blockedDecision){
  const by=new Map(plan1.intents.map(i=>[i.assetId,i]));
  $("#a-replan").hidden=false;
  const v=blockedDecision?.violations?.find(x=>typeof x.projectedExposureBps==="number");
  const rows=plan2.intents.map(i2=>{
    const i1=by.get(i2.assetId);const delta=i1?i2.notionalUsd-i1.notionalUsd:i2.notionalUsd;
    return `<div class="row"><span>${esc(i2.side)} ${esc(i2.symbol)}</span><b>${i1?`${money(i1.notionalUsd)} → ${money(i2.notionalUsd)}`:`${money(i2.notionalUsd)}`}</b><span class="${delta<0?"ok":"bad"}">${i1?(delta<0?`−${money(-delta)}`:`+${money(delta)}`):"NEW"}</span></div>`;
  }).join("");
  let transition="";
  if(v){
    const from=v.projectedExposureBps/100;
    const limit=v.limitBps/100;
    const tsla=plan2.intents.find(i=>i.assetId==="tslax");
    const to=(1500+(tsla?tsla.notionalUsd:0))/100;
    const maxAdditional=Math.max(0,(v.limitBps/10000)*10000-1500);
    transition=`
      <div class="repair-box"><div><div class="cap">REPAIR ENVELOPE · MAXIMUM ADDITIONAL ${esc((v.issuer||"TESLA").toUpperCase())} EXPOSURE</div><b>${money(maxAdditional)}</b></div></div>
      <div class="transition-strip" id="transition-strip">
        <span class="from" data-from="${from.toFixed(1)}">${from.toFixed(1)}%</span>
        <span class="down">↓</span>
        <span class="to" data-to="${to.toFixed(1)}">${to.toFixed(1)}%</span>
        <div class="env"><div class="cap">${esc((v.issuer||"TESLA").toUpperCase())} / ISSUER EXPOSURE · LIMIT ${limit.toFixed(1)}%</div>
          <div class="bar"><i class="warn" style="width:${Math.min(100,from/limit*100)}%"></i><i class="marker" style="left:100%"></i></div>
        </div>
      </div>`;
    requestAnimationFrame(()=>animateTransition(from,to,limit));
  }
  $("#a-replan-body").innerHTML=rows+transition;
}
function animateTransition(from,to,limit){
  const fromEl=document.querySelector("#transition-strip .from");
  const bar=document.querySelector("#transition-strip .bar i.warn");
  if(!fromEl||!bar)return;
  const t0=performance.now(),dur=650;
  function tick(now){
    const t=Math.min(1,(now-t0)/dur);
    const e=1-Math.pow(1-t,3);
    const v=from+(to-from)*e;
    fromEl.textContent=`${v.toFixed(1)}%`;
    bar.style.width=`${Math.min(100,to/limit*100)}%`;
    if(t<1)requestAnimationFrame(tick);
    else{fromEl.style.color="var(--ink)";fromEl.textContent=`${to.toFixed(1)}%`;}
  }
  requestAnimationFrame(tick);
}

async function runProof(){
  if(working)return;working=true;const button=$("#start-agent");button.disabled=true;button.textContent="AGENT WORKING…";
  try{
    $("#a-replan").hidden=true;$("#a-exec").hidden=true;$("#a-verdict").hidden=true;
    await Promise.all([loadCurrent(),loadMarket()]);
    const objective=$("#objective-input").value.trim();
    stage("market");
    const runToken=(crypto.randomUUID&&crypto.randomUUID())||`run-${Date.now()}`;
    const {trace}=await getJSON("/api/circuit/run",postJSON("/api/circuit/run",{mode,objective,runToken}));
    lastTrace=trace;bust("activity","receipts","trace");
    stage("plan");
    if(trace.status==="AI_UNAVAILABLE"||trace.status==="AI_ERROR"||!trace.attempts.length){
      $("#a-verdict").hidden=false;
      $("#a-verdict-body").innerHTML=`<div class="gate-line block"><b>${esc(trace.status)}</b><span>FAIL CLOSED / NO COMMIT</span></div><div class="row muted">${esc(trace.errorMessage||trace.errorCode||"The live planner is unavailable.")}</div>`;
      stage("evaluate");return;
    }
    let plan1=null;
    for(const attempt of trace.attempts){
      const label=attempt.attempt===1?"PLAN / 001":"REVISED / 002";
      renderPlan(attempt.plan,label);
      renderProjection(attempt.decision);
      verdictCard({decision:attempt.decision},label);
      stage(attempt.decision.allowed?"authorize":"evaluate");
      if(!attempt.decision.allowed&&attempt!==trace.attempts.at(-1)){
        plan1=attempt.plan;
        renderReplanDiff(attempt.plan,trace.attempts.at(-1).plan,attempt.decision);
        stage("replan");
        await new Promise(r=>setTimeout(r,mode==="demo"?600:150));
      }
    }
    if(trace.committed&&trace.judgeReceipt){
      stage("receipt");
      $("#a-exec").hidden=false;
      $("#a-exec-body").innerHTML=execReceiptHtml(trace.judgeReceipt);
    }else if(trace.onchain&&!trace.onchain.ok){
      stage("execute");
      $("#a-exec").hidden=false;
      $("#a-exec-body").innerHTML=`<div class="row warn">${esc(trace.onchain.status)} — ${esc(trace.onchain.detail||"")}</div>`;
    }else if(trace.allowed){
      stage("authorize");
      $("#a-exec").hidden=false;
      $("#a-exec-body").innerHTML=`<div class="gate-line allow"><b>AUTHORIZED</b><span>WITHIN MANDATE</span></div><div class="row ok">Execute the compliant plan through the guarded vault:</div>`;
      $("#a-execute").hidden=false;
    }
  }catch(e){
    $("#a-verdict").hidden=false;
    $("#a-verdict-body").innerHTML=`<div class="gate-line block"><b>PROVIDER FAILURE</b><span>FAIL CLOSED</span></div><div class="row muted">${esc(e.message)}</div>`;
  }finally{working=false;button.disabled=false;button.textContent="RUN AGENT"}
}

function execReceiptHtml(r){
  return `<div class="row"><span>DECISION</span><b class="ok">AUTHORIZED</b></div>
  <div class="row"><span>REJECTION (PLAN / 001)</span><b class="bad">${esc(r.rejectionCode)}</b></div>
  <div class="row"><span>EVALUATION</span><b>${esc(short(r.evaluationHash))}</b></div>
  <div class="row"><span>AUTHORIZATION</span><b>${esc(short(r.authorizationHash))}</b></div>
  <div class="row"><span>X LAYER TX</span><b><a href="https://www.okx.com/web3/explorer/xlayer-test/tx/${esc(r.transactionHash)}" target="_blank" rel="noopener">${esc(short(r.transactionHash))}</a></b></div>
  <div class="row"><span>RECEIPT</span><b>${esc(short(r.receiptHash))}</b> <a class="text-link" href="/reports#execution" style="color:var(--ink);border-bottom:1px solid var(--ink);text-decoration:none">VIEW REPORT</a></div>`;
}

async function executeThroughVault(){
  if(!lastTrace||!lastTrace.allowed)return;
  const actions=lastTrace.attempts.at(-1).plan.intents.map(i=>({asset:i.symbol,assetId:i.assetId,side:i.side,notionalUsd:i.notionalUsd,expectedSlippageBps:i.expectedSlippageBps}));
  $("#a-execute").disabled=true;$("#a-execute").textContent="EXECUTING…";
  try{
    const result=await getJSON("/api/portfolio/authorize",postJSON("/api/portfolio/authorize",{actions}));
    bust("activity","vault");
    stage("execute");
    $("#a-exec-body").innerHTML=result.ok
      ?`<div class="row ok">${esc(result.status)} — <a href="https://www.okx.com/web3/explorer/xlayer-test/tx/${esc(result.txHash)}" target="_blank" rel="noopener">${esc(short(result.txHash))}</a> · BLOCK ${result.blockNumber}</div><div class="row"><span>AUTH</span><b>${esc(short(result.authorizationHash))}</b></div>`
      :result.status==="BLOCKED"
        ?`<div class="gate-line block"><b>BLOCKED BY CIRCUIT</b></div>${result.decision.violations.map(v=>`<div class="row warn"><span>${esc(v.code)}</span></div>`).join("")}`
        :`<div class="row warn">${esc(result.status)} — ${esc(result.detail||"")}</div>`;
    await loadCurrent();
  }catch(e){$("#a-exec-body").innerHTML=`<div class="row warn">${esc(e.message)}</div>`}
  finally{$("#a-execute").disabled=false;$("#a-execute").textContent="EXECUTE THROUGH VAULT"}
}

$$('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;$$('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));$("#agent-mode-chip").textContent=mode==="demo"?"DEMO / FIXTURES":"LIVE / OKX + AI";loadMarket()}));
$("#start-agent").addEventListener('click',runProof);
$("#a-execute").addEventListener('click',executeThroughVault);
(async()=>{try{const s=await api.status();if(s.ai?.configured){mode="live";$$('[data-mode]').forEach(x=>x.classList.toggle('active',x.dataset.mode==="live"));$("#agent-mode-chip").textContent="LIVE / OKX + AI"}}catch{}await Promise.all([loadCurrent(),loadMarket()])})();
