import test from "node:test";
import assert from "node:assert/strict";
import { createWalletCore, XLAYER_CHAIN_ID } from "../web/js/wallet-core.mjs";

function fakeProvider(overrides = {}) {
  const listeners = {};
  const provider = {
    accounts: overrides.accounts ?? ["0xAbC0000000000000000000000000000000000abc"],
    chainId: overrides.chainId ?? XLAYER_CHAIN_ID,
    balance: overrides.balance ?? "0xde0b6b3a7640000", // 1e18
    revoked: false,
    requestCalls: [],
    async request({ method, params }) {
      this.requestCalls.push(method);
      if (method === "eth_requestAccounts") return this.accounts;
      if (method === "eth_accounts") return this.accounts;
      if (method === "eth_chainId") return this.chainId;
      if (method === "eth_getBalance") return this.balance;
      if (method === "wallet_revokePermissions") { this.revoked = true; return null; }
      if (method === "wallet_switchEthereumChain") { this.chainId = XLAYER_CHAIN_ID; return null; }
      if (method === "wallet_addEthereumChain") { this.chainId = XLAYER_CHAIN_ID; return null; }
      return overrides[method] ? overrides[method](params) : null;
    },
    on(event, fn) { (listeners[event] ??= []).push(fn); },
    removeListener(event, fn) { listeners[event] = (listeners[event] ?? []).filter(f => f !== fn); },
    emit(event, ...args) { for (const fn of listeners[event] ?? []) fn(...args); },
  };
  return provider;
}

test("connect → connected state with account and balance", async () => {
  const provider = fakeProvider();
  const core = createWalletCore({ getProvider: () => provider, store: null });
  const account = await core.connect();
  assert.equal(account, provider.accounts[0]);
  assert.equal(core.getState().status, "connected");
  assert.equal(core.getState().account, provider.accounts[0]);
  assert.equal(core.getState().balance, 1);
});

test("disconnect releases the connector, removes listeners and clears state", async () => {
  const provider = fakeProvider();
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  await core.disconnect();
  assert.equal(provider.revoked, true, "wallet_revokePermissions must be attempted");
  const state = core.getState();
  assert.equal(state.status, "disconnected");
  assert.equal(state.account, null);
  assert.equal(state.balance, null);
  assert.equal(core.provider(), null);
  // listeners removed: emitting accountsChanged after disconnect must not re-connect anything
  provider.emit("accountsChanged", [provider.accounts[0]]);
  assert.equal(core.getState().status, "disconnected");
});

test("wallet-side disconnect (empty accountsChanged) becomes a disconnect event", async () => {
  const provider = fakeProvider();
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  const events = [];
  core.subscribe(s => events.push(s.status));
  provider.emit("accountsChanged", []);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(core.getState().status, "disconnected");
  assert.equal(core.getState().account, null);
  assert.deepEqual(events, ["disconnected"]);
});

test("account switch updates state to the new account", async () => {
  const provider = fakeProvider();
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  provider.emit("accountsChanged", ["0xDeF000000000000000000000000000000000def"]);
  assert.equal(core.getState().account, "0xDeF000000000000000000000000000000000def");
  assert.equal(core.getState().status, "connected");
});

test("wrong network is detected via chainChanged and after connect", async () => {
  const provider = fakeProvider({ chainId: "0x1" });
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  assert.equal(core.getState().status, "wrong-network");
  provider.emit("chainChanged", XLAYER_CHAIN_ID);
  assert.equal(core.getState().status, "connected");
});

test("disconnect completes even when the provider never answers revokePermissions", async () => {
  const provider = fakeProvider();
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  // simulate a provider that hangs on revoke (never resolves, never rejects)
  provider.request = async (args) => {
    if (args.method === "wallet_revokePermissions") return new Promise(() => {});
    return null;
  };
  const t0 = Date.now();
  await core.disconnect();
  assert.ok(Date.now() - t0 < 3000, "disconnect must not hang on the provider");
  assert.equal(core.getState().status, "disconnected");
  assert.equal(core.getState().account, null);
});

test("disconnect completes even when the provider throws on revokePermissions", async () => {
  const provider = fakeProvider();
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  provider.request = async (args) => {
    if (args.method === "wallet_revokePermissions") throw new Error("provider rejected");
    return null;
  };
  await core.disconnect();
  assert.equal(core.getState().status, "disconnected");
});

test("disconnect clears state even with a provider that lacks request", async () => {
  const provider = fakeProvider();
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  provider.request = undefined;
  await core.disconnect();
  assert.equal(core.getState().status, "disconnected");
});

test("page reload restores the wallet session silently via eth_accounts", async () => {
  const provider = fakeProvider();
  const store = { map:new Map([["circuit.wallet", provider.accounts[0]]]), getItem(k){return this.map.get(k)??null}, setItem(k,v){this.map.set(k,v)}, removeItem(k){this.map.delete(k)} };
  const core = createWalletCore({ getProvider: () => provider, store });
  assert.equal(core.getState().status, "restoring");
  assert.equal(core.getState().account, provider.accounts[0]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(core.getState().status, "connected");
  assert.equal(core.getState().account, provider.accounts[0]);
  assert.equal(core.getState().balance, 1);
});

test("reload restore clears state when the wallet no longer authorizes the account", async () => {
  const provider = fakeProvider();
  provider.accounts = [];
  const store = { map:new Map([["circuit.wallet", "0xAbC0000000000000000000000000000000000abc"]]), getItem(k){return this.map.get(k)??null}, setItem(k,v){this.map.set(k,v)}, removeItem(k){this.map.delete(k)} };
  const core = createWalletCore({ getProvider: () => provider, store });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(core.getState().status, "disconnected");
  assert.equal(core.getState().account, null);
  assert.equal(store.getItem("circuit.wallet"), null);
});

test("reload restore without a wallet extension drops to disconnected", async () => {
  const store = { map:new Map([["circuit.wallet", "0xAbC0000000000000000000000000000000000abc"]]), getItem(k){return this.map.get(k)??null}, setItem(k,v){this.map.set(k,v)}, removeItem(k){this.map.delete(k)} };
  const core = createWalletCore({ getProvider: () => null, store });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(core.getState().status, "disconnected");
  assert.equal(store.getItem("circuit.wallet"), null);
});

test("reconnect after disconnect restores a clean session (portfolio loads from server state)", async () => {
  const provider = fakeProvider();
  const store = { map:new Map(), getItem(k){return this.map.get(k)??null}, setItem(k,v){this.map.set(k,v)}, removeItem(k){this.map.delete(k)} };
  const core = createWalletCore({ getProvider: () => provider, store });
  await core.connect();
  assert.equal(store.getItem("circuit.wallet"), provider.accounts[0]);
  await core.disconnect();
  assert.equal(store.getItem("circuit.wallet"), null);
  const account = await core.connect();
  assert.equal(account, provider.accounts[0]);
  assert.equal(core.getState().status, "connected");
  // no onchain state was touched by the wallet layer (it only talks EIP-1193)
  assert.deepEqual(provider.requestCalls.filter(m => m.includes("send")), []);
});

test("ensureChain switches to X Layer when on the wrong network", async () => {
  const provider = fakeProvider({ chainId: "0x1" });
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  assert.equal(core.getState().status, "wrong-network");
  const chainId = await core.ensureChain();
  assert.equal(chainId, XLAYER_CHAIN_ID);
  assert.equal(core.getState().status, "connected");
  assert.ok(provider.requestCalls.includes("wallet_switchEthereumChain"));
});

test("ensureChain adds X Layer when the wallet does not know it (4902)", async () => {
  const provider = fakeProvider({ chainId: "0x1" });
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  let switchCalls = 0;
  const originalRequest = provider.request.bind(provider);
  provider.request = async (args) => {
    if (args.method === "wallet_switchEthereumChain") {
      switchCalls += 1;
      if (switchCalls === 1) { const err = new Error("unrecognized chain"); err.code = 4902; throw err; }
      provider.chainId = XLAYER_CHAIN_ID;
      return null;
    }
    return originalRequest(args);
  };
  const chainId = await core.ensureChain();
  assert.equal(chainId, XLAYER_CHAIN_ID);
  assert.equal(core.getState().status, "connected");
  assert.ok(provider.requestCalls.includes("wallet_addEthereumChain"));
});

test("ensureChain surfaces user rejection (4001) without changing state", async () => {
  const provider = fakeProvider({ chainId: "0x1" });
  const core = createWalletCore({ getProvider: () => provider, store: null });
  await core.connect();
  const originalRequest = provider.request.bind(provider);
  provider.request = async (args) => {
    if (args.method === "wallet_switchEthereumChain") { const err = new Error("user rejected"); err.code = 4001; throw err; }
    return originalRequest(args);
  };
  await assert.rejects(() => core.ensureChain(), /user rejected/);
  assert.equal(core.getState().status, "wrong-network");
});
