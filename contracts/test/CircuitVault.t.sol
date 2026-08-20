// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CircuitExecutionAdapter } from "../src/CircuitExecutionAdapter.sol";
import { CircuitMandateRegistry } from "../src/CircuitMandateRegistry.sol";
import { CircuitPortfolioGuard } from "../src/CircuitPortfolioGuard.sol";
import { CircuitPortfolioVault } from "../src/CircuitPortfolioVault.sol";
import { CircuitTypes } from "../src/CircuitTypes.sol";
import { ICircuitExecutionAdapter, ICircuitMandateRegistry, ICircuitPortfolioGuard } from "../src/interfaces/ICircuitVaultInterfaces.sol";
import { Test } from "forge-std/Test.sol";

contract MockRouter {
    uint256 public receivedValue;
    bytes public lastCalldata;

    fallback(
        bytes calldata
    ) external payable returns (bytes memory) {
        receivedValue = msg.value;
        lastCalldata = msg.data;
        return abi.encode(uint256(1));
    }
    receive() external payable { }
}

contract MockToken {
    address public lastSpender;
    uint256 public lastApproveAmount;
    bool approveFails;

    function setApproveFails(
        bool v
    ) external {
        approveFails = v;
    }

    function approve(
        address spender,
        uint256 amount
    ) external returns (bool) {
        if (approveFails) return false;
        lastSpender = spender;
        lastApproveAmount = amount;
        return true;
    }

    function transfer(
        address,
        uint256
    ) external pure returns (bool) {
        return true;
    }
}

contract MockAdapter is ICircuitExecutionAdapter {
    CircuitPortfolioVault public vault;
    uint256 public executions;

    constructor(
        address vault_
    ) {
        vault = CircuitPortfolioVault(payable(vault_));
    }

    function execute(
        CircuitTypes.Authorization calldata,
        CircuitTypes.Action[] calldata
    ) external payable {
        executions += 1;
    }
}

contract ReentrantAdapter is ICircuitExecutionAdapter {
    CircuitPortfolioVault public vault;
    CircuitTypes.Authorization reAuth;
    CircuitTypes.Action[] reActions;

    constructor(
        address vault_
    ) {
        vault = CircuitPortfolioVault(payable(vault_));
    }

    function configure(
        CircuitTypes.Authorization calldata a,
        CircuitTypes.Action[] calldata acts
    ) external {
        reAuth = a;
        reActions = acts;
    }

    function execute(
        CircuitTypes.Authorization calldata,
        CircuitTypes.Action[] calldata
    ) external payable {
        vault.executeAuthorizedAction(reAuth, reActions);
    }
}

contract CircuitVaultTest is Test {
    CircuitMandateRegistry internal registry;
    CircuitPortfolioGuard internal guard;
    CircuitPortfolioVault internal vault;
    CircuitExecutionAdapter internal adapter;
    MockRouter internal router;
    MockToken internal token;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal stranger = makeAddr("stranger");
    uint256 internal authorizerPk = 0xA11CE;
    address internal authorizer = vm.addr(authorizerPk);

    bytes32 internal constant PORTFOLIO = keccak256("portfolio-alpha-01");
    bytes32 internal constant MANDATE_HASH = keccak256("RWA ALPHA / CONTROLLED");
    bytes32 internal constant TSLA = keccak256("tslax");
    bytes32 internal constant TESLA = keccak256("tesla");
    bytes32 internal constant AUTO = keccak256("automotive");
    bytes32 internal constant NATIVE = keccak256("native-okb");

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event PausedUpdated(bool paused);
    event AuthorizationExecuted(bytes32 indexed authorizationHash, uint256 nonce, uint64 mandateVersion, bytes32 evaluationHash);
    event MandatePublished(bytes32 indexed portfolioId, uint64 indexed version, bytes32 mandateHash);
    event AssetConfigured(bytes32 indexed assetKey, address indexed token, bool executable);

    function setUp() public virtual {
        registry = new CircuitMandateRegistry(address(this));
        guard = new CircuitPortfolioGuard(address(registry));
        vault = new CircuitPortfolioVault(address(registry), address(guard), owner, PORTFOLIO, agent, authorizer);
        adapter = new CircuitExecutionAdapter(address(vault), owner);
        router = new MockRouter();
        token = new MockToken();
        registry.setPublisher(address(vault));

        vm.startPrank(owner);
        vault.setAdapter(address(adapter));
        vault.registerAsset(TSLA, TESLA, AUTO, true);
        vault.publishMandate(mandateParams(1, true));
        bytes32[] memory assets = new bytes32[](1);
        assets[0] = TSLA;
        uint256[] memory notional = new uint256[](1);
        notional[0] = 1_500 ether;
        vault.seedPortfolio(assets, notional, 6_500 ether, 500 ether);
        adapter.configureRouter(address(router));
        adapter.configureAsset(TSLA, address(token), true);
        vm.stopPrank();
        vm.deal(address(vault), 100 ether);
        assertTrue(adapter.executable(TSLA), "asset must be executable after config");
        assertEq(adapter.okxRouter(), address(router), "router must be configured");
    }

    function mandateParams(
        uint64 version,
        bool enabled
    ) internal view returns (ICircuitMandateRegistry.MandateParams memory) {
        return ICircuitMandateRegistry.MandateParams({
            mandateHash: MANDATE_HASH,
            version: version,
            validUntil: uint64(block.timestamp + 365 days),
            navUsdE18: uint128(10_000 ether),
            maxAssetExposureBps: 4_500,
            maxIssuerExposureBps: 3_500,
            maxSectorExposureBps: 5_000,
            maxInvestedBps: 9_500,
            maxDailyTurnoverBps: 7_000,
            maxSlippageBps: 100,
            maxReferenceFreshnessSeconds: 1_800,
            closedMarketMaxBuyUsdE18: uint128(1_000 ether),
            materialEventMaxBuyUsdE18: uint128(500 ether),
            enabled: enabled
        });
    }

    function action(
        bytes32 assetKey,
        bool isBuy,
        uint256 notional,
        uint256 maxWei
    ) internal pure returns (CircuitTypes.Action memory) {
        return CircuitTypes.Action({
            assetKey: assetKey,
            isBuy: isBuy,
            notionalUsdE18: notional,
            expectedSlippageBps: 39,
            referenceFreshnessSeconds: 240,
            marketSessionClosed: false,
            materialEvent: false,
            maxNativeWei: maxWei,
            executionCalldata: hex""
        });
    }

    function signedAuth(
        CircuitTypes.Action[] memory acts,
        uint64 mandateVersion,
        uint256 nonce,
        uint64 expiry
    ) internal view returns (CircuitTypes.Authorization memory) {
        CircuitTypes.Authorization memory auth = buildAuth(acts, mandateVersion, nonce, expiry, keccak256("evaluation-1"));
        signAuth(auth);
        return auth;
    }

    function buildAuth(
        CircuitTypes.Action[] memory acts,
        uint64 mandateVersion,
        uint256 nonce,
        uint64 expiry,
        bytes32 evaluationHash
    ) internal view returns (CircuitTypes.Authorization memory) {
        return CircuitTypes.Authorization({
            portfolioId: PORTFOLIO,
            mandateVersion: mandateVersion,
            portfolioStateHash: vault.currentStateHash(),
            actionsHash: keccak256(abi.encode(acts)),
            evaluationHash: evaluationHash,
            expiry: expiry == 0 ? uint64(block.timestamp + 10 minutes) : expiry,
            nonce: nonce,
            signature: hex""
        });
    }

    function signAuth(
        CircuitTypes.Authorization memory auth
    ) internal view {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Authorization(bytes32 portfolioId,uint64 mandateVersion,bytes32 portfolioStateHash,bytes32 actionsHash,bytes32 evaluationHash,uint64 expiry,uint256 nonce)"
                ),
                auth.portfolioId,
                auth.mandateVersion,
                auth.portfolioStateHash,
                auth.actionsHash,
                auth.evaluationHash,
                auth.expiry,
                auth.nonce
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("CircuitPortfolioVault"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(authorizerPk, digest);
        auth.signature = abi.encodePacked(r, s, v);
    }

    function compliantActions() internal pure returns (CircuitTypes.Action[] memory) {
        CircuitTypes.Action[] memory acts = new CircuitTypes.Action[](1);
        acts[0] = action(TSLA, true, 1_500 ether, 1 ether);
        return acts;
    }

    function routeCalldata() internal view returns (bytes memory) {
        return abi.encodePacked(bytes4(keccak256("swapExactNative(bytes,address)")) & bytes4(0xffffffff), uint256(uint160(address(router))));
    }

    function execCalldata() internal view returns (CircuitTypes.Action[] memory) {
        CircuitTypes.Action[] memory acts = compliantActions();
        acts[0].executionCalldata = routeCalldata();
        acts[0].maxNativeWei = 0.5 ether;
        return acts;
    }

    // ---------------------------------------------------------------- //
    // owner authority / deposits & withdrawals
    // ---------------------------------------------------------------- //

    function testOwnerCanDepositAndWithdraw() public {
        vm.deal(owner, 5 ether);
        vm.prank(owner);
        vault.deposit{ value: 2 ether }();
        assertEq(address(vault).balance, 102 ether);
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(address(0), 2 ether, owner);
        vm.prank(owner);
        vault.withdraw(address(0), 2 ether);
        assertEq(address(vault).balance, 100 ether);
        assertEq(owner.balance, 5 ether);
    }

    function testNonOwnerCannotWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.withdraw(address(0), 1 ether);
    }

    function testAgentCannotWithdraw() public {
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.withdraw(address(0), 1 ether);
    }

    function testOwnerEmergencyWithdrawAfterPause() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(owner);
        vault.withdraw(address(0), 100 ether);
        assertEq(address(vault).balance, 0);
    }

    function testAgentCannotPauseOrChangeAuthority() public {
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.setAgent(stranger);
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.setAdapter(stranger);
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.setAuthorizer(stranger);
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.transferOwnership(stranger);
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.publishMandate(mandateParams(2, true));
    }

    function testOnlyOwnerPublishesMandateAndPublishingBumpsVersion() public {
        vm.prank(stranger);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.publishMandate(mandateParams(2, true));
        vm.expectEmit(true, true, false, true);
        emit MandatePublished(PORTFOLIO, 2, MANDATE_HASH);
        vm.prank(owner);
        vault.publishMandate(mandateParams(2, true));
        assertEq(registry.getMandate(PORTFOLIO).version, 2);
    }

    // ---------------------------------------------------------------- //
    // authorization security matrix
    // ---------------------------------------------------------------- //

    function testExecutionWithoutValidSignatureFails() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        auth.signature = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(1)), uint8(27)); // garbage
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.InvalidAuthorizationSignature.selector);
        vault.executeAuthorizedAction(auth, acts);
    }

    function testExecutionWithoutAuthorizationAtAllFails() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.prank(stranger);
        vm.expectRevert(CircuitPortfolioVault.Unauthorized.selector);
        vault.executeAuthorizedAction(auth, acts);
    }

    function testWrongMandateVersionFails() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 2, 1, 0);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(CircuitPortfolioVault.StaleMandateVersion.selector, 2, 1));
        vault.executeAuthorizedAction(auth, acts);
    }

    function testMandateChangeInvalidatesPriorAuthorization() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.prank(owner);
        vault.publishMandate(mandateParams(2, true));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(CircuitPortfolioVault.StaleMandateVersion.selector, 1, 2));
        vault.executeAuthorizedAction(auth, acts);
    }

    function testPortfolioStateChangeInvalidatesPriorAuthorization() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        CircuitTypes.Action[] memory first = execCalldata();
        CircuitTypes.Authorization memory authFirst = signedAuth(first, 1, 7, 0);
        vm.prank(agent);
        vault.executeAuthorizedAction(authFirst, first);
        // guard state advanced → old state hash is stale
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.StalePortfolioState.selector);
        vault.executeAuthorizedAction(auth, acts);
    }

    function testExpiredAuthorizationFails() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, uint64(block.timestamp + 5));
        vm.warp(block.timestamp + 10);
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.AuthorizationExpired.selector);
        vault.executeAuthorizedAction(auth, acts);
    }

    function testReplayedAuthorizationFails() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.startPrank(agent);
        vault.executeAuthorizedAction(auth, acts);
        vm.expectRevert(CircuitPortfolioVault.ReplayedAuthorization.selector);
        vault.executeAuthorizedAction(auth, acts);
        vm.stopPrank();
    }

    function testReusedNonceFails() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory first = signedAuth(acts, 1, 42, 0);
        CircuitTypes.Authorization memory second = buildAuth(acts, 1, 42, 0, keccak256("evaluation-2"));
        signAuth(second);
        vm.prank(agent);
        vault.executeAuthorizedAction(first, acts);
        assertTrue(vault.consumedNonces(42), "nonce must be consumed");
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.ReusedNonce.selector);
        vault.executeAuthorizedAction(second, acts);
    }

    function testModifiedActionAfterAuthorizationFails() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        CircuitTypes.Action[] memory tampered = execCalldata();
        tampered[0].notionalUsdE18 = 2_000 ether;
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.ActionMismatch.selector);
        vault.executeAuthorizedAction(auth, tampered);
    }

    function testPausedVaultRejectsExecution() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.Paused.selector);
        vault.executeAuthorizedAction(auth, acts);
    }

    function testUnpausedVaultAcceptsExecution() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.prank(owner);
        vault.pause();
        vm.prank(owner);
        vault.unpause();
        vm.prank(agent);
        vault.executeAuthorizedAction(auth, acts);
        assertTrue(vault.consumedAuthorizations(vault.hashAuthorization(auth)));
    }

    function testBlockedPlanCannotExecute() public {
        CircuitTypes.Action[] memory acts = new CircuitTypes.Action[](1);
        acts[0] = action(TSLA, true, 2_500 ether, 1 ether);
        acts[0].executionCalldata = routeCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        uint8 reason = guard.REASON_ISSUER_EXPOSURE();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(CircuitPortfolioGuard.ExecutionDenied.selector, reason));
        vault.executeAuthorizedAction(auth, acts);
        assertEq(address(vault).balance, 100 ether, "blocked execution must not move capital");
    }

    function testSlippageBeyondMandateFails() public {
        CircuitTypes.Action[] memory acts = new CircuitTypes.Action[](1);
        acts[0] = action(TSLA, true, 1_000 ether, 1 ether);
        acts[0].expectedSlippageBps = 101;
        acts[0].executionCalldata = routeCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        uint8 reason = guard.REASON_SLIPPAGE();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(CircuitPortfolioGuard.ExecutionDenied.selector, reason));
        vault.executeAuthorizedAction(auth, acts);
    }

    function testUnsupportedAssetFails() public {
        CircuitTypes.Action[] memory acts = new CircuitTypes.Action[](1);
        acts[0] = action(keccak256("nvdlax"), true, 1_000 ether, 1 ether);
        acts[0].executionCalldata = routeCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        uint8 reason = guard.REASON_UNKNOWN_ASSET();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(CircuitPortfolioGuard.ExecutionDenied.selector, reason));
        vault.executeAuthorizedAction(auth, acts);
    }

    function testUnsupportedRouterFails() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.prank(owner);
        adapter.configureRouter(address(0));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(CircuitExecutionAdapter.UnsupportedRoute.selector, TSLA));
        vault.executeAuthorizedAction(auth, acts);
    }

    function testCalldataTargetMustEqualWhitelistedRouter() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        acts[0].executionCalldata =
            abi.encodePacked(bytes4(keccak256("swapExactNative(bytes,address)")) & bytes4(0xffffffff), uint256(uint160(address(stranger))));
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(CircuitExecutionAdapter.UnsupportedRoute.selector, TSLA));
        vault.executeAuthorizedAction(auth, acts);
    }

    function testApprovalIsExactNotUnlimited() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.prank(agent);
        vault.executeAuthorizedAction(auth, acts);
        assertEq(token.lastSpender(), address(router), "approval must target the whitelisted router");
        assertLt(token.lastApproveAmount(), type(uint256).max, "approval must never be unlimited");
    }

    function testApprovalFailureReverts() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        token.setApproveFails(true);
        CircuitTypes.Authorization memory preAuth = auth;
        vm.prank(agent);
        vm.expectRevert(CircuitExecutionAdapter.RouterCallFailed.selector);
        vault.executeAuthorizedAction(preAuth, acts);
    }

    function testStaleRouteZeroOutputReverts() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        vm.mockCall(address(router), acts[0].executionCalldata, abi.encode(uint256(0)));
        vm.prank(agent);
        vm.expectRevert(CircuitExecutionAdapter.RouterCallFailed.selector);
        vault.executeAuthorizedAction(auth, acts);
        assertEq(address(vault).balance, 100 ether, "failed route must not move capital");
    }

    function testReentrantAdapterBlocked() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 1, 0);
        ReentrantAdapter evil = new ReentrantAdapter(address(vault));
        evil.configure(auth, acts);
        vm.prank(owner);
        vault.setAdapter(address(evil));
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioVault.InvalidInput.selector);
        vault.executeAuthorizedAction(auth, acts);
    }

    function testCompliantAuthorizationExecutesAndMovesState() public {
        CircuitTypes.Action[] memory acts = execCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 5, 0);
        vm.expectEmit(true, false, false, true);
        emit AuthorizationExecuted(vault.hashAuthorization(auth), 5, 1, keccak256("evaluation-1"));
        vm.prank(agent);
        vault.executeAuthorizedAction(auth, acts);
        assertEq(guard.assetExposure(PORTFOLIO, TSLA), 3_000 ether, "guard state must advance");
        assertEq(guard.cashUsd(PORTFOLIO), 5_000 ether);
        assertEq(router.receivedValue(), 0.5 ether, "router must receive exactly the capped spend");
        assertEq(address(vault).balance, 99.5 ether);
        assertTrue(vault.consumedNonces(5));
    }

    function testSellIsSupportedThroughGuard() public {
        CircuitTypes.Action[] memory acts = new CircuitTypes.Action[](1);
        acts[0] = action(TSLA, false, 500 ether, 0);
        acts[0].executionCalldata = routeCalldata();
        CircuitTypes.Authorization memory auth = signedAuth(acts, 1, 9, 0);
        vm.prank(agent);
        vault.executeAuthorizedAction(auth, acts);
        assertEq(guard.assetExposure(PORTFOLIO, TSLA), 1_000 ether);
        assertEq(guard.cashUsd(PORTFOLIO), 7_000 ether);
    }

    function testAgentCannotExecuteDirectGuardCalls() public {
        vm.prank(agent);
        vm.expectRevert(CircuitPortfolioGuard.Unauthorized.selector);
        guard.authorizeTrade(
            PORTFOLIO,
            keccak256("direct"),
            TSLA,
            true,
            1 ether,
            CircuitPortfolioGuard.TradeContext({
                expectedSlippageBps: 0, referenceFreshnessSeconds: 0, marketSessionClosed: false, materialEvent: false
            })
        );
    }

    function testSeedOnceOnly() public {
        bytes32[] memory assets = new bytes32[](1);
        assets[0] = TSLA;
        uint256[] memory notional = new uint256[](1);
        notional[0] = 1 ether;
        vm.prank(owner);
        vm.expectRevert(CircuitPortfolioGuard.PortfolioAlreadySeeded.selector);
        vault.seedPortfolio(assets, notional, 1 ether, 0);
    }
}
