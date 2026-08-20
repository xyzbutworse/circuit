// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CircuitMandateRegistry } from "../src/CircuitMandateRegistry.sol";
import { CircuitPortfolioGuard } from "../src/CircuitPortfolioGuard.sol";
import { Test } from "forge-std/Test.sol";

abstract contract CircuitFixtures is Test {
    CircuitMandateRegistry internal registry;
    CircuitPortfolioGuard internal guard;

    address internal publisher = makeAddr("publisher");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant POLICY = keccak256("mandate-rwa-alpha-01");
    bytes32 internal constant MANDATE_HASH = keccak256("RWA ALPHA / CONTROLLED");
    bytes32 internal constant TSLA = keccak256("tslax");
    bytes32 internal constant GOOGL = keccak256("googlx");
    bytes32 internal constant MSTR = keccak256("mstrx");
    bytes32 internal constant TESLA = keccak256("tesla");
    bytes32 internal constant ALPHABET = keccak256("alphabet");
    bytes32 internal constant STRATEGY = keccak256("strategy");
    bytes32 internal constant AUTO = keccak256("automotive");
    bytes32 internal constant TECH = keccak256("technology");

    uint256 internal constant NAV_E18 = 10_000 ether;
    uint256 internal constant SEED_CASH_E18 = 6_500 ether;
    uint256 internal constant SEED_TURNOVER_E18 = 500 ether;
    uint256 internal constant MAX_SLIPPAGE_BPS = 100;
    uint256 internal constant MAX_FRESHNESS_SECONDS = 1_800;
    uint256 internal constant CLOSED_MARKET_CAP_E18 = 1_000 ether;
    uint256 internal constant MATERIAL_EVENT_CAP_E18 = 500 ether;

    event MandatePublished(bytes32 indexed policyKey, bytes32 indexed mandateHash, uint64 indexed version, uint64 validUntil, bool enabled);
    event PortfolioSeeded(bytes32 indexed policyKey, uint256 totalInvested, uint256 cashUsd, uint256 dailyTurnover, uint64 mandateVersion);
    event TradeAuthorized(
        bytes32 indexed policyKey,
        bytes32 indexed intentHash,
        bytes32 indexed assetKey,
        bool isBuy,
        uint256 notionalUsdE18,
        uint256 resultingAssetExposure,
        uint256 resultingIssuerExposure,
        uint256 resultingSectorExposure,
        uint256 resultingTotalInvested,
        uint256 resultingCashUsd,
        uint256 resultingDailyTurnover,
        uint64 mandateVersion
    );

    function setUp() public virtual {
        registry = new CircuitMandateRegistry(publisher);
        guard = new CircuitPortfolioGuard(address(registry));
        vm.prank(publisher);
        registry.registerAsset(TSLA, TESLA, AUTO, true);
        vm.prank(publisher);
        registry.registerAsset(GOOGL, ALPHABET, TECH, true);
        vm.prank(publisher);
        registry.registerAsset(MSTR, STRATEGY, TECH, true);
        vm.prank(publisher);
        registry.publishMandate(POLICY, mandateParams(1, true));
        seedDefault();
    }

    function mandateParams(
        uint64 version,
        bool enabled
    ) internal view returns (CircuitMandateRegistry.MandateParams memory) {
        return CircuitMandateRegistry.MandateParams({
            mandateHash: MANDATE_HASH,
            version: version,
            validUntil: uint64(block.timestamp + 1 days),
            navUsdE18: uint128(NAV_E18),
            maxAssetExposureBps: 4_500,
            maxIssuerExposureBps: 3_500,
            maxSectorExposureBps: 5_000,
            maxInvestedBps: 9_500,
            maxDailyTurnoverBps: 7_000,
            maxSlippageBps: uint16(MAX_SLIPPAGE_BPS),
            maxReferenceFreshnessSeconds: uint64(MAX_FRESHNESS_SECONDS),
            closedMarketMaxBuyUsdE18: uint128(CLOSED_MARKET_CAP_E18),
            materialEventMaxBuyUsdE18: uint128(MATERIAL_EVENT_CAP_E18),
            enabled: enabled
        });
    }

    function assets() internal pure returns (bytes32[] memory) {
        bytes32[] memory out = new bytes32[](3);
        out[0] = TSLA;
        out[1] = GOOGL;
        out[2] = MSTR;
        return out;
    }

    function positions() internal pure returns (uint256[] memory) {
        uint256[] memory out = new uint256[](3);
        out[0] = 1_500 ether;
        out[1] = 1_500 ether;
        out[2] = 500 ether;
        return out;
    }

    function seedDefault() internal {
        vm.prank(publisher);
        guard.seedPortfolio(POLICY, assets(), positions(), SEED_CASH_E18, SEED_TURNOVER_E18);
    }

    function cleanContext() internal pure returns (CircuitPortfolioGuard.TradeContext memory) {
        return CircuitPortfolioGuard.TradeContext({
            expectedSlippageBps: 0, referenceFreshnessSeconds: 0, marketSessionClosed: false, materialEvent: false
        });
    }

    function expectExecutionDenied(
        uint8 reason
    ) internal {
        vm.expectRevert(abi.encodeWithSelector(CircuitPortfolioGuard.ExecutionDenied.selector, reason));
    }
}
