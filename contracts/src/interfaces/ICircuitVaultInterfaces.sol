// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CircuitTypes } from "../CircuitTypes.sol";

interface ICircuitMandateRegistry {
    struct Mandate {
        bytes32 mandateHash;
        uint64 version;
        uint64 validUntil;
        uint128 navUsdE18;
        uint16 maxAssetExposureBps;
        uint16 maxIssuerExposureBps;
        uint16 maxSectorExposureBps;
        uint16 maxInvestedBps;
        uint16 maxDailyTurnoverBps;
        uint16 maxSlippageBps;
        uint64 maxReferenceFreshnessSeconds;
        uint128 closedMarketMaxBuyUsdE18;
        uint128 materialEventMaxBuyUsdE18;
        bool enabled;
        bool exists;
    }

    struct MandateParams {
        bytes32 mandateHash;
        uint64 version;
        uint64 validUntil;
        uint128 navUsdE18;
        uint16 maxAssetExposureBps;
        uint16 maxIssuerExposureBps;
        uint16 maxSectorExposureBps;
        uint16 maxInvestedBps;
        uint16 maxDailyTurnoverBps;
        uint16 maxSlippageBps;
        uint64 maxReferenceFreshnessSeconds;
        uint128 closedMarketMaxBuyUsdE18;
        uint128 materialEventMaxBuyUsdE18;
        bool enabled;
    }

    struct AssetProfile {
        bytes32 issuerKey;
        bytes32 sectorKey;
        bool enabled;
        bool exists;
    }
    function publisher() external view returns (address);
    function getMandate(
        bytes32 policyKey
    ) external view returns (Mandate memory);
    function getAsset(
        bytes32 assetKey
    ) external view returns (AssetProfile memory);
    function registerAsset(
        bytes32 assetKey,
        bytes32 issuerKey,
        bytes32 sectorKey,
        bool enabled
    ) external;
    function publishMandate(
        bytes32 policyKey,
        MandateParams calldata params
    ) external;
}

interface ICircuitPortfolioGuard {
    struct TradeContext {
        uint256 expectedSlippageBps;
        uint256 referenceFreshnessSeconds;
        bool marketSessionClosed;
        bool materialEvent;
    }
    function seeded(
        bytes32 policyKey
    ) external view returns (bool);
    function totalInvested(
        bytes32 policyKey
    ) external view returns (uint256);
    function cashUsd(
        bytes32 policyKey
    ) external view returns (uint256);
    function dailyTurnover(
        bytes32 policyKey
    ) external view returns (uint256);
    function assetExposure(
        bytes32 policyKey,
        bytes32 assetKey
    ) external view returns (uint256);
    function seedPortfolio(
        bytes32 policyKey,
        bytes32[] calldata assetKeys,
        uint256[] calldata notionals,
        uint256 initialCashUsdE18,
        uint256 turnoverUsdE18
    ) external;
    function authorizeTrade(
        bytes32 policyKey,
        bytes32 intentHash,
        bytes32 assetKey,
        bool isBuy,
        uint256 notionalUsdE18,
        TradeContext calldata ctx
    ) external returns (bytes32);
}

interface ICircuitExecutionAdapter {
    function execute(
        CircuitTypes.Authorization calldata auth,
        CircuitTypes.Action[] calldata actions
    ) external payable;
}
