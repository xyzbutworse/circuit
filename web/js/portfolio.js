import { $, $$, esc, money, pct, short, api, mountNav, wallet, empty } from "./shared.js";

mountNav();

// ---------------- instrument market (real OKX candles) ----------------
const RANGES=["1H","4H","1D","1W","1M"];
const market={asset:"tslax",range:"1D",loading:false};
const MARKET_TIMEOUT_MS=15000;

function marketUnavailable(detail){
  $("#market-body").innerHTML=`<div class="alert">MARKET HISTORY UNAVAILABLE</div><div class="row muted">${esc(detail)} No synthetic data is shown.</div>`;
}

function chartSvg(candles){
  const W=760,H=220,pad={l:44,r:12,t:14,b:26};
  const closes=candles.map(c=>c.close);
  const min=Math.min(...closes),max=Math.max(...closes);
  const span=max-min||1;
  const n=closes.length;
  const x=i=>pad.l+(W-pad.l-pad.r)*(i/(n-1||1));
  const y=v=>pad.t+(H-pad.t-pad.b)*(1-(v-min)/span);
  const pts=closes.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area=`M${x(0).toFixed(1)},${(H-pad.b)} L${pts.replace(/ /g," L")} L${x(n-1).toFixed(1)},${(H-pad.b)} Z`;
  const yTicks=[max,(max+min)/2,min].map(v=>`<text class="axis" x="${pad.l-8}" y="${y(v)+3}" text-anchor="end">$${v.toFixed(2)}</text>`).join("");
  const xTicks=[0,Math.floor((n-1)/2),n-1].map(i=>`<text class="axis" x="${x(i)}" y="${H-6}" text-anchor="middle">${new Date(candles[i].timestampMs).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="price chart"><path class="area" d="${area}"/><polyline class="line" points="${pts}"/>${yTicks}${xTicks}</svg>`;
}

async function loadMarket(){
  if(market.loading)return;
  const body=$("#market-body");
  try{
    const {assets}=await api.market();
    $("#market-tabs").innerHTML=assets.map(a=>`<button data-asset="${esc(a.asset)}" class="${a.asset===market.asset?"active":""}">${esc(a.symbol)}</button>`).join("");
    $("#market-ranges").innerHTML=RANGES.map(r=>`<button data-range="${r}" class="${r===market.range?"active":""}">${r}</button>`).join("");
    await loadCandles();
  }catch(e){body.innerHTML=`<div class="row muted">${esc(e.message)}</div>`}
}

async function loadCandles(){
  const body=$("#market-body");
  body.innerHTML=`<div class="row muted">LOADING MARKET HISTORY…</div>`;
  market.loading=true;
  try{
    const r=await fetch(`/api/market/${market.asset}/candles?range=${market.range}`,{signal:AbortSignal.timeout(MARKET_TIMEOUT_MS)});
    const data=await r.json();
    if(!r.ok||data.unavailable&&!data.candles?.length){
      body.innerHTML=`<div class="alert">MARKET HISTORY UNAVAILABLE</div><div class="row muted">OKX returned no candle history for ${esc(data.symbol||market.asset)} on ${esc(data.chainLabel||"this chain")}. No synthetic data is shown.</div>`;
      return;
    }
    if(data.unavailable){ body.innerHTML=`<div class="alert">MARKET HISTORY UNAVAILABLE</div>`; return; }
    const candles=data.candles||[];
    const last=candles.at(-1);
    const first=candles[0];
    const change=first&&last?((last.close-first.close)/first.close)*100:0;
    const v=await api.vault();
    const nav=v.ok?(v.mandate?.navUsd||1):1;
    const pos=v.ok?(v.positions?.[market.asset]||0):0;
    const limit=v.ok?(market.asset==="tslax"?(v.mandate?.maxIssuerExposureBps??3500)/100*nav/100*100:(v.mandate?.maxSectorExposureBps??5000)/100*nav/100*100):0;
    const exposure=pos/nav*100;
    const limitPct=market.asset==="tslax"?(v.mandate?.maxIssuerExposureBps??3500)/100:(v.mandate?.maxSectorExposureBps??5000)/100;
    const headroom=Math.max(0,limitPct-exposure);
    const updated=data.updatedAt?new Date(data.updatedAt).toLocaleTimeString("en-GB",{hour12:false}):"—";
    body.innerHTML=`
      <div class="market-grid">
        <div class="market-chart">
          <div class="stat"><b>$${Number(last?.close||0).toFixed(2)}</b><span>${esc(data.symbol)} / ${esc(data.issuer)}</span><em class="${change>=0?"ok":"bad"}">${change>=0?"+":""}${change.toFixed(2)}% · ${esc(data.range)}</em></div>
          ${candles.length?chartSvg(candles):""}
        </div>
        <div class="market-side">
          <div class="side-label">MARKET</div>
          <div class="row"><span>PRICE</span><b>$${Number(last?.close||0).toFixed(2)}</b></div>
          <div class="row"><span>24H CHANGE</span><b class="${change>=0?"ok":"bad"}">${change>=0?"+":""}${change.toFixed(2)}%</b></div>
          <div class="row"><span>VOLUME (${esc(data.range)})</span><b>${money(candles.reduce((s,c)=>s+c.volumeUsd,0))}</b></div>
          <div class="side-label" style="margin-top:18px">PORTFOLIO</div>
          <div class="row"><span>EXPOSURE</span><b>${pct(exposure)}</b></div>
          <div class="row"><span>LIMIT</span><b>${pct(limitPct)}</b></div>
          <div class="row"><span>HEADROOM</span><b class="${headroom>0?"ok":"bad"}">${pct(headroom)}</b></div>
        </div>
      </div>
      <div class="market-provenance">
        <span>OKX ONCHAIN OS</span><span>${esc(data.chainLabel)} · CHAIN ${data.chainIndex}</span><span>BAR ${esc(data.bar)}</span><span>UPDATED ${esc(updated)}</span>
      </div>
      <div class="market-note">MARKET DATA · X LAYER MAINNET — EXECUTION · X LAYER TESTNET. Market data is for reference; it never substitutes Circuit's mandate evaluation.</div>`;
  }catch(e){
    const detail=e?.name==="TimeoutError"?"The OKX candle request exceeded 15 seconds.":`The OKX candle request failed: ${e?.message||"unknown error"}.`;
    marketUnavailable(detail);
  }
  finally{market.loading=false}
}

$("#market-tabs").addEventListener("click",e=>{const a=e.target?.dataset?.asset;if(!a)return;market.asset=a;$$("#market-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.asset===a));loadCandles()});
$("#market-ranges").addEventListener("click",e=>{const r=e.target?.dataset?.range;if(!r)return;market.range=r;$$("#market-ranges button").forEach(b=>b.classList.toggle("active",b.dataset.range===r));loadCandles()});

// ---------------- portfolio ----------------
async function render(){
  const alert=$("#portfolio-alert"); alert.hidden=true;
  try{const v=await api.vault();
    if(!v.ok){alert.hidden=false;alert.textContent=`VAULT UNAVAILABLE — ${v.detail||""}`;return}
    $("#portfolio-status-chip").textContent=v.paused?"PAUSED":v.seeded&&v.mandate?.enabled?"COMPLIANT":v.seeded?"MANDATE INACTIVE":"UNSEEDED";
    $("#p-owner").textContent=v.owner; $("#p-network").textContent=`X LAYER · ${v.network?.chainId}`;
    $("#p-vault").textContent=v.addresses?.vault;
    $("#p-mandate").textContent=v.mandate?.exists?`VERSION ${String(v.mandate.version).padStart(2,"0")} · ${v.mandate.mandateHash.slice(0,10)}…`:"NONE";
    $("#p-status").textContent=v.paused?"PAUSED":"ACTIVE";
    $("#p-nav").textContent=money(v.mandate?.navUsd); $("#p-cash").textContent=money(v.cashUsd);
    $("#p-invested").textContent=money(v.investedUsd); $("#p-turnover").textContent=money(v.dailyTurnoverUsd);
    $("#p-statehash").textContent=short(v.portfolioStateHash); $("#p-statehash").title=v.portfolioStateHash;
    $("#p-version").textContent=v.portfolioVersion??"—"; $("#p-funded").textContent=v.funded?"YES":"NO";

    const nav=v.mandate?.navUsd||1;
    const assets={tslax:["TESLA INC.","TOKENIZED EQUITY"],googlx:["ALPHABET INC.","TOKENIZED EQUITY"],mstrx:["STRATEGY INC.","TOKENIZED EQUITY"]};
    const positions=Object.entries(v.positions||{}).filter(([,n])=>n>0);
    $("#p-positions").innerHTML=positions.length?positions.map(([a,n],i)=>`<div class="row"><span><b class="muted">/0${i+1}</b> · ${esc(a.toUpperCase())} · ${esc((assets[a]||[a,""])[0])} · ${esc((assets[a]||["",""])[1])}&nbsp;</span><b>${money(n)}</b><span class="muted">&nbsp;${pct(n/nav*100)}</span></div>`).join(""):`<div class="row muted">No positions onchain yet.</div>`;

    const bars=[
      ...Object.entries(v.issuerExposures||{}).map(([name,n])=>({label:`ISSUER · ${name.toUpperCase()}`,value:n,limit:nav*0.35,limitLabel:"35 LIMIT"})),
      ...Object.entries(v.sectorExposures||{}).map(([name,n])=>({label:`SECTOR · ${name.toUpperCase()}`,value:n,limit:nav*0.50,limitLabel:"50 LIMIT"})),
      {label:"INVESTED CAPITAL",value:v.investedUsd,limit:nav*0.95,limitLabel:"95 LIMIT"},
      {label:"DAILY TURNOVER",value:v.dailyTurnoverUsd,limit:nav*0.70,limitLabel:"70 LIMIT"},
    ];
    $("#p-exposure").innerHTML=bars.map(b=>{
      const ratio=Math.min(100,b.value/Math.max(b.limit,1)*100);
      const over=b.value>b.limit;
      return `<div class="exposure-row"><div class="exposure-head"><span>${esc(b.label)}</span><b class="${over?"bad":""}">${pct(b.value/nav*100)}</b></div><div class="exposure-bar"><i class="${over?"warn":""}" style="width:${ratio}%"></i><i class="limit-marker" style="left:100%"></i></div><div class="exposure-limit">${esc(b.limitLabel)}</div></div>`;
    }).join("");
  }catch(e){alert.hidden=false;alert.textContent=e.message}
}
render();
loadMarket();
