import { $, esc, money, pct, short, iso, api, mountNav } from "./shared.js";

mountNav();

function clauseRow(group,label,current,limit,unit){
  const c=unit==="pct"?pct(current):money(current);
  const l=unit==="pct"?pct(limit):money(limit);
  const passed=current<=limit;
  const state=group.startsWith("MARKET")||group.startsWith("EXECUTION")?"INFO":passed?"PASS":"FAIL";
  return `<div class="compliance-row"><span>${esc(group)}&nbsp;</span><span>${esc(label)}&nbsp;</span><span>${c}&nbsp;</span><span>${l}&nbsp;</span><b class="${state==="PASS"?"ok":state==="FAIL"?"bad":"muted"}">${state}</b></div>`;
}

async function render(){
  try{
    const v=await api.vault();
    if(!v.ok){$("#mandate-status-chip").textContent="UNAVAILABLE";$("#m-compliance").innerHTML=`<div class="row muted">Vault unavailable — ${esc(v.detail||"")}</div>`;return}
    const m=v.mandate;
    $("#mandate-status-chip").textContent=m?.enabled?(v.paused?"PAUSED":"ACTIVE"):"INACTIVE";
    $("#m-id").textContent=v.portfolioId; $("#m-version").textContent=`V${String(m?.version??0).padStart(2,"0")}`;
    $("#m-hash").textContent=short(m?.mandateHash);$("#m-hash").title=m?.mandateHash;
    $("#m-activated").textContent=v.seeded?"ACTIVATED (SEEDED ONCHAIN)":"NOT ACTIVATED";
    $("#m-status").textContent=m?.exists?`${m.enabled?"ENABLED":"DISABLED"} · VALID TO ${iso(new Date(Number(m.validUntil)*1000))}`:"NO MANDATE";
    $("#m-nav").textContent=money(m?.navUsd);
    const universe=Object.keys(v.positions||{}).map(a=>a.toUpperCase());
    $("#m-universe").textContent=universe.join(" · ")||"—";
    $("#cl-eligible").innerHTML=universe.map(a=>`<span>${esc(a)}</span>`).join("");
    $("#cl-issuer").textContent=`${(m?.maxIssuerExposureBps??3500)/100}% NAV`;
    $("#cl-sector").textContent=`${(m?.maxSectorExposureBps??5000)/100}% NAV`;
    $("#cl-turnover").textContent=`${(m?.maxDailyTurnoverBps??7000)/100}% NAV`;
    $("#cl-freshness").textContent=`${Math.round((m?.maxReferenceFreshnessSeconds??1800)/60)} MIN`;
    $("#cl-exec").textContent="WHITELISTED ROUTER";

    const nav=m?.navUsd||1;
    const head=`<div class="compliance-row compliance-head"><span>RULE GROUP&nbsp;</span><span>RULE&nbsp;</span><span>CURRENT&nbsp;</span><span>LIMIT&nbsp;</span><span>STATE</span></div>`;
    const rows=[];
    for(const [name,n] of Object.entries(v.issuerExposures||{}))rows.push(clauseRow("ISSUER CONCENTRATION",`${name} exposure`,n/nav*100,(m?.maxIssuerExposureBps??3500)/100,"pct"));
    for(const [name,n] of Object.entries(v.sectorExposures||{}))rows.push(clauseRow("SECTOR CONCENTRATION",`${name} exposure`,n/nav*100,(m?.maxSectorExposureBps??5000)/100,"pct"));
    rows.push(clauseRow("PORTFOLIO EXPOSURE","Invested capital / NAV",v.investedUsd/nav*100,(m?.maxInvestedBps??9500)/100,"pct"));
    rows.push(clauseRow("TURNOVER","Daily turnover / NAV",v.dailyTurnoverUsd/nav*100,(m?.maxDailyTurnoverBps??7000)/100,"pct"));
    rows.push(clauseRow("MARKET / REFERENCE","Expected slippage",0,m?.maxSlippageBps??100,"num"));
    rows.push(clauseRow("MARKET / REFERENCE","Reference freshness",0,m?.maxReferenceFreshnessSeconds??1800,"num"));
    rows.push(clauseRow("MARKET / REFERENCE","Closed-market new-buy cap",0,Number(m?.closedMarketMaxBuyUsdE18??1e21)/1e18,"money"));
    rows.push(clauseRow("MARKET / REFERENCE","Material-event new-buy cap",0,Number(m?.materialEventMaxBuyUsdE18??5e20)/1e18,"money"));
    rows.push(clauseRow("EXECUTION CONSTRAINTS","Whitelisted OKX router only",0,0,"num"));
    rows.push(clauseRow("ASSET ELIGIBILITY",`${Object.keys(v.positions||{}).map(a=>a.toUpperCase()).join(" · ")}`,0,0,"num"));
    $("#m-compliance").innerHTML=`<div class="compliance-table">${head}${rows.join("")}</div>`;

    const activity=await api.activity();
    const history=(activity.entries||[]).filter(e=>e.kind==="trace"||e.kind==="authorization").slice(0,6);
    $("#m-history").innerHTML=history.length?history.map(e=>`<div class="row"><span>${iso(e.ts)} · ${esc(e.kind.toUpperCase())}&nbsp;</span><b>${esc(e.status||e.verdict||"")}</b><span class="muted">&nbsp;${e.evaluationHash?esc(short(e.evaluationHash)):""}</span></div>`).join(""):`<div class="row muted">No mandate-related history yet.</div>`;
  }catch(e){$("#m-compliance").innerHTML=`<div class="row muted">${esc(e.message)}</div>`}
}
render();
