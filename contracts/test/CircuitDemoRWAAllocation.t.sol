// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CircuitDemoRWAAllocation } from "../src/CircuitDemoRWAAllocation.sol";
import { Test } from "forge-std/Test.sol";

contract MockMandateRegistry {
    bytes32 public mockHash;
    uint64 public mockVersion;
    uint64 public mockValidUntil = type(uint64).max;
    uint128 public nav = 0;
    uint16 public maxAsset = 0;
    uint16 public maxIssuer = 0;
    uint16 public maxSector = 0;
    uint16 public maxInvested = 0;
    uint16 public maxTurnover = 0;
    uint16 public maxSlippage = 0;
    uint64 public maxFreshness = 0;
    uint128 public closedCap = 0;
    uint128 public materialCap = 0;
    bool public enabled = true;
    bool public exists = true;

    constructor(
        bytes32 h,
        uint64 v
    ) {
        mockHash = h;
        mockVersion = v;
    }

    function set(
        bytes32 h,
        uint64 v
    ) external {
        mockHash = h;
        mockVersion = v;
    }

    function getMandate(
        bytes32
    )
        external
        view
        returns (
            bytes32 mandateHash,
            uint64 version,
            uint64 validUntil,
            uint128 navUsdE18,
            uint16 maxAssetExposureBps,
            uint16 maxIssuerExposureBps,
            uint16 maxSectorExposureBps,
            uint16 maxInvestedBps,
            uint16 maxDailyTurnoverBps,
            uint16 maxSlippageBps,
            uint64 maxReferenceFreshnessSeconds,
            uint128 closedMarketMaxBuyUsdE18,
            uint128 materialEventMaxBuyUsdE18,
            bool enabled_,
            bool exists_
        )
    {
        return (
            mockHash,
            mockVersion,
            mockValidUntil,
            nav,
            maxAsset,
            maxIssuer,
            maxSector,
            maxInvested,
            maxTurnover,
            maxSlippage,
            maxFreshness,
            closedCap,
            materialCap,
            enabled,
            exists
        );
    }
}

contract MockVaultState {
    bytes32 public value;

    constructor(
        bytes32 v
    ) {
        value = v;
    }

    function set(
        bytes32 v
    ) external {
        value = v;
    }

    function currentStateHash() external view returns (bytes32) {
        return value;
    }
}

contract CircuitDemoRWAAllocationTest is Test {
    uint64 constant CHAIN = 1952;
    bytes32 constant FUND = keccak256("portfolio-alpha-01");
    bytes32 constant ASSET = keccak256("acme-inv-8842");
    bytes32 constant ASSET_HASH = keccak256("economic-state-v1");
    bytes32 constant PASSPORT = keccak256("PASS-ACME-8842");
    bytes32 constant MANDATE_HASH = keccak256("mandate-v1");
    bytes32 constant PORTFOLIO_HASH = keccak256("portfolio-state-v1");

    MockMandateRegistry internal reg;
    MockVaultState internal vault;
    CircuitDemoRWAAllocation internal alloc;
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.chainId(CHAIN);
        reg = new MockMandateRegistry(MANDATE_HASH, 1);
        vault = new MockVaultState(PORTFOLIO_HASH);
        alloc = new CircuitDemoRWAAllocation(CHAIN, address(reg), address(vault));
        alloc.registerAsset(ASSET, PASSPORT, ASSET_HASH, true);
        alloc.registerFund(FUND);
        alloc.setExecutor(address(this));
    }

    function approval(
        uint64 expiry,
        bytes32 assetStateHash,
        bytes32 portfolioHash,
        bytes32 mandateHash,
        uint64 mandateVersion,
        uint256 liveWei,
        uint64 chain,
        uint256 nonce
    ) internal view returns (CircuitDemoRWAAllocation.Approval memory a) {
        a = CircuitDemoRWAAllocation.Approval({
            fundKey: FUND,
            assetKey: ASSET,
            assetStateHash: assetStateHash,
            portfolioStateHash: portfolioHash,
            mandateHash: mandateHash,
            mandateVersion: mandateVersion,
            economicAmountUsd: 35000,
            liveAmountWei: liveWei,
            chainId: chain,
            nonce: nonce,
            expiry: expiry,
            approvalSubId: keccak256("AP-1")
        });
    }

    function freshApproval() internal view returns (CircuitDemoRWAAllocation.Approval memory) {
        return approval(uint64(block.timestamp + 300), ASSET_HASH, PORTFOLIO_HASH, MANDATE_HASH, 1, 1e15, CHAIN, 11);
    }

    function testValidApprovalExecutesAndUpdatesStateExactlyOnce() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        bytes32 ah = alloc.approvalHashFor(a);
        bytes32 allocId = alloc.execute(a);
        assertEq(alloc.executionCount(), 1);
        assertEq(alloc.allocatedAmount(keccak256(abi.encode(FUND, ASSET))), 1e15);
        assertEq(alloc.totalAllocated(), 1e15);
        assertTrue(alloc.consumedApprovals(ah));
        (bytes32 id, bytes32 assetId, bytes32 fundId, uint256 amount, bytes32 approvalHash, bool executed) = alloc.allocations(allocId);
        assertEq(id, allocId);
        assertEq(assetId, ASSET);
        assertEq(fundId, FUND);
        assertEq(amount, 1e15);
        assertEq(approvalHash, ah);
        assertTrue(executed);
    }

    function testCannotExecuteTwice() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        alloc.execute(a);
        vm.expectRevert(CircuitDemoRWAAllocation.ReplayedApproval.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 1);
        assertEq(alloc.totalAllocated(), 1e15);
    }

    function testStaleEconomicStateHashReverts() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        alloc.registerAsset(ASSET, PASSPORT, keccak256("economic-state-v2-disputed"), true);
        vm.expectRevert(CircuitDemoRWAAllocation.EconomicStateChanged.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 0);
        assertEq(alloc.totalAllocated(), 0);
    }

    function testStaleMandateReverts() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        reg.set(keccak256("mandate-v2"), 2);
        vm.expectRevert(CircuitDemoRWAAllocation.MandateChanged.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 0);
    }

    function testStalePortfolioStateReverts() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        vault.set(keccak256("portfolio-state-v2"));
        vm.expectRevert(CircuitDemoRWAAllocation.PortfolioStateChanged.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 0);
    }

    function testExpiredApprovalReverts() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        vm.warp(block.timestamp + 1000);
        vm.expectRevert(CircuitDemoRWAAllocation.ExpiredApproval.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 0);
    }

    function testWrongChainReverts() public {
        CircuitDemoRWAAllocation.Approval memory a =
            approval(uint64(block.timestamp + 300), ASSET_HASH, PORTFOLIO_HASH, MANDATE_HASH, 1, 1e15, CHAIN + 1, 12);
        vm.expectRevert(CircuitDemoRWAAllocation.WrongApprovalChain.selector);
        alloc.execute(a);
    }

    function testLiveAmountIsBoundIntoCommitment() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        CircuitDemoRWAAllocation.Approval memory tampered =
            approval(uint64(block.timestamp + 300), ASSET_HASH, PORTFOLIO_HASH, MANDATE_HASH, 1, 1e15 + 1, CHAIN, 11);
        assertTrue(alloc.approvalHashFor(a) != alloc.approvalHashFor(tampered));
        assertEq(alloc.executionCount(), 0);
    }

    function testOriginalApprovalCannotBeReplayedAfterAnyExecution() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        alloc.execute(a);
        vm.expectRevert(CircuitDemoRWAAllocation.ReplayedApproval.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 1);
        assertEq(alloc.totalAllocated(), 1e15);
    }

    function testWrongFundReverts() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        a.fundKey = keccak256("other-fund");
        vm.expectRevert(CircuitDemoRWAAllocation.UnknownFund.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 0);
    }

    function testWrongAssetReverts() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        a.assetKey = keccak256("totaly-not-registered");
        vm.expectRevert(CircuitDemoRWAAllocation.UnknownAsset.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 0);
    }

    function testInactiveAssetReverts() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        alloc.registerAsset(ASSET, PASSPORT, ASSET_HASH, false);
        vm.expectRevert(CircuitDemoRWAAllocation.AssetInactive.selector);
        alloc.execute(a);
    }

    function testOnlyExecutorMayExecute() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        vm.prank(stranger);
        vm.expectRevert(CircuitDemoRWAAllocation.Unauthorized.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 0);
    }

    function testOnlyExecutorBoundary() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        vm.prank(stranger);
        vm.expectRevert(CircuitDemoRWAAllocation.Unauthorized.selector);
        alloc.execute(a);
        alloc.execute(a);
        vm.prank(stranger);
        vm.expectRevert(CircuitDemoRWAAllocation.Unauthorized.selector);
        alloc.execute(a);
        assertEq(alloc.executionCount(), 1);
        assertEq(alloc.totalAllocated(), 1e15);
    }

    function testOnlyOwnerRegisters() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitDemoRWAAllocation.Unauthorized.selector);
        alloc.registerAsset(keccak256("x"), keccak256("y"), keccak256("z"), true);
        vm.prank(stranger);
        vm.expectRevert(CircuitDemoRWAAllocation.Unauthorized.selector);
        alloc.registerFund(keccak256("f"));
    }

    function testZeroAmountReverts() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        a.liveAmountWei = 0;
        vm.expectRevert(CircuitDemoRWAAllocation.ZeroAmount.selector);
        alloc.execute(a);
    }

    function testAllocationStateUpdatesExactlyOncePerKey() public {
        CircuitDemoRWAAllocation.Approval memory a1 = freshApproval();
        CircuitDemoRWAAllocation.Approval memory a2 =
            approval(uint64(block.timestamp + 300), ASSET_HASH, PORTFOLIO_HASH, MANDATE_HASH, 1, 1e15, CHAIN, 1011);
        a2.approvalSubId = keccak256("AP-2");
        bytes32 key = keccak256(abi.encode(FUND, ASSET));
        alloc.execute(a1);
        alloc.execute(a2);
        assertEq(alloc.allocatedAmount(key), 2e15);
        assertEq(alloc.executionCount(), 2);
        assertEq(alloc.totalAllocated(), 2e15);
    }

    function testConcurrentStyleBothCallersAtMostOnce() public {
        CircuitDemoRWAAllocation.Approval memory a = freshApproval();
        alloc.execute(a);
        vm.expectRevert(CircuitDemoRWAAllocation.ReplayedApproval.selector);
        alloc.execute(a);
        assertEq(alloc.allocatedAmount(keccak256(abi.encode(FUND, ASSET))), 1e15);
    }
}
