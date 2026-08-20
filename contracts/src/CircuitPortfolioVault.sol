// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { CircuitTypes } from "./CircuitTypes.sol";
import { ICircuitExecutionAdapter, ICircuitMandateRegistry, ICircuitPortfolioGuard } from "./interfaces/ICircuitVaultInterfaces.sol";

/// @title CircuitPortfolioVault
/// @notice Narrow proof-of-concept execution account for capital managed
///         under a Circuit mandate. Capital deposited here can only be
///         moved by the autonomous agent through an authorization that
///         passes the CircuitPortfolioGuard. The owner keeps an emergency
///         withdrawal path; the agent never does.
///
/// Authority model:
///   owner     — deposit, withdraw, publish mandate, pause, replace
///               agent/authorizer/adapter, transfer ownership
///   agent     — submit an already-authorized execution (nothing else)
///   authorizer— offchain Circuit engine that signs Authorization objects
///               after deterministic mandate evaluation
contract CircuitPortfolioVault {
    ICircuitMandateRegistry public immutable registry;
    ICircuitPortfolioGuard public immutable guard;
    bytes32 public immutable portfolioId;

    address public owner;
    address public agent;
    address public authorizer;
    address public adapter;

    bool public paused;
    bytes32[] public portfolioAssets;
    mapping(bytes32 authorizationHash => bool) public consumedAuthorizations;
    mapping(uint256 nonce => bool) public consumedNonces;

    uint256 private _locked = 1;

    error Unauthorized();
    error InvalidInput();
    error Paused();
    error InvalidAuthorization();
    error StaleMandateVersion(uint64 expected, uint64 actual);
    error StalePortfolioState();
    error ActionMismatch();
    error AuthorizationExpired();
    error ReplayedAuthorization();
    error ReusedNonce();
    error InvalidAuthorizationSignature();
    error ExecutionFailed(bytes reason);

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event PausedUpdated(bool paused);
    event OwnerTransferred(address indexed previous, address indexed next);
    event AgentUpdated(address indexed agent);
    event AuthorizerUpdated(address indexed authorizer);
    event AdapterUpdated(address indexed adapter);
    event MandatePublished(bytes32 indexed portfolioId, uint64 indexed version, bytes32 mandateHash);
    event PortfolioSeeded(bytes32 indexed portfolioId, uint256 cashUsdE18, uint256 investedUsdE18);
    event AuthorizationExecuted(bytes32 indexed authorizationHash, uint256 nonce, uint64 mandateVersion, bytes32 evaluationHash);

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant AUTH_TYPEHASH = keccak256(
        "Authorization(bytes32 portfolioId,uint64 mandateVersion,bytes32 portfolioStateHash,bytes32 actionsHash,bytes32 evaluationHash,uint64 expiry,uint256 nonce)"
    );
    bytes32 private constant ACTION_TYPEHASH = keccak256(
        "Action(bytes32 assetKey,bool isBuy,uint256 notionalUsdE18,uint256 expectedSlippageBps,uint256 referenceFreshnessSeconds,bool marketSessionClosed,bool materialEvent,uint256 maxNativeWei,bytes executionCalldata)"
    );
    bytes32 private constant NAME_HASH = keccak256("CircuitPortfolioVault");
    bytes32 private constant VERSION_HASH = keccak256("1");

    constructor(
        address registry_,
        address guard_,
        address owner_,
        bytes32 portfolioId_,
        address agent_,
        address authorizer_
    ) {
        if (
            registry_ == address(0) || guard_ == address(0) || owner_ == address(0) || portfolioId_ == bytes32(0)
                || authorizer_ == address(0)
        ) revert InvalidInput();
        registry = ICircuitMandateRegistry(registry_);
        guard = ICircuitPortfolioGuard(guard_);
        owner = owner_;
        portfolioId = portfolioId_;
        agent = agent_;
        authorizer = authorizer_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    modifier nonReentrant() {
        if (_locked != 1) revert InvalidInput();
        _locked = 2;
        _;
        _locked = 1;
    }

    // ---------------------------------------------------------------- //
    // owner authority
    // ---------------------------------------------------------------- //

    function transferOwnership(
        address next
    ) external onlyOwner {
        if (next == address(0)) revert InvalidInput();
        emit OwnerTransferred(owner, next);
        owner = next;
    }

    function setAgent(
        address next
    ) external onlyOwner {
        agent = next;
        emit AgentUpdated(next);
    }

    function setAuthorizer(
        address next
    ) external onlyOwner {
        if (next == address(0)) revert InvalidInput();
        authorizer = next;
        emit AuthorizerUpdated(next);
    }

    function setAdapter(
        address next
    ) external onlyOwner {
        adapter = next;
        emit AdapterUpdated(next);
    }

    function pause() external onlyOwner {
        paused = true;
        emit PausedUpdated(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedUpdated(false);
    }

    /// @notice Owner registers/toggles the asset → issuer → sector graph for
    ///         this portfolio (the vault is the registry publisher).
    function registerAsset(
        bytes32 assetKey,
        bytes32 issuerKey,
        bytes32 sectorKey,
        bool enabled
    ) external onlyOwner {
        registry.registerAsset(assetKey, issuerKey, sectorKey, enabled);
    }

    /// @notice Publishes the next mandate version for this portfolio.
    ///         The vault must be the registry's publisher (set once at
    ///         deployment); therefore only the owner can change the mandate.
    function publishMandate(
        ICircuitMandateRegistry.MandateParams calldata params
    ) external onlyOwner {
        registry.publishMandate(portfolioId, params);
        emit MandatePublished(portfolioId, params.version, params.mandateHash);
    }

    /// @notice Seeds the guard's portfolio state once. Cash is the USD
    ///         notional of the vault's funded native balance at activation.
    function seedPortfolio(
        bytes32[] calldata assetKeys,
        uint256[] calldata notionals,
        uint256 cashUsdE18,
        uint256 turnoverUsdE18
    ) external onlyOwner {
        guard.seedPortfolio(portfolioId, assetKeys, notionals, cashUsdE18, turnoverUsdE18);
        portfolioAssets = assetKeys;
        uint256 invested = 0;
        for (uint256 i = 0; i < notionals.length; i++) {
            invested += notionals[i];
        }
        emit PortfolioSeeded(portfolioId, cashUsdE18, invested);
    }

    /// @notice Funding. X Layer Testnet's actually supported funded asset is
    ///         native TESTNET_OKB, so deposits are payable native transfers.
    function deposit() external payable {
        if (msg.value == 0) revert InvalidInput();
        emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Owner-only emergency withdrawal / recovery path. The agent
    ///         can never call this.
    function withdraw(
        address token,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidInput();
        if (token == address(0)) {
            (bool ok,) = payable(owner).call{ value: amount }("");
            if (!ok) revert ExecutionFailed("native transfer failed");
        } else {
            (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (owner, amount)));
            if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert ExecutionFailed("token transfer failed");
        }
        emit Withdrawn(token, amount, owner);
    }

    // ---------------------------------------------------------------- //
    // agent authority — the ONLY agent entry point
    // ---------------------------------------------------------------- //

    /// @notice Executes an authorized action bundle. Re-verifies everything
    ///         against live state: mandate version, portfolio state hash,
    ///         action identity, expiry, replay protection and the
    ///         authorizer's EIP-712 signature. Then re-projects every
    ///         action through the CircuitPortfolioGuard before handing the
    ///         bundle to the execution adapter. Any failure reverts the
    ///         whole transaction — capital never moves on a stale or
    ///         non-compliant authorization.
    function executeAuthorizedAction(
        CircuitTypes.Authorization calldata auth,
        CircuitTypes.Action[] calldata actions
    ) external nonReentrant {
        if (msg.sender != agent) revert Unauthorized();
        if (paused) revert Paused();
        if (auth.portfolioId != portfolioId) revert InvalidAuthorization();
        if (actions.length == 0) revert InvalidInput();

        ICircuitMandateRegistry.Mandate memory mandate = registry.getMandate(portfolioId);
        if (!mandate.exists || !mandate.enabled) revert InvalidAuthorization();
        if (auth.mandateVersion != mandate.version) revert StaleMandateVersion(auth.mandateVersion, mandate.version);
        if (block.timestamp >= auth.expiry) revert AuthorizationExpired();

        bytes32 authorizationHash = hashAuthorization(auth);
        if (recoverSigner(auth, authorizationHash) != authorizer) revert InvalidAuthorizationSignature();
        if (consumedAuthorizations[authorizationHash]) revert ReplayedAuthorization();
        if (consumedNonces[auth.nonce]) revert ReusedNonce();

        if (auth.portfolioStateHash != currentStateHash()) revert StalePortfolioState();
        if (auth.actionsHash != keccak256(abi.encode(actions))) revert ActionMismatch();

        consumedAuthorizations[authorizationHash] = true;
        consumedNonces[auth.nonce] = true;

        for (uint256 i = 0; i < actions.length; i++) {
            CircuitTypes.Action calldata action = actions[i];
            guard.authorizeTrade(
                portfolioId,
                keccak256(abi.encode(authorizationHash, i)),
                action.assetKey,
                action.isBuy,
                action.notionalUsdE18,
                ICircuitPortfolioGuard.TradeContext({
                    expectedSlippageBps: action.expectedSlippageBps,
                    referenceFreshnessSeconds: action.referenceFreshnessSeconds,
                    marketSessionClosed: action.marketSessionClosed,
                    materialEvent: action.materialEvent
                })
            );
        }

        address adapter_ = adapter;
        if (adapter_ != address(0)) {
            uint256 totalSpend = 0;
            for (uint256 i = 0; i < actions.length; i++) {
                if (actions[i].isBuy) totalSpend += actions[i].maxNativeWei;
            }
            if (totalSpend > address(this).balance) revert ExecutionFailed("insufficient vault balance for signed spend");
            ICircuitExecutionAdapter(adapter_).execute{ value: totalSpend }(auth, actions);
        }

        emit AuthorizationExecuted(authorizationHash, auth.nonce, mandate.version, auth.evaluationHash);
    }

    // ---------------------------------------------------------------- //
    // state & authorization primitives (public for verification)
    // ---------------------------------------------------------------- //

    function currentStateHash() public view returns (bytes32) {
        uint256[] memory exposures = new uint256[](portfolioAssets.length);
        for (uint256 i = 0; i < portfolioAssets.length; i++) {
            exposures[i] = guard.assetExposure(portfolioId, portfolioAssets[i]);
        }
        return keccak256(
            abi.encode(
                portfolioId,
                guard.seeded(portfolioId),
                guard.totalInvested(portfolioId),
                guard.cashUsd(portfolioId),
                guard.dailyTurnover(portfolioId),
                portfolioAssets,
                exposures
            )
        );
    }

    function hashAuthorization(
        CircuitTypes.Authorization calldata auth
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                AUTH_TYPEHASH,
                auth.portfolioId,
                auth.mandateVersion,
                auth.portfolioStateHash,
                auth.actionsHash,
                auth.evaluationHash,
                auth.expiry,
                auth.nonce
            )
        );
    }

    function recoverSigner(
        CircuitTypes.Authorization calldata auth,
        bytes32 authorizationHash
    ) internal view returns (address) {
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, authorizationHash));
        bytes calldata signature = auth.signature;
        if (signature.length != 65) revert InvalidAuthorizationSignature();
        uint8 v = uint8(signature[64]);
        bytes32 r;
        bytes32 s;
        assembly ("memory-safe") {
            r := calldataload(add(signature.offset, 0))
            s := calldataload(add(signature.offset, 32))
        }
        if (v < 27) v += 27;
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidAuthorizationSignature();
        return signer;
    }
}

interface IERC20 {
    function transfer(
        address to,
        uint256 value
    ) external returns (bool);
}
