// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared types for the Circuit capital layer. Pure type container;
///         never deployed with state or logic.
contract CircuitTypes {
    /// @notice A signed portfolio action. Execution spends at most
    ///         `maxNativeWei` of the vault's native balance (spend cap).
    struct Action {
        bytes32 assetKey;
        bool isBuy;
        uint256 notionalUsdE18;
        uint256 expectedSlippageBps;
        uint256 referenceFreshnessSeconds;
        bool marketSessionClosed;
        bool materialEvent;
        uint256 maxNativeWei;
        bytes executionCalldata;
    }

    /// @notice An offchain authorization object produced by the Circuit
    ///         engine and signed by the authorizer. The vault re-verifies
    ///         every field against live state; a browser-supplied
    ///         `authorized: true` does not exist.
    struct Authorization {
        bytes32 portfolioId;
        uint64 mandateVersion;
        bytes32 portfolioStateHash;
        bytes32 actionsHash;
        bytes32 evaluationHash;
        uint64 expiry;
        uint256 nonce;
        bytes signature;
    }
}
