// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CircuitTypes } from "./CircuitTypes.sol";

/// @title CircuitExecutionAdapter
/// @notice Narrow execution adapter that turns an authorized portfolio action
///         into an actual supported X Layer transaction. No generic
///         `call(target, data)` authority: the router must be whitelisted by
///         the owner, the target of any calldata must equal the whitelisted
///         router, assets must be explicitly enabled, and token approvals
///         are exact-amount, never unlimited.
///
/// Venue reality (X Layer Testnet, chainId 1952): the OKX DEX aggregator
/// currently lists exactly one token (native TESTNET_OKB) and returns no
/// swap route (code 51001). Until a supported pair exists, every execute()
/// reverts with UnsupportedRoute and vault capital cannot move — which is
/// the correct fail-closed behavior. The architecture is ready for RWA
/// execution the moment the venue supports it.
contract CircuitExecutionAdapter {
    address public immutable vault;
    address public owner;
    address public okxRouter;

    mapping(bytes32 assetKey => address token) public assetToken;
    mapping(bytes32 assetKey => bool) public executable;

    error Unauthorized();
    error InvalidInput();
    error UnsupportedRoute(bytes32 assetKey);
    error RouterCallFailed();
    error RouterCallFailedWithData(bytes data);
    error SpendMismatch();

    event RouterConfigured(address indexed router);
    event AssetConfigured(bytes32 indexed assetKey, address indexed token, bool executable);

    modifier onlyVault() {
        if (msg.sender != vault) revert Unauthorized();
        _;
    }
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address vault_,
        address owner_
    ) {
        if (vault_ == address(0) || owner_ == address(0)) revert InvalidInput();
        vault = vault_;
        owner = owner_;
    }

    function configureRouter(
        address router
    ) external onlyOwner {
        okxRouter = router;
        emit RouterConfigured(router);
    }

    function configureAsset(
        bytes32 assetKey,
        address token,
        bool enabled
    ) external onlyOwner {
        if (assetKey == bytes32(0) || token == address(0)) revert InvalidInput();
        assetToken[assetKey] = token;
        executable[assetKey] = enabled;
        emit AssetConfigured(assetKey, token, enabled);
    }

    /// @notice Executes the action bundle against the whitelisted OKX DEX
    ///         router. The vault funds the call with the exact sum of signed
    ///         per-action native spend caps; token approvals are
    ///         exact-amount, never unlimited.
    function execute(
        CircuitTypes.Authorization calldata auth,
        CircuitTypes.Action[] calldata actions
    ) external payable onlyVault {
        address router = okxRouter;
        uint256 totalSpend = 0;
        for (uint256 i = 0; i < actions.length; i++) {
            if (actions[i].isBuy) totalSpend += actions[i].maxNativeWei;
        }
        if (msg.value != totalSpend) revert SpendMismatch();

        for (uint256 i = 0; i < actions.length; i++) {
            CircuitTypes.Action calldata action = actions[i];
            if (!executable[action.assetKey]) revert UnsupportedRoute(action.assetKey);
            if (router == address(0)) revert UnsupportedRoute(action.assetKey);

            address token = assetToken[action.assetKey];
            bytes calldata routeCalldata = action.executionCalldata;
            if (routeCalldata.length < 4) revert UnsupportedRoute(action.assetKey);

            bytes4 selector = bytes4(routeCalldata[0]) | (bytes4(routeCalldata[1]) >> 8) | (bytes4(routeCalldata[2]) >> 16)
                | (bytes4(routeCalldata[3]) >> 24);
            if (selector == bytes4(0)) revert UnsupportedRoute(action.assetKey);

            address calldataTarget = address(bytes20(routeCalldata[16:36]));
            if (calldataTarget != router) revert UnsupportedRoute(action.assetKey);

            uint256 spend = action.maxNativeWei;

            if (action.isBuy) {
                (bool ok0, bytes memory data0) = token.call(abi.encodeCall(IERC20.approve, (router, action.notionalUsdE18 / 1e12 + 1)));
                if (!ok0 || (data0.length > 0 && !abi.decode(data0, (bool)))) revert RouterCallFailed();
            }

            (bool ok1, bytes memory result) = router.call{ value: action.isBuy ? spend : 0 }(routeCalldata);
            if (!ok1) revert RouterCallFailedWithData(result);

            uint256 outAmount = abi.decode(result, (uint256));
            if (outAmount == 0) revert RouterCallFailed();
        }
    }
}

interface IERC20 {
    function approve(
        address spender,
        uint256 value
    ) external returns (bool);
}
