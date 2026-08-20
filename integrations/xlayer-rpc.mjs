export const XLAYER_TESTNET = {
  chainId: 1952,
  rpc: process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon",
  explorer: "https://www.okx.com/web3/explorer/xlayer-test"
};

export async function rpc(method, params = []) {
  const response = await fetch(XLAYER_TESTNET.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(3000)
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body?.error?.message || `X Layer RPC failed with HTTP ${response.status}`);
  return body.result;
}

export async function xlayerStatus() {
  try {
    const [chainIdHex, blockHex] = await Promise.all([rpc("eth_chainId"), rpc("eth_blockNumber")]);
    return { connected: true, chainId: Number.parseInt(chainIdHex, 16), blockNumber: Number.parseInt(blockHex, 16), rpc: XLAYER_TESTNET.rpc };
  } catch (error) {
    return { connected: false, chainId: 1952, error: error instanceof Error ? error.message : String(error), rpc: XLAYER_TESTNET.rpc };
  }
}
