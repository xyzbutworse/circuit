// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CircuitMandateRegistry } from "../src/CircuitMandateRegistry.sol";
import { CircuitPortfolioGuard, ICircuitMandateRegistry } from "../src/CircuitPortfolioGuard.sol";
import { CircuitFixtures } from "./CircuitFixtures.sol";

contract CircuitPortfolioGuardTest is CircuitFixtures {
    // ------------------------------------------------------------------ //
    // initial portfolio seeding
    // ------------------------------------------------------------------ //

    function testInitialPortfolioSeeding() public view {
        assertTrue(guard.seeded(POLICY));
        assertEq(guard.assetExposure(POLICY, TSLA), 1_500 ether);
        assertEq(guard.assetExposure(POLICY, GOOGL), 1_500 ether);
        assertEq(guard.assetExposure(POLICY, MSTR), 500 ether);
        assertEq(guard.issuerExposure(POLICY, TESLA), 1_500 ether);
        assertEq(guard.issuerExposure(POLICY, ALPHABET), 1_500 ether);
        assertEq(guard.issuerExposure(POLICY, STRATEGY), 500 ether);
        assertEq(guard.sectorExposure(POLICY, AUTO), 1_500 ether);
        assertEq(guard.sectorExposure(POLICY, TECH), 2_000 ether);
        assertEq(guard.totalInvested(POLICY), 3_500 ether);
        assertEq(guard.cashUsd(POLICY), 6_500 ether);
        assertEq(guard.dailyTurnover(POLICY), 500 ether);
    }

    function testSeedingEmitsEvent() public {
        bytes32 policy = keccak256("seed-event-policy");
        vm.prank(publisher);
        registry.publishMandate(policy, mandateParams(1, true));
        vm.expectEmit(true, false, false, true);
        emit PortfolioSeeded(policy, 3_500 ether, 6_500 ether, 500 ether, 1);
        vm.prank(publisher);
        guard.seedPortfolio(policy, assets(), positions(), 6_500 ether, 500 ether);
    }

    function testSeedingTwiceReverts() public {
        vm.prank(publisher);
        vm.expectRevert(CircuitPortfolioGuard.PortfolioAlreadySeeded.selector);
        guard.seedPortfolio(POLICY, assets(), positions(), 6_500 ether, 500 ether);
    }

    function testUnauthorizedSeedingReverts() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitPortfolioGuard.Unauthorized.selector);
        guard.seedPortfolio(POLICY, assets(), positions(), 6_500 ether, 500 ether);
    }

    function testSeedingValidatesMandateLimitsAndRollsBack() public {
        bytes32 policy = keccak256("over-concentrated-seed");
        vm.prank(publisher);
        registry.publishMandate(policy, mandateParams(1, true));
        bytes32[] memory overAssets = new bytes32[](1);
        overAssets[0] = TSLA;
        uint256[] memory overNotional = new uint256[](1);
        overNotional[0] = 4_000 ether; // Tesla issuer would be 40% > 35%
        uint8 reason = guard.REASON_ISSUER_EXPOSURE();
        vm.prank(publisher);
        expectExecutionDenied(reason);
        guard.seedPortfolio(policy, overAssets, overNotional, 6_000 ether, 0);
        assertFalse(guard.seeded(policy));
        assertEq(guard.assetExposure(policy, TSLA), 0);
    }

    function testSeedingCashBeyondNavReverts() public {
        bytes32 policy = keccak256("cash-beyond-nav");
        vm.prank(publisher);
        registry.publishMandate(policy, mandateParams(1, true));
        vm.prank(publisher);
        vm.expectRevert(CircuitPortfolioGuard.InvalidInput.selector);
        guard.seedPortfolio(policy, assets(), positions(), 10_001 ether, 0);
    }

    function testSeedingMismatchedArraysRevert() public {
        bytes32 policy = keccak256("mismatched-seed");
        vm.prank(publisher);
        registry.publishMandate(policy, mandateParams(1, true));
        bytes32[] memory one = new bytes32[](1);
        one[0] = TSLA;
        uint256[] memory two = new uint256[](2);
        two[0] = 1 ether;
        two[1] = 1 ether;
        vm.prank(publisher);
        vm.expectRevert(CircuitPortfolioGuard.InvalidInput.selector);
        guard.seedPortfolio(policy, one, two, 0, 0);
    }

    // ------------------------------------------------------------------ //
    // THE CRITICAL PROOF — current TSLA 15% / +$2,500 → 40% > 35% REVERT
    //                then repaired +$1,500 → 30% → AUTHORIZED
    // ------------------------------------------------------------------ //

    function testCriticalJudgeStoryIssuerConcentration() public {
        // Current Tesla exposure: $1,500 of $10,000 NAV = 15%.
        assertEq(guard.issuerExposure(POLICY, TESLA), 1_500 ether);
        assertEq(guard.assetExposure(POLICY, TSLA), 1_500 ether);

        // Proposed BUY: TSLAx +$2,500 → projected Tesla exposure $4,000 = 40% > 35% limit.
        (bool allowed, uint8 reason, CircuitPortfolioGuard.Projection memory p,) =
            guard.checkTrade(POLICY, TSLA, true, 2_500 ether, cleanContext());
        assertFalse(allowed, "projected 40% issuer exposure must be blocked");
        assertEq(reason, guard.REASON_ISSUER_EXPOSURE());
        assertEq(p.assetExposure, 4_000 ether, "projected asset state must be 40%");
        assertEq(p.issuerExposure, 4_000 ether, "projected issuer state must be 40%");
        assertEq(p.totalInvested, 6_000 ether);
        assertEq(p.cashUsd, 4_000 ether);

        // Execution reverts and nothing is committed.
        uint8 blockedReason = guard.REASON_ISSUER_EXPOSURE();
        vm.prank(publisher);
        expectExecutionDenied(blockedReason);
        guard.authorizeTrade(POLICY, keccak256("plan-001:tslax:2500"), TSLA, true, 2_500 ether, cleanContext());
        assertEq(guard.assetExposure(POLICY, TSLA), 1_500 ether, "blocked trade must not mutate state");
        assertEq(guard.cashUsd(POLICY), 6_500 ether);
        assertEq(guard.totalInvested(POLICY), 3_500 ether);
        assertEq(guard.dailyTurnover(POLICY), 500 ether);

        // Repaired BUY: TSLAx +$1,500 → projected Tesla exposure $3,000 = 30% ≤ 35% → authorized.
        (bool allowed2,, CircuitPortfolioGuard.Projection memory p2,) = guard.checkTrade(POLICY, TSLA, true, 1_500 ether, cleanContext());
        assertTrue(allowed2, "repaired 30% issuer exposure must be authorized");
        assertEq(p2.issuerExposure, 3_000 ether);
        assertEq(p2.assetExposure, 3_000 ether);

        vm.prank(publisher);
        bytes32 authorizationHash = guard.authorizeTrade(POLICY, keccak256("plan-002:tslax:1500"), TSLA, true, 1_500 ether, cleanContext());
        assertTrue(authorizationHash != bytes32(0));
        assertEq(guard.assetExposure(POLICY, TSLA), 3_000 ether, "authorized state must advance to 30%");
        assertEq(guard.issuerExposure(POLICY, TESLA), 3_000 ether);
        assertEq(guard.cashUsd(POLICY), 5_000 ether);
        assertEq(guard.totalInvested(POLICY), 5_000 ether);
        assertEq(guard.dailyTurnover(POLICY), 2_000 ether);
    }

    // ------------------------------------------------------------------ //
    // boundary equality — 35.00% passes, 35.01% fails
    // ------------------------------------------------------------------ //

    function testBoundaryEquality35PercentExactlyPasses() public {
        // TSLA 1500 → 3500 = 35.00% of NAV.
        (bool allowed,,,) = guard.checkTrade(POLICY, TSLA, true, 2_000 ether, cleanContext());
        assertTrue(allowed, "35.00% issuer exposure must pass");
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("boundary-35"), TSLA, true, 2_000 ether, cleanContext());
        assertEq(guard.issuerExposure(POLICY, TESLA), 3_500 ether);
    }

    function testBoundaryEquality35Point01PercentFails() public {
        // TSLA 1500 → 3501 = 35.01% of NAV.
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 2_001 ether, cleanContext());
        assertFalse(allowed, "35.01% issuer exposure must fail");
        assertEq(reason, guard.REASON_ISSUER_EXPOSURE());
        uint8 blockedReason = guard.REASON_ISSUER_EXPOSURE();
        vm.prank(publisher);
        expectExecutionDenied(blockedReason);
        guard.authorizeTrade(POLICY, keccak256("boundary-3501"), TSLA, true, 2_001 ether, cleanContext());
    }

    function testBoundaryEqualitySector50Percent() public {
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("g"), GOOGL, true, 1_500 ether, cleanContext());
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("m"), MSTR, true, 1_500 ether, cleanContext());
        assertEq(guard.sectorExposure(POLICY, TECH), 5_000 ether, "technology sector must land exactly at 50%");
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, MSTR, true, 1 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_SECTOR_EXPOSURE());
    }

    // ------------------------------------------------------------------ //
    // exposure calculations
    // ------------------------------------------------------------------ //

    function testAssetExposureCalculation() public {
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("a1"), TSLA, true, 1_000 ether, cleanContext());
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("a2"), TSLA, true, 500 ether, cleanContext());
        assertEq(guard.assetExposure(POLICY, TSLA), 3_000 ether);
        assertEq(guard.issuerExposure(POLICY, TESLA), 3_000 ether);
        assertEq(guard.sectorExposure(POLICY, AUTO), 3_000 ether);
        assertEq(guard.totalInvested(POLICY), 5_000 ether);
    }

    function testSectorConcentrationAccumulatesAcrossIssuers() public {
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("s1"), GOOGL, true, 1_500 ether, cleanContext());
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("s2"), MSTR, true, 1_500 ether, cleanContext());
        assertEq(guard.sectorExposure(POLICY, TECH), 5_000 ether);
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, MSTR, true, 1 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_SECTOR_EXPOSURE());
    }

    // ------------------------------------------------------------------ //
    // total invested exposure
    // ------------------------------------------------------------------ //

    function testTotalInvestedLimit() public {
        bytes32 policy = keccak256("invested-policy");
        vm.prank(publisher);
        registry.publishMandate(policy, investedMandate(1));
        bytes32[] memory one = new bytes32[](1);
        one[0] = MSTR;
        uint256[] memory pos = new uint256[](1);
        pos[0] = 500 ether;
        vm.prank(publisher);
        guard.seedPortfolio(policy, one, pos, 9_500 ether, 0);

        (bool allowed,,,) = guard.checkTrade(policy, MSTR, true, 9_000 ether, cleanContext());
        assertTrue(allowed, "95% invested exactly must pass");
        (bool allowed2, uint8 reason2,,) = guard.checkTrade(policy, MSTR, true, 9_001 ether, cleanContext());
        assertFalse(allowed2);
        assertEq(reason2, guard.REASON_INVESTED());
    }

    function investedMandate(
        uint64 version
    ) internal view returns (CircuitMandateRegistry.MandateParams memory) {
        CircuitMandateRegistry.MandateParams memory m = mandateParams(version, true);
        m.maxAssetExposureBps = 10_000;
        m.maxIssuerExposureBps = 10_000;
        m.maxSectorExposureBps = 10_000;
        m.maxInvestedBps = 9_500;
        m.maxDailyTurnoverBps = 10_000;
        return m;
    }

    // ------------------------------------------------------------------ //
    // available cash constraints
    // ------------------------------------------------------------------ //

    function testAvailableCashConstraint() public {
        bytes32 policy = keccak256("cash-policy");
        vm.prank(publisher);
        registry.publishMandate(policy, investedMandate(1));
        bytes32[] memory one = new bytes32[](1);
        one[0] = MSTR;
        uint256[] memory pos = new uint256[](1);
        pos[0] = 500 ether;
        vm.prank(publisher);
        guard.seedPortfolio(policy, one, pos, 6_500 ether, 0);

        (bool allowed,,,) = guard.checkTrade(policy, MSTR, true, 6_500 ether, cleanContext());
        assertTrue(allowed, "spending exactly the available cash must pass");
        (bool allowed2, uint8 reason2,,) = guard.checkTrade(policy, MSTR, true, 6_501 ether, cleanContext());
        assertFalse(allowed2);
        assertEq(reason2, guard.REASON_CASH());
    }

    function testSellRestoresCash() public {
        (bool allowed,,,) = guard.checkTrade(POLICY, MSTR, false, 500 ether, cleanContext());
        assertTrue(allowed);
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("sell-mstr"), MSTR, false, 500 ether, cleanContext());
        assertEq(guard.cashUsd(POLICY), 7_000 ether);
        assertEq(guard.assetExposure(POLICY, MSTR), 0);
        assertEq(guard.totalInvested(POLICY), 3_000 ether);
        assertEq(guard.issuerExposure(POLICY, STRATEGY), 0);
    }

    function testOversellBeyondPositionFails() public {
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, MSTR, false, 501 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_POSITION());
        uint8 positionReason = guard.REASON_POSITION();
        vm.prank(publisher);
        expectExecutionDenied(positionReason);
        guard.authorizeTrade(POLICY, keccak256("oversell"), MSTR, false, 501 ether, cleanContext());
    }

    // ------------------------------------------------------------------ //
    // daily turnover
    // ------------------------------------------------------------------ //

    function testDailyTurnoverLimit() public {
        bytes32 policy = keccak256("turnover-policy");
        vm.prank(publisher);
        registry.publishMandate(policy, turnoverMandate(1));
        bytes32[] memory one = new bytes32[](1);
        one[0] = MSTR;
        uint256[] memory pos = new uint256[](1);
        pos[0] = 500 ether;
        vm.prank(publisher);
        guard.seedPortfolio(policy, one, pos, 8_000 ether, 0);

        vm.prank(publisher);
        guard.authorizeTrade(policy, keccak256("t1"), MSTR, true, 3_000 ether, cleanContext());
        assertEq(guard.dailyTurnover(policy), 3_000 ether);
        (bool allowed, uint8 reason,,) = guard.checkTrade(policy, MSTR, true, 1 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_TURNOVER());
    }

    function turnoverMandate(
        uint64 version
    ) internal view returns (CircuitMandateRegistry.MandateParams memory) {
        CircuitMandateRegistry.MandateParams memory m = mandateParams(version, true);
        m.validUntil = uint64(block.timestamp + 10 days);
        m.maxAssetExposureBps = 10_000;
        m.maxIssuerExposureBps = 10_000;
        m.maxSectorExposureBps = 10_000;
        m.maxInvestedBps = 10_000;
        m.maxDailyTurnoverBps = 3_000;
        return m;
    }

    function testDailyTurnoverResetsOnNewDay() public {
        bytes32 policy = keccak256("turnover-rollover-policy");
        vm.prank(publisher);
        registry.publishMandate(policy, turnoverMandate(1));
        bytes32[] memory one = new bytes32[](1);
        one[0] = MSTR;
        uint256[] memory pos = new uint256[](1);
        pos[0] = 500 ether;
        vm.prank(publisher);
        guard.seedPortfolio(policy, one, pos, 8_000 ether, 0);
        vm.prank(publisher);
        guard.authorizeTrade(policy, keccak256("d1"), MSTR, true, 3_000 ether, cleanContext());

        vm.warp(block.timestamp + 1 days);
        (bool allowed,,, ICircuitMandateRegistry.Mandate memory mandate) = guard.checkTrade(policy, MSTR, true, 1_000 ether, cleanContext());
        assertTrue(allowed, "turnover must reset on the next day");
        assertEq(mandate.version, 1);
        vm.prank(publisher);
        guard.authorizeTrade(policy, keccak256("d2"), MSTR, true, 1_000 ether, cleanContext());
        assertEq(guard.dailyTurnover(policy), 1_000 ether, "turnover counter restarts from the new trade");
    }

    // ------------------------------------------------------------------ //
    // maximum slippage
    // ------------------------------------------------------------------ //

    function testSlippageOverBudgetFails() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.expectedSlippageBps = 101;
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, ctx);
        assertFalse(allowed);
        assertEq(reason, guard.REASON_SLIPPAGE());
    }

    function testSlippageAtBudgetPasses() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.expectedSlippageBps = 100;
        (bool allowed,,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, ctx);
        assertTrue(allowed);
    }

    function testSlippageAppliesToSellsToo() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.expectedSlippageBps = 101;
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, MSTR, false, 1 ether, ctx);
        assertFalse(allowed);
        assertEq(reason, guard.REASON_SLIPPAGE());
    }

    // ------------------------------------------------------------------ //
    // stale-reference restriction
    // ------------------------------------------------------------------ //

    function testStaleReferenceBlocksNewBuys() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.referenceFreshnessSeconds = 1_801;
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, ctx);
        assertFalse(allowed);
        assertEq(reason, guard.REASON_REFERENCE_STALE());
    }

    function testFreshReferenceAtBoundaryPasses() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.referenceFreshnessSeconds = 1_800;
        (bool allowed,,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, ctx);
        assertTrue(allowed);
    }

    function testStaleReferenceDoesNotBlockSells() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.referenceFreshnessSeconds = 1_801;
        (bool allowed,,,) = guard.checkTrade(POLICY, MSTR, false, 1 ether, ctx);
        assertTrue(allowed, "selling existing exposure must not require a fresh reference");
    }

    // ------------------------------------------------------------------ //
    // closed-market restriction
    // ------------------------------------------------------------------ //

    function testClosedMarketCapsNewBuys() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.marketSessionClosed = true;
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 1_001 ether, ctx);
        assertFalse(allowed);
        assertEq(reason, guard.REASON_CLOSED_MARKET());
    }

    function testClosedMarketCapBoundaryPasses() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.marketSessionClosed = true;
        (bool allowed,,,) = guard.checkTrade(POLICY, TSLA, true, 1_000 ether, ctx);
        assertTrue(allowed);
    }

    function testClosedMarketDoesNotRestrictSells() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.marketSessionClosed = true;
        (bool allowed,,,) = guard.checkTrade(POLICY, MSTR, false, 500 ether, ctx);
        assertTrue(allowed);
    }

    // ------------------------------------------------------------------ //
    // material-event restriction
    // ------------------------------------------------------------------ //

    function testMaterialEventCapsNewBuys() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.materialEvent = true;
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 501 ether, ctx);
        assertFalse(allowed);
        assertEq(reason, guard.REASON_MATERIAL_EVENT());
    }

    function testMaterialEventCapBoundaryPasses() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.materialEvent = true;
        (bool allowed,,,) = guard.checkTrade(POLICY, TSLA, true, 500 ether, ctx);
        assertTrue(allowed);
    }

    function testMaterialEventDoesNotRestrictSells() public {
        CircuitPortfolioGuard.TradeContext memory ctx = cleanContext();
        ctx.materialEvent = true;
        (bool allowed,,,) = guard.checkTrade(POLICY, MSTR, false, 500 ether, ctx);
        assertTrue(allowed);
    }

    // ------------------------------------------------------------------ //
    // valid BUY / valid SELL
    // ------------------------------------------------------------------ //

    function testValidBuyAuthorizesAndEmitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit TradeAuthorized(
            POLICY,
            keccak256("valid-buy"),
            TSLA,
            true,
            1_000 ether,
            2_500 ether,
            2_500 ether,
            2_500 ether,
            4_500 ether,
            5_500 ether,
            1_500 ether,
            1
        );
        vm.prank(publisher);
        bytes32 hash = guard.authorizeTrade(POLICY, keccak256("valid-buy"), TSLA, true, 1_000 ether, cleanContext());
        assertTrue(hash != bytes32(0));
    }

    function testValidSellIsSupported() public {
        vm.prank(publisher);
        bytes32 hash = guard.authorizeTrade(POLICY, keccak256("valid-sell"), GOOGL, false, 500 ether, cleanContext());
        assertTrue(hash != bytes32(0));
        assertEq(guard.assetExposure(POLICY, GOOGL), 1_000 ether);
        assertEq(guard.issuerExposure(POLICY, ALPHABET), 1_000 ether);
        assertEq(guard.cashUsd(POLICY), 7_000 ether);
        assertEq(guard.totalInvested(POLICY), 3_000 ether);
    }

    // ------------------------------------------------------------------ //
    // projected post-trade state
    // ------------------------------------------------------------------ //

    function testProjectedPostTradeStateForBuy() public view {
        (bool allowed,, CircuitPortfolioGuard.Projection memory p,) = guard.checkTrade(POLICY, GOOGL, true, 1_500 ether, cleanContext());
        assertTrue(allowed);
        assertEq(p.assetExposure, 3_000 ether);
        assertEq(p.issuerExposure, 3_000 ether);
        assertEq(p.sectorExposure, 3_500 ether); // MSTR 500 + GOOGL 3000
        assertEq(p.totalInvested, 5_000 ether);
        assertEq(p.cashUsd, 5_000 ether);
        assertEq(p.dailyTurnover, 2_000 ether);
    }

    function testProjectedPostTradeStateForSell() public view {
        (bool allowed,, CircuitPortfolioGuard.Projection memory p,) = guard.checkTrade(POLICY, MSTR, false, 200 ether, cleanContext());
        assertTrue(allowed);
        assertEq(p.assetExposure, 300 ether);
        assertEq(p.issuerExposure, 300 ether);
        assertEq(p.sectorExposure, 1_800 ether);
        assertEq(p.totalInvested, 3_300 ether);
        assertEq(p.cashUsd, 6_700 ether);
    }

    // ------------------------------------------------------------------ //
    // violation rollback / successful state update
    // ------------------------------------------------------------------ //

    function testViolationRollsBackCompletely() public {
        uint8 blockedReason = guard.REASON_ISSUER_EXPOSURE();
        vm.prank(publisher);
        expectExecutionDenied(blockedReason);
        guard.authorizeTrade(POLICY, keccak256("rollback"), TSLA, true, 2_500 ether, cleanContext());
        assertEq(guard.assetExposure(POLICY, TSLA), 1_500 ether);
        assertEq(guard.issuerExposure(POLICY, TESLA), 1_500 ether);
        assertEq(guard.sectorExposure(POLICY, AUTO), 1_500 ether);
        assertEq(guard.totalInvested(POLICY), 3_500 ether);
        assertEq(guard.cashUsd(POLICY), 6_500 ether);
        assertEq(guard.dailyTurnover(POLICY), 500 ether);
        assertFalse(guard.consumedIntent(keccak256("rollback")), "rejected intent must not be consumed");
    }

    function testSuccessfulStateUpdate() public {
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("success"), GOOGL, true, 1_500 ether, cleanContext());
        assertEq(guard.assetExposure(POLICY, GOOGL), 3_000 ether);
        assertEq(guard.totalInvested(POLICY), 5_000 ether);
        assertEq(guard.cashUsd(POLICY), 5_000 ether);
        assertTrue(guard.consumedIntent(keccak256("success")));
    }

    // ------------------------------------------------------------------ //
    // duplicate / replayed intent hash
    // ------------------------------------------------------------------ //

    function testIntentCannotBeReplayed() public {
        bytes32 intent = keccak256("unique-intent");
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, intent, TSLA, true, 1_000 ether, cleanContext());
        vm.prank(publisher);
        vm.expectRevert(CircuitPortfolioGuard.IntentAlreadyConsumed.selector);
        guard.authorizeTrade(POLICY, intent, TSLA, true, 1 ether, cleanContext());
        vm.prank(publisher);
        vm.expectRevert(CircuitPortfolioGuard.IntentAlreadyConsumed.selector);
        guard.authorizeTrade(POLICY, intent, GOOGL, true, 1 ether, cleanContext());
    }

    // ------------------------------------------------------------------ //
    // deterministic authorization hash
    // ------------------------------------------------------------------ //

    function testDeterministicAuthorizationHash() public {
        bytes32 intent = keccak256("hash-intent");
        vm.prank(publisher);
        bytes32 hash = guard.authorizeTrade(POLICY, intent, GOOGL, true, 1_500 ether, cleanContext());
        bytes32 expected = keccak256(
            abi.encode(
                block.chainid,
                address(guard),
                POLICY,
                intent,
                MANDATE_HASH,
                uint64(1),
                GOOGL,
                true,
                uint256(1_500 ether),
                uint256(3_000 ether),
                uint256(3_000 ether),
                uint256(3_500 ether),
                uint256(5_000 ether),
                uint256(5_000 ether),
                uint256(2_000 ether)
            )
        );
        assertEq(hash, expected, "authorization hash must be deterministic");
        assertTrue(hash != bytes32(0));

        vm.prank(publisher);
        bytes32 other = guard.authorizeTrade(POLICY, keccak256("hash-intent-2"), MSTR, true, 1_500 ether, cleanContext());
        assertTrue(other != hash, "distinct trades must produce distinct authorization hashes");
    }

    // ------------------------------------------------------------------ //
    // zero / malformed values
    // ------------------------------------------------------------------ //

    function testZeroNotionalReverts() public {
        vm.expectRevert(CircuitPortfolioGuard.InvalidInput.selector);
        guard.checkTrade(POLICY, TSLA, true, 0, cleanContext());
        vm.prank(publisher);
        vm.expectRevert(CircuitPortfolioGuard.InvalidInput.selector);
        guard.authorizeTrade(POLICY, keccak256("zero-notional"), TSLA, true, 0, cleanContext());
    }

    function testZeroIntentHashReverts() public {
        vm.prank(publisher);
        vm.expectRevert(CircuitPortfolioGuard.InvalidInput.selector);
        guard.authorizeTrade(POLICY, bytes32(0), TSLA, true, 1 ether, cleanContext());
    }

    function testZeroRegistryAddressReverts() public {
        vm.expectRevert(CircuitPortfolioGuard.InvalidInput.selector);
        new CircuitPortfolioGuard(address(0));
    }

    // ------------------------------------------------------------------ //
    // multiple sequential trades must use the updated portfolio state
    // ------------------------------------------------------------------ //

    function testSequentialTradesUseUpdatedState() public {
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("seq-1"), TSLA, true, 1_500 ether, cleanContext());

        // The same +$2,500 that was issuer-blocked before would now breach asset
        // exposure: 3_000 + 2_500 = 5_500 = 55% > 45%. State was updated.
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 2_500 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_ASSET_EXPOSURE());

        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("seq-2"), GOOGL, true, 1_500 ether, cleanContext());
        vm.prank(publisher);
        guard.authorizeTrade(POLICY, keccak256("seq-3"), MSTR, true, 1_500 ether, cleanContext());

        assertEq(guard.assetExposure(POLICY, TSLA), 3_000 ether);
        assertEq(guard.assetExposure(POLICY, GOOGL), 3_000 ether);
        assertEq(guard.assetExposure(POLICY, MSTR), 2_000 ether);
        assertEq(guard.sectorExposure(POLICY, TECH), 5_000 ether, "technology lands exactly at the 50% ceiling");
        assertEq(guard.totalInvested(POLICY), 8_000 ether);
        assertEq(guard.cashUsd(POLICY), 2_000 ether);
        assertEq(guard.dailyTurnover(POLICY), 5_000 ether);

        (bool finalAllowed, uint8 finalReason,,) = guard.checkTrade(POLICY, MSTR, true, 1 ether, cleanContext());
        assertFalse(finalAllowed);
        assertEq(finalReason, guard.REASON_SECTOR_EXPOSURE(), "sector ceiling binds after sequential state updates");
    }
}
