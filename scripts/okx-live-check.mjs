import { fetchOkxMarketContext, marketContextForAgent, buildLiveMarket, okxConfigured, OKX_BASE_URL } from "../dist/integrations/okx.js";

const assetIds = ["tslax", "googlx", "mstrx"];
console.log(`OKX Onchain OS → ${OKX_BASE_URL}`);
if (!okxConfigured()) {
  console.error("MISCONFIGURED: set OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE first. Fixture data is never substituted for live market data.");
  process.exit(1);
}
const result = await fetchOkxMarketContext(assetIds);
console.log(`state=${result.state} fetchedAt=${new Date(result.fetchedAt).toISOString()}${result.paymentRequired ? " paymentRequired=true" : ""}`);
for (const [assetId, entry] of Object.entries(result.entries)) {
  const c = entry.context;
  console.log(`  ${assetId}: ${entry.state}${entry.stateCode ? ` (${entry.stateCode})` : ""}${c ? ` price=${c.price ?? "-"} chain=${c.chainId} age=${c.referenceAgeSeconds}s slippage=${c.expectedSlippageBps ?? "-"}bps liquidity=${c.liquidity ?? "-"} ref=${c.rawReferenceId}` : ""}`);
}
if (result.state !== "LIVE") process.exit(1);
console.log("Normalized context for the AI planner:");
console.log(JSON.stringify(marketContextForAgent(result), null, 2));
console.log("Circuit market (post-normalization):");
console.log(JSON.stringify(buildLiveMarket(result, []).map(a => ({ assetId: a.assetId, priceUsd: a.priceUsd, freshnessMinutes: a.referenceFreshnessMinutes, source: a.source })), null, 2));
