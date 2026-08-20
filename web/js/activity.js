import { $, $$, esc, iso, short, api, mountNav } from "./shared.js";

mountNav();
let filter="ALL",entries=[];

function classify(e){
  if(e.kind==="trace"){
    if(e.committed)return["EXECUTED","ONCHAIN","AGENT"];
    if(e.verdict==="BLOCKED"||e.attempts?.some(a=>a.verdict==="BLOCKED"))return["BLOCKED","AGENT"];
    return["AGENT"];
  }
  if(e.kind==="authorization"){
    if(e.status==="BLOCKED")return["BLOCKED"];
    if(e.status==="EXECUTED"||e.status==="AUTHORIZED")return["AUTHORIZED","ONCHAIN"];
    return["ONCHAIN"];
  }
  return[];
}

function entryHtml(e,i){
  const tags=classify(e);
  const idx=`/${String(i+1).padStart(3,"0")}`;
  const time=e.ts?new Date(e.ts):null;
  const day=time?time.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase():"—";
  const clock=time?time.toLocaleTimeString("en-GB",{hour12:false}):"—";
  let label,title;
  if(e.kind==="trace"){
    const a1=e.attempts?.[0];const last=e.attempts?.at(-1);
    label=`AGENT RUN / ${e.mode==="live"?"LIVE":"DEMO"}`;
    title=`PLAN ${e.attempts?`${a1.planId}`:"—"} · ${e.attempts?.length||0} ATTEMPT(S)`;
    if(last?.verdict==="AUTHORIZED"&&e.committed)title+=` · EXECUTED`;
    else if(last?.verdict==="AUTHORIZED")title+=` · COMPLIANT`;
    else if(e.verdict==="BLOCKED")title+=` · BLOCKED`;
  }else{
    label=e.kind==="authorization"?"AUTHORIZATION / EXECUTION":e.kind.toUpperCase();
    title=`${e.status}${e.detail?` — ${e.detail.slice(0,90)}`:""}`;
  }
  const block=tags.includes("BLOCKED")&&!tags.includes("EXECUTED");
  const ok=tags.includes("EXECUTED")||tags.includes("AUTHORIZED");
  const link=e.kind==="trace"?(tags.includes("BLOCKED")&&!tags.includes("EXECUTED")?`<a href="/reports#decision">DECISION</a>`:`<a href="/reports#trace">TRACE</a>`):`<a href="/reports#execution">REPORT</a>`;
  return `<div class="ledger-item"><time>${day}<br>${clock}</time><p><span class="idx">${idx} · ${esc(label)}&nbsp;</span><br>${esc(title)}&nbsp;${e.attempts?.[0]?.violations?.length?`<span class="bad">· ${esc(e.attempts[0].violations.join(" / "))}</span>`:ok?`<span class="ok">· ${esc(e.status||e.verdict)}</span>`:""}</p><div>${link}&nbsp;<br><code>${e.evaluationHash?esc(short(e.evaluationHash)):""}</code></div></div>`;
}

function render(){
  const shown=filter==="ALL"?entries:entries.filter(e=>classify(e).includes(filter));
  $("#a-ledger").innerHTML=shown.length?shown.map(entryHtml).join(""):`<div class="row muted">No ${filter==="ALL"?"activity yet — run the agent once.":filter.toLowerCase()} activity.</div>`;
}

$$('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render()}));
(async()=>{try{const a=await api.activity();entries=a.entries||[];render()}catch(e){$("#a-ledger").innerHTML=`<div class="row muted">${esc(e.message)}</div>`}})();
