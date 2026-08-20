// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CircuitMandateRegistry } from "../src/CircuitMandateRegistry.sol";
import { CircuitPortfolioGuard } from "../src/CircuitPortfolioGuard.sol";
import { CircuitFixtures } from "./CircuitFixtures.sol";

contract CircuitMandateRegistryTest is CircuitFixtures {
    // ------------------------------------------------------------------ //
    // mandate creation
    // ------------------------------------------------------------------ //

    function testPublishMandateCreatesVersionedRecord() public {
        vm.expectEmit(true, true, true, false);
        emit MandatePublished(POLICY, MANDATE_HASH, 2, uint64(block.timestamp + 2 days), true);
        vm.prank(publisher);
        registry.publishMandate(POLICY, mandateParams(2, true));

        CircuitMandateRegistry.Mandate memory stored = registry.getMandate(POLICY);
        assertTrue(stored.exists);
        assertEq(stored.version, 2);
        assertEq(stored.mandateHash, MANDATE_HASH);
        assertEq(stored.navUsdE18, uint128(NAV_E18));
        assertEq(stored.maxIssuerExposureBps, 3_500);
        assertEq(stored.maxSlippageBps, MAX_SLIPPAGE_BPS);
        assertEq(stored.maxReferenceFreshnessSeconds, MAX_FRESHNESS_SECONDS);
        assertEq(stored.closedMarketMaxBuyUsdE18, CLOSED_MARKET_CAP_E18);
        assertEq(stored.materialEventMaxBuyUsdE18, MATERIAL_EVENT_CAP_E18);
        assertTrue(stored.enabled);
    }

    function testInitialMandateVersionMustExistBeforeUse() public {
        CircuitMandateRegistry.Mandate memory empty = registry.getMandate(keccak256("missing-policy"));
        assertFalse(empty.exists);
    }

    // ------------------------------------------------------------------ //
    // unauthorized mandate mutation
    // ------------------------------------------------------------------ //

    function testNonPublisherCannotPublishMandate() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.publishMandate(POLICY, mandateParams(2, true));
    }

    function testOwnerIsNotPublisher() public {
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.publishMandate(POLICY, mandateParams(2, true));
    }

    function testNonPublisherCannotRegisterAsset() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.registerAsset(keccak256("nvdlax"), keccak256("nvidia"), keccak256("technology"), true);
    }

    function testNonPublisherCannotToggleMandateEnabled() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.setMandateEnabled(POLICY, false);
    }

    function testNonPublisherCannotToggleAssetEnabled() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.setAssetEnabled(TSLA, false);
    }

    function testNonOwnerCannotRotatePublisherOrOwner() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.setPublisher(stranger);
        vm.prank(stranger);
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.transferOwnership(stranger);
    }

    // ------------------------------------------------------------------ //
    // policy version ordering
    // ------------------------------------------------------------------ //

    function testNewerVersionReplacesOlder() public {
        vm.prank(publisher);
        registry.publishMandate(POLICY, mandateParams(2, true));
        assertEq(registry.getMandate(POLICY).version, 2);
    }

    function testOlderVersionCannotOverwriteNewer() public {
        vm.prank(publisher);
        registry.publishMandate(POLICY, mandateParams(2, true));
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.VersionRegression.selector);
        registry.publishMandate(POLICY, mandateParams(1, true));
    }

    function testEqualVersionCannotRepublish() public {
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.VersionRegression.selector);
        registry.publishMandate(POLICY, mandateParams(1, true));
    }

    // ------------------------------------------------------------------ //
    // disabled / expired mandate
    // ------------------------------------------------------------------ //

    function testDisabledMandateBlocksTrades() public {
        vm.prank(publisher);
        registry.setMandateEnabled(POLICY, false);
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_DISABLED());
    }

    function testReenabledMandateResumesTrades() public {
        vm.prank(publisher);
        registry.setMandateEnabled(POLICY, false);
        vm.prank(publisher);
        registry.setMandateEnabled(POLICY, true);
        (bool allowed,,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, cleanContext());
        assertTrue(allowed);
    }

    function testPublishedDisabledMandateBlocksTrades() public {
        vm.prank(publisher);
        registry.publishMandate(POLICY, mandateParams(2, false));
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_DISABLED());
    }

    function testExpiredMandateBlocksTrades() public {
        vm.warp(block.timestamp + 1 days + 1);
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_EXPIRED());
    }

    // ------------------------------------------------------------------ //
    // unknown asset / asset eligibility
    // ------------------------------------------------------------------ //

    function testUnregisteredAssetIsUnknown() public {
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, keccak256("nvdlax"), true, 1 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_UNKNOWN_ASSET());
    }

    function testDisabledAssetIsIneligible() public {
        vm.prank(publisher);
        registry.setAssetEnabled(TSLA, false);
        (bool allowed, uint8 reason,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, cleanContext());
        assertFalse(allowed);
        assertEq(reason, guard.REASON_UNKNOWN_ASSET());
    }

    function testReenabledAssetIsEligible() public {
        vm.prank(publisher);
        registry.setAssetEnabled(TSLA, false);
        vm.prank(publisher);
        registry.setAssetEnabled(TSLA, true);
        (bool allowed,,,) = guard.checkTrade(POLICY, TSLA, true, 1 ether, cleanContext());
        assertTrue(allowed);
    }

    function testSeedingWithUnknownAssetReverts() public {
        bytes32 policy = keccak256("unknown-asset-seed");
        vm.prank(publisher);
        registry.publishMandate(policy, mandateParams(1, true));
        bytes32[] memory badAssets = new bytes32[](1);
        badAssets[0] = keccak256("nvdlax");
        uint256[] memory badNotional = new uint256[](1);
        badNotional[0] = 1 ether;
        uint8 reason = guard.REASON_UNKNOWN_ASSET();
        vm.prank(publisher);
        expectExecutionDenied(reason);
        guard.seedPortfolio(policy, badAssets, badNotional, 9_999 ether, 0);
        assertFalse(guard.seeded(policy));
    }

    // ------------------------------------------------------------------ //
    // zero / malformed values
    // ------------------------------------------------------------------ //

    function testMalformedMandateValuesRevert() public {
        CircuitMandateRegistry.MandateParams memory bad = mandateParams(2, true);

        bad.maxAssetExposureBps = 10_001;
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.maxIssuerExposureBps = 10_001;
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.maxSectorExposureBps = 10_001;
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.maxInvestedBps = 10_001;
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.maxDailyTurnoverBps = 10_001;
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.maxSlippageBps = 10_001;
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.navUsdE18 = 0;
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.validUntil = uint64(block.timestamp);
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.mandateHash = bytes32(0);
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        bad = mandateParams(2, true);
        bad.maxReferenceFreshnessSeconds = 0;
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(POLICY, bad);

        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidMandate.selector);
        registry.publishMandate(bytes32(0), mandateParams(2, true));
    }

    function testZeroAssetKeysRevert() public {
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidAsset.selector);
        registry.registerAsset(bytes32(0), TESLA, AUTO, true);
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidAsset.selector);
        registry.registerAsset(TSLA, bytes32(0), AUTO, true);
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.InvalidAsset.selector);
        registry.registerAsset(TSLA, TESLA, bytes32(0), true);
    }

    function testZeroAddressForAuthorityRolesReverts() public {
        vm.expectRevert(CircuitMandateRegistry.InvalidAddress.selector);
        registry.setPublisher(address(0));
        vm.expectRevert(CircuitMandateRegistry.InvalidAddress.selector);
        registry.transferOwnership(address(0));
    }

    // ------------------------------------------------------------------ //
    // authority rotation
    // ------------------------------------------------------------------ //

    function testPublisherRotationTakesEffectImmediately() public {
        registry.setPublisher(stranger);
        vm.prank(publisher);
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.publishMandate(POLICY, mandateParams(2, true));
        vm.prank(stranger);
        registry.publishMandate(POLICY, mandateParams(2, true));
        assertEq(registry.getMandate(POLICY).version, 2);
    }

    function testOwnershipTransferTakesEffectImmediately() public {
        registry.transferOwnership(stranger);
        assertEq(registry.owner(), stranger);
        vm.expectRevert(CircuitMandateRegistry.Unauthorized.selector);
        registry.setPublisher(stranger);
        vm.prank(stranger);
        registry.setPublisher(stranger);
        assertEq(registry.publisher(), stranger);
    }
}
