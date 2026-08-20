const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const money=n=>`$${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}`;
const pct=n=>`${Number(n||0).toFixed(1)}%`;
const short=s=>s?`${String(s).slice(0,10)}…${String(s).slice(-8)}`:"—";
const iso=ts=>ts?new Date(ts).toISOString().slice(0,19).replace("T"," "):"—";
const X_EXPLORER="https://www.okx.com/web3/explorer/xlayer-test";
const txLink=h=>h?`<a href="${X_EXPLORER}/tx/${esc(h)}" target="_blank" rel="noopener">${esc(short(h))}</a>`:esc("—");
const addrLink=a=>a&&a!=="0x0000000000000000000000000000000000000000"?`<a href="${X_EXPLORER}/address/${esc(a)}" target="_blank" rel="noopener">${esc(a)}</a>`:esc("—");

async function getJSON(url,init){
  const r=await fetch(url,init);
  const contentType=r.headers.get("content-type")||"";
  if(!contentType.includes("application/json")){
    const detail=(await r.text()).trim().slice(0,180);
    throw new Error(`Expected JSON from ${url}, received ${r.status} ${contentType||"unknown content type"}${detail?`: ${detail}`:""}`);
  }
  const body=await r.json();
  if(!r.ok)throw new Error(body.error||`${r.status} ${r.statusText}`);
  return body;
}
const postJSON=(url,value)=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)});

const cache=new Map();
async function load(key,url,ttl=5000){const c=cache.get(key);if(c&&Date.now()-c.at<ttl)return c.value;const value=await getJSON(url);cache.set(key,{at:Date.now(),value});return value}
const api={
  status:()=>load("status","/api/status",3000),
  vault:()=>load("vault","/api/portfolio/vault",3000),
  network:()=>load("network","/api/proof/network",5000),
  receipts:()=>load("receipts","/api/receipts",3000),
  trace:()=>load("trace","/api/trace",3000),
  activity:()=>load("activity","/api/activity",3000),
  okx:()=>load("okx","/api/okx/context",8000),
  market:()=>load("market","/api/market",15000),
  bootstrap:()=>load("bootstrap","/api/bootstrap",8000),
};
function bust(...keys){for(const k of keys)cache.delete(k)}

// ---------------- wallet (OKX wallet, EIP-1193) ----------------
import { createWalletCore, XLAYER_CHAIN_ID } from "./wallet-core.mjs";

const walletCore = createWalletCore({
  getProvider: () => window.okxwallet || window.ethereum || null,
  store: localStorage,
});
const wallet = {
  core: walletCore,
  get account(){ return walletCore.getState().account; },
  get status(){ return walletCore.getState().status; },
  get wrongNetwork(){ return walletCore.getState().status === "wrong-network"; },
  available(){ return Boolean(window.okxwallet || window.ethereum) },
  async connect(){ return walletCore.connect(); },
  async disconnect(){ await walletCore.disconnect(); },
  async ensureChain(){ await walletCore.ensureChain(); },
  async refresh(){ await walletCore.refreshBalance(); },
  subscribe(fn){ return walletCore.subscribe(fn); },
  async deposit(vaultAddress){
    const state=walletCore.getState();
    if(!state.account) throw new Error("Connect wallet first.");
    const tx=await walletCore.provider().request({method:"eth_sendTransaction",params:[{from:state.account,to:vaultAddress,value:"0x2386f26fc10000"}]});
    return tx;
  },
};

function renderWalletMenu(){
  const menu=$("#wallet-menu"); if(!menu)return;
  const state=walletCore.getState();
  if(state.status==="disconnected"||!state.account){
    menu.innerHTML=`<div class="wallet-menu-head"><span>WALLET</span><b>NOT CONNECTED</b></div>`;
  }else{
    const networkLabel=state.status==="wrong-network"?"WRONG NETWORK":state.status==="restoring"?"VERIFYING…":state.chainId===XLAYER_CHAIN_ID?"X LAYER":"NETWORK "+String(state.chainId);
    menu.innerHTML=`
      <div class="wallet-menu-head"><span>PORTFOLIO OWNER</span><b>${esc(short(state.account))}</b></div>
      <div class="wallet-menu-head"><span>NETWORK</span><b class="${state.status==="wrong-network"?"bad":""}">${esc(networkLabel)}</b></div>
      ${state.status==="wrong-network"?`<button data-wallet-action="switch">SWITCH TO X LAYER</button>`:""}
      <button data-wallet-action="copy">COPY ADDRESS</button>
      <button data-wallet-action="explorer">VIEW ON EXPLORER</button>
      <button data-wallet-action="disconnect">DISCONNECT</button>`;
  }
}

// ---------------- client-side navigation (no full reloads) ----------------
const PAGE_SCRIPTS = {
  "/portfolio": "portfolio.js",
  "/agent": "agent.js",
  "/mandate": "mandate.js",
  "/gate": "gate.js",
  "/activity": "activity.js",
  "/reports": "reports.js",
  "/proof": "proof.js",
};

let navBusy = false;
const pageCleanups = new Set();
export function onPageCleanup(fn){ pageCleanups.add(fn); return () => pageCleanups.delete(fn); }
async function navigateTo(path, { push = true } = {}) {
  if (navBusy) return;
  navBusy = true;
  try {
    const response = await fetch(path, { headers: { accept: "text/html" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nextMain = doc.querySelector("main");
    const currentMain = document.querySelector("main");
    if (!nextMain || !currentMain) throw new Error("page structure missing");
    for (const fn of [...pageCleanups]) { try { fn(); } catch {} }
    pageCleanups.clear();
    document.title = doc.title;
    document.body.className = doc.body.className;
    if (doc.body.dataset.page) document.body.dataset.page = doc.body.dataset.page;
    else delete document.body.dataset.page;
    currentMain.replaceWith(nextMain);
    window.scrollTo(0, 0);
    if (push) history.pushState({ path }, "", path);
    $$(".site-nav a[data-route]").forEach(a => a.classList.toggle("active", a.dataset.route === path));
    const script = PAGE_SCRIPTS[path];
    if (script) {
      await import(`/js/${script}?nav=${Date.now()}`);
    } else if (path === "/") {
      await import(`/js/landing.js?nav=${Date.now()}`);
    }
  } catch (error) {
    window.location.href = path;
  } finally {
    navBusy = false;
  }
}

function wireNavigation() {
  if (document.body.dataset.navWired) return;
  document.body.dataset.navWired = "1";
  document.addEventListener("click", (e) => {
    const anchor = e.target.closest?.("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    if (anchor.target === "_blank" || anchor.getAttribute("download") !== null) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const hash = href.includes("#") ? href.split("#")[1] : null;
    navigateTo(href.split("#")[0]).then(() => {
      if (!hash) return;
      let attempts = 0;
      const tryScroll = () => {
        const el = document.querySelector(`#${CSS.escape(hash)}`) ?? document.querySelector(`#${CSS.escape(hash.replace(/^trace-.*/, "trace"))}`);
        if (el) { el.scrollIntoView({ block: "start" }); return; }
        if (attempts++ < 8) setTimeout(tryScroll, 350);
      };
      tryScroll();
    });
  });
  window.addEventListener("popstate", () => navigateTo(location.pathname, { push: false }));
}

// ---------------- site header (institutional rail) ----------------
const NAV=[["/portfolio","PORTFOLIO"],["/agent","AGENT"],["/mandate","MANDATE"],["/gate","GATE"],["/activity","ACTIVITY"],["/reports","REPORTS"],["/proof","PROOF"]];
function mountNav(){
  if($("#site-header"))return;
  const header=document.createElement("header");header.id="site-header";header.className="site-header";
  header.innerHTML=`<div class="site-nav"><a class="nav-logo" href="/">CIRCUIT <span>/ 07</span></a><nav>${NAV.map(([href,label],i)=>`<a href="${href}" data-route="${href}" class="${location.pathname===href?"active":""}"><i>/0${i+1}</i> ${label}</a>`).join("")}</nav><div class="nav-wallet" id="nav-wallet" tabindex="0"><span id="nav-wallet-label">WALLET</span> · X LAYER<div class="wallet-menu" id="wallet-menu" hidden></div></div></div>`;
  document.body.prepend(header);
  const navWallet=$("#nav-wallet");
  const label=$("#nav-wallet-label");
  const menu=$("#wallet-menu");
  let open=false;
  function paint(){
    const state=walletCore.getState();
    label.textContent=state.status==="disconnected"||!state.account?"WALLET":short(state.account);
    renderWalletMenu();
  }
  navWallet.addEventListener("click",async(e)=>{
    const action=e.target?.dataset?.walletAction;
    const state=walletCore.getState();
    if(action==="copy"){await navigator.clipboard?.writeText(state.account);return}
    if(action==="explorer"){window.open(`${X_EXPLORER}/address/${state.account}`,"_blank");return}
    if(action==="disconnect"){await wallet.disconnect();open=false;menu.hidden=true;return}
    if(action==="switch"){
      try{
        label.textContent="SWITCHING…";
        await wallet.ensureChain();
      }catch(err){
        label.textContent="SWITCH REJECTED";
        setTimeout(()=>label.textContent=walletCore.getState().status==="disconnected"||!walletCore.getState().account?"WALLET":short(walletCore.getState().account),2500);
      }
      return;
    }
    if(state.status==="disconnected"){try{await wallet.connect();}catch(err){alert(err.message)}}
    open=!open;menu.hidden=!open;
  });
  document.addEventListener("click",e=>{if(!navWallet.contains(e.target)){open=false;menu.hidden=true}});
  walletCore.subscribe(paint);
  paint();
  wireNavigation();
}
// ---------------- provider strip ----------------
async function providerStrip(containerId){
  const el=$(containerId); if(!el)return;
  el.innerHTML=`<div><span>/01 AI</span><b data-p="ai">CHECKING</b></div><div><span>/02 OKX</span><b data-p="okx">CHECKING</b></div><div><span>/03 X LAYER</span><b data-p="xlayer">CHECKING</b></div><div><span>/04 VAULT</span><b data-p="vault">CHECKING</b></div><div><span>/05 MCP</span><b data-p="mcp">CHECKING</b></div>`;
  const set=(k,v)=>{const b=el.querySelector(`[data-p="${k}"]`);if(b)b.textContent=v};
  try{
    const [s,v]=await Promise.all([api.status(),api.vault()]);
    set("ai",s.ai?.configured?`LIVE · ${s.ai.model}`:"AI UNAVAILABLE");
    set("okx",s.okx?.configured?`OKX ${s.okx.state}`:"MISCONFIGURED");
    set("xlayer",s.xlayer?.connected?`LIVE #${s.xlayer.blockNumber}`:"RPC OFFLINE");
    set("vault",!v.ok?"UNAVAILABLE":v.paused?"PAUSED":v.funded?"FUNDED":"DEPLOYED");
    set("mcp",s.mcp?.healthy?"LIVE":"OFFLINE");
  }catch{
    for(const key of ["ai","okx","xlayer","vault","mcp"])set(key,"UNAVAILABLE");
  }
}

// ---------------- empty state ----------------
function empty(el,title,body){el.className=el.className.replace(/\bempty-state\b/,"")+" empty-state";el.innerHTML=`<strong>${esc(title)}</strong><p>${esc(body)}</p>`}

export {$ ,$$, esc, money, pct, short, iso, txLink, addrLink, api, getJSON, postJSON, wallet, XLAYER_CHAIN_ID, mountNav, providerStrip, empty, bust};
