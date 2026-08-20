export const XLAYER_CHAIN_ID = "0x7a0";

export function createWalletCore(options = {}) {
  const getProvider = options.getProvider ?? (() => null);
  const store = options.store ?? null;
  const listeners = new Set();
  const chainListeners = { accountsChanged: null, chainChanged: null };
  const providerRef = { current: null };

  let state = {
    status: "disconnected", // disconnected | restoring | connected | wrong-network
    account: store?.getItem?.("circuit.wallet") ?? null,
    chainId: null,
    balance: null,
    address: store?.getItem?.("circuit.wallet") ?? null,
  };

  // Re-establish the wallet session on page load without prompting:
  // eth_accounts returns the currently authorized accounts when one exists.
  if (state.account) {
    state.status = "restoring";
    queueMicrotask(() => { restore().catch(() => {}); });
  }

  async function restore() {
    const stored = store?.getItem?.("circuit.wallet") ?? state.account;
    if (!stored) { setState({ status: "disconnected" }); return; }
    const provider = getProvider();
    if (!provider) {
      // no extension available: do not claim a connection
      store?.removeItem?.("circuit.wallet");
      setState({ status: "disconnected", account: null, address: null });
      return;
    }
    providerRef.current = provider;
    try {
      const accounts = await provider.request({ method: "eth_accounts" });
      if (!accounts || accounts.length === 0 || !accounts.includes(stored)) {
        store?.removeItem?.("circuit.wallet");
        setState({ status: "disconnected", account: null, address: null });
        return;
      }
      attachListeners(provider);
      const chainId = await provider.request({ method: "eth_chainId" }).catch(() => null);
      setState({ account: stored, address: stored, chainId, status: chainId && chainId !== XLAYER_CHAIN_ID ? "wrong-network" : "connected" });
      await refreshBalance();
    } catch {
      setState({ status: "disconnected", account: null, address: null });
      store?.removeItem?.("circuit.wallet");
    }
  }

  function setState(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) { try { fn(state); } catch {} }
  }

  function attachListeners(provider) {
    if (!provider?.on && !provider?.addListener) return;
    const on = provider.on ? provider.on.bind(provider) : provider.addListener.bind(provider);
    chainListeners.accountsChanged = accounts => {
      if (!accounts || accounts.length === 0) { disconnect({ walletSide: true }); return; }
      if (accounts[0] !== state.account) {
        setState({ account: accounts[0], address: accounts[0], status: "connected" });
        if (store) store.setItem?.("circuit.wallet", accounts[0]);
        refreshBalance().catch(() => {});
      }
    };
    chainListeners.chainChanged = chainId => {
      setState({ chainId, status: chainId === XLAYER_CHAIN_ID ? "connected" : "wrong-network" });
    };
    on("accountsChanged", chainListeners.accountsChanged);
    on("chainChanged", chainListeners.chainChanged);
  }

  function removeListeners(provider) {
    if (!provider) return;
    const off = provider.removeListener ? provider.removeListener.bind(provider) : provider.off ? provider.off.bind(provider) : null;
    if (!off) return;
    if (chainListeners.accountsChanged) { try { off("accountsChanged", chainListeners.accountsChanged); } catch {} chainListeners.accountsChanged = null; }
    if (chainListeners.chainChanged) { try { off("chainChanged", chainListeners.chainChanged); } catch {} chainListeners.chainChanged = null; }
  }

  async function refreshBalance() {
    if (!state.account || !providerRef.current) return;
    try {
      const bal = await providerRef.current.request({ method: "eth_getBalance", params: [state.account, "latest"] });
      setState({ balance: parseInt(bal, 16) / 1e18 });
    } catch {}
  }

  async function connect() {
    const provider = getProvider();
    if (!provider) throw new Error("OKX Wallet not detected. Install the OKX Wallet browser extension.");
    providerRef.current = provider;
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) throw new Error("No account returned by the wallet.");
    attachListeners(provider);
    const chainId = await provider.request({ method: "eth_chainId" }).catch(() => null);
    setState({ account: accounts[0], address: accounts[0], chainId, status: chainId && chainId !== XLAYER_CHAIN_ID ? "wrong-network" : "connected" });
    if (store) store.setItem?.("circuit.wallet", accounts[0]);
    await refreshBalance();
    return state.account;
  }

  async function ensureChain() {
    const provider = providerRef.current;
    if (!provider) throw new Error("Wallet not connected.");
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER_CHAIN_ID }] });
    } catch (e) {
      if (e?.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: XLAYER_CHAIN_ID, chainName: "X Layer Testnet", rpcUrls: ["https://testrpc.xlayer.tech/terigon"], nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, blockExplorerUrls: ["https://www.okx.com/web3/explorer/xlayer-test"] }],
        });
      } else throw e;
    }
    const chainId = await provider.request({ method: "eth_chainId" }).catch(() => state.chainId);
    setState({ chainId, status: chainId === XLAYER_CHAIN_ID ? "connected" : "wrong-network" });
    if (chainId === XLAYER_CHAIN_ID) await refreshBalance();
    return chainId;
  }

  async function disconnect(options = {}) {
    const provider = providerRef.current;
    // 1. Clear app-side connection state first — this is the real disconnect.
    removeListeners(provider);
    providerRef.current = null;
    if (store) store.removeItem?.("circuit.wallet");
    setState({ status: "disconnected", account: null, address: null, chainId: null, balance: null });
    // 2. Best-effort provider-side release, never blocking, never hanging.
    if (provider && typeof provider.request === "function") {
      const released = Promise.race([
        Promise.resolve().then(() => provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] })),
        new Promise(resolve => setTimeout(() => resolve(null), 1500)),
      ]);
      try { await released; } catch {}
    }
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function getState() { return { ...state }; }
  function provider() { return providerRef.current; }

  return { connect, disconnect, ensureChain, refreshBalance, subscribe, getState, provider, attachListeners, removeListeners };
}
