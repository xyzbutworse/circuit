import type { AgentPlan, MarketAsset, PortfolioMandate, PortfolioState } from "./types.js";

const observedAt = "2026-08-14T18:25:00.000Z";

export const demoMarket: MarketAsset[] = [
  { assetId:"tslax", symbol:"TSLAx", name:"Tesla xStock", issuerId:"tesla", issuerName:"Tesla, Inc.", sectorId:"automotive", sectorName:"Automotive", category:"tokenized-equity", priceUsd:339.85, change24hPct:1.59, liquidityUsd:1_840_000, referenceFreshnessMinutes:4, marketSession:"open", materialEvent:false, source:"fixture", observedAt },
  { assetId:"googlx", symbol:"GOOGLx", name:"Alphabet xStock", issuerId:"alphabet", issuerName:"Alphabet Inc.", sectorId:"technology", sectorName:"Technology", category:"tokenized-equity", priceUsd:345.15, change24hPct:-0.23, liquidityUsd:1_320_000, referenceFreshnessMinutes:3, marketSession:"open", materialEvent:false, source:"fixture", observedAt },
  { assetId:"mstrx", symbol:"MSTRx", name:"Strategy xStock", issuerId:"strategy", issuerName:"Strategy Inc.", sectorId:"technology", sectorName:"Technology", category:"tokenized-equity", priceUsd:94.07, change24hPct:-1.34, liquidityUsd:910_000, referenceFreshnessMinutes:5, marketSession:"open", materialEvent:false, source:"fixture", observedAt },
];

export const demoMandate: PortfolioMandate = {
  id:"mandate-rwa-alpha-01",
  name:"RWA ALPHA / CONTROLLED",
  objective:"Deploy up to $4,500 of available cash into tokenized US equities. Favor TSLAx, then diversify across GOOGLx and MSTRx.",
  navUsd:10_000,
  allowedAssetClasses:["tokenized-equity"],
  allowedAssetIds:["tslax","googlx","mstrx"],
  maxAssetExposurePctNav:45,
  maxIssuerExposurePctNav:35,
  maxSectorExposurePctNav:50,
  maxInvestedPctNav:95,
  maxDailyTurnoverPctNav:70,
  maxSlippageBps:100,
  maxReferenceFreshnessMinutes:30,
  closedMarketMaxBuyUsd:1_000,
  materialEventMaxBuyUsd:500,
  createdAt:"2026-08-14T18:20:00.000Z",
};

export const demoPortfolio: PortfolioState = {
  id:"portfolio-agent-01",
  mandateId:demoMandate.id,
  navUsd:10_000,
  cashUsd:6_500,
  holdings:[
    {assetId:"tslax",notionalUsd:1_500},
    {assetId:"googlx",notionalUsd:1_500},
    {assetId:"mstrx",notionalUsd:500},
  ],
  dailyTurnoverUsd:500,
  asOf:"2026-08-14T18:25:00.000Z",
};

export const violatingPlan: AgentPlan = {
  id:"plan-001",
  mandateId:demoMandate.id,
  intents:[
    { id:"intent-001-a", assetId:"tslax", symbol:"TSLAx", side:"BUY", notionalUsd:2_500, expectedSlippageBps:42, rationale:"Highest-conviction allocation in the requested basket." },
    { id:"intent-001-b", assetId:"googlx", symbol:"GOOGLx", side:"BUY", notionalUsd:1_500, expectedSlippageBps:31, rationale:"Adds liquid AI platform exposure." },
    { id:"intent-001-c", assetId:"mstrx", symbol:"MSTRx", side:"BUY", notionalUsd:500, expectedSlippageBps:46, rationale:"Completes the target deployment with crypto-linked beta." },
  ],
  thesis:"Deploy the full target while leaning into TSLAx and maintaining a diversified technology basket.",
  allocationRationale:"Full $4,500 deployment favors TSLAx per the objective, with GOOGLx and MSTRx rounding out the basket.",
  expectedAllocation:{ cashUsd:2_000, holdings:[
    { assetId:"tslax", symbol:"TSLAx", notionalUsd:4_000, pctNav:40 },
    { assetId:"googlx", symbol:"GOOGLx", notionalUsd:3_000, pctNav:30 },
    { assetId:"mstrx", symbol:"MSTRx", notionalUsd:1_000, pctNav:10 },
  ]},
  assumptions:["References remain fresh during execution.","Slippage stays within the fixture estimates."],
  objective:demoMandate.objective,
  provider:"fixture",
  generatedAt:"2026-08-14T18:26:04.000Z",
};

export const repairedPlan: AgentPlan = {
  id:"plan-002",
  mandateId:demoMandate.id,
  intents:[
    { id:"intent-002-a", assetId:"tslax", symbol:"TSLAx", side:"BUY", notionalUsd:1_500, expectedSlippageBps:39, rationale:"Reduced TSLAx so resulting issuer exposure remains inside the mandate." },
    { id:"intent-002-b", assetId:"googlx", symbol:"GOOGLx", side:"BUY", notionalUsd:1_500, expectedSlippageBps:30, rationale:"Maintains diversified AI platform exposure." },
    { id:"intent-002-c", assetId:"mstrx", symbol:"MSTRx", side:"BUY", notionalUsd:1_500, expectedSlippageBps:44, rationale:"Redistributes capital without breaching issuer or sector concentration." },
  ],
  thesis:"Replanned around Circuit's post-trade exposure feedback while preserving the original $4,500 deployment target.",
  allocationRationale:"Reshaped around Circuit's structured rejection: TSLAx trimmed so Tesla issuer exposure stays under the mandate ceiling, remainder redistributed to GOOGLx and MSTRx.",
  expectedAllocation:{ cashUsd:2_000, holdings:[
    { assetId:"tslax", symbol:"TSLAx", notionalUsd:3_000, pctNav:30 },
    { assetId:"googlx", symbol:"GOOGLx", notionalUsd:3_000, pctNav:30 },
    { assetId:"mstrx", symbol:"MSTRx", notionalUsd:2_000, pctNav:20 },
  ]},
  assumptions:["Circuit's projected post-trade exposure is authoritative.","Objective preserved: full $4,500 deployment."],
  objective:demoMandate.objective,
  provider:"fixture",
  generatedAt:"2026-08-14T18:26:08.000Z",
  revisionOf:"plan-001",
};
