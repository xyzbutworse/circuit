// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Read interface of CircuitMandateRegistry (freshness oracle).
interface IMandateReader {
    function getMandate(
        bytes32 policyKey
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
            bool enabled,
            bool exists
        );
}

/// @dev Read interface of CircuitPortfolioVault (portfolio freshness oracle).
interface IPortfolioStateReader {
    function currentStateHash() external view returns (bytes32);
}

/// @title CircuitDemoRWAAllocation
/// @notice Minimal X Layer execution vehicle for CIRCUIT's competition proof.
///         It proves that an approved mandate decision can authorize a real,
///         inspectable on-chain allocation state transition — and that a
///         blocked or stale approval changes nothing.
/// @dev    ACME-INV-8842 is a synthetic competition RWA. This contract does
///         NOT tokenize a real-world receivable. It records allocation into a
///         known asset identity on X Layer Testnet. Live execution amounts are
///         testnet token units, not USD capital.
contract CircuitDemoRWAAllocation {
    error Unauthorized();
    error WrongApprovalChain();
    error WrongExecutionChain();
    error ReplayedApproval();
    error ExpiredApproval();
    error UnknownFund();
    error UnknownAsset();
    error AssetInactive();
    error EconomicStateChanged();
    error MandateChanged();
    error PortfolioStateChanged();
    error ZeroAmount();

    struct Asset {
        bytes32 assetId;
        bytes32 passportHash;
        bytes32 economicStateHash;
        bool active;
    }

    struct Approval {
        bytes32 fundKey;
        bytes32 assetKey;
        bytes32 assetStateHash;
        bytes32 portfolioStateHash;
        bytes32 mandateHash;
        uint64 mandateVersion;
        uint256 economicAmountUsd;
        uint256 liveAmountWei;
        uint64 chainId;
        uint256 nonce;
        uint64 expiry;
        bytes32 approvalSubId;
    }

    struct Allocation {
        bytes32 allocationId;
        bytes32 assetId;
        bytes32 fundId;
        uint256 amount;
        bytes32 approvalHash;
        bool executed;
    }

    /// @dev Schema id binds the on-chain commitment to CIRCUIT's approval layout.
    bytes32 public constant APPROVAL_SCHEMA = 0x0000000000000000000000000000000000000000000000000000000000000001;

    event AssetRegistered(bytes32 indexed assetId, bytes32 passportHash, bytes32 economicStateHash, bool active);
    event FundRegistered(bytes32 indexed fundId);
    event ExecutorChanged(address indexed executor);
    event AllocationExecuted(
        bytes32 indexed allocationId, bytes32 indexed assetId, bytes32 indexed fundId, uint256 amount, bytes32 approvalHash
    );

    address public immutable owner;
    address public executor;
    uint64 public immutable expectedChainId;
    IMandateReader public immutable registry;
    IPortfolioStateReader public immutable vault;

    mapping(bytes32 => Asset) public assets;
    mapping(bytes32 => bool) public registeredFunds;
    mapping(bytes32 => bool) public consumedApprovals;
    mapping(bytes32 => Allocation) public allocations;
    mapping(bytes32 => uint256) public allocatedAmount;
    uint256 public totalAllocated;
    uint256 public executionCount;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert Unauthorized();
        _;
    }

    constructor(
        uint64 expectedChainId_,
        address registry_,
        address vault_
    ) {
        owner = msg.sender;
        expectedChainId = expectedChainId_;
        registry = IMandateReader(registry_);
        vault = IPortfolioStateReader(vault_);
        executor = msg.sender;
    }

    function setExecutor(
        address newExecutor
    ) external onlyOwner {
        executor = newExecutor;
        emit ExecutorChanged(newExecutor);
    }

    /// @dev Registers (or updates) a synthetic RWA identity. economicStateHash is
    ///      the engine's asset-state commitment; any update renders prior
    ///      approvals stale on-chain.
    function registerAsset(
        bytes32 assetId,
        bytes32 passportHash,
        bytes32 economicStateHash,
        bool active
    ) external onlyOwner {
        assets[assetId] = Asset(assetId, passportHash, economicStateHash, active);
        emit AssetRegistered(assetId, passportHash, economicStateHash, active);
    }

    function registerFund(
        bytes32 fundKey
    ) external onlyOwner {
        registeredFunds[fundKey] = true;
        emit FundRegistered(fundKey);
    }

    /// @notice On-chain commitment hash. Must equal the runtime's binding so a
    ///         presented approval is the exact object the engine issued.
    function approvalHashFor(
        Approval calldata approval
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                APPROVAL_SCHEMA,
                approval.fundKey,
                approval.assetKey,
                approval.assetStateHash,
                approval.portfolioStateHash,
                approval.mandateHash,
                approval.mandateVersion,
                approval.economicAmountUsd,
                approval.liveAmountWei,
                approval.chainId,
                approval.nonce,
                approval.expiry,
                approval.approvalSubId
            )
        );
    }

    /// @dev Single entry point. Verifies every commitment against live chain
    ///      state; at most one successful execution per approval hash.
    function execute(
        Approval calldata approval
    ) external onlyExecutor returns (bytes32 allocationId) {
        if (approval.chainId != expectedChainId) revert WrongApprovalChain();
        if (block.chainid != expectedChainId) revert WrongExecutionChain();

        bytes32 ah = approvalHashFor(approval);
        if (consumedApprovals[ah]) revert ReplayedApproval();
        if (block.timestamp > approval.expiry) revert ExpiredApproval();

        if (!registeredFunds[approval.fundKey]) revert UnknownFund();

        Asset storage asset = assets[approval.assetKey];
        if (asset.assetId == bytes32(0)) revert UnknownAsset();
        if (!asset.active) revert AssetInactive();
        if (asset.economicStateHash != approval.assetStateHash) revert EconomicStateChanged();

        (bytes32 mandateHash, uint64 mandateVersion,,,,,,,,,,,,, bool mandateExists) = registry.getMandate(approval.fundKey);
        if (!mandateExists) revert MandateChanged();
        if (mandateHash != approval.mandateHash || mandateVersion != approval.mandateVersion) revert MandateChanged();

        if (vault.currentStateHash() != approval.portfolioStateHash) revert PortfolioStateChanged();

        if (approval.liveAmountWei == 0) revert ZeroAmount();

        consumedApprovals[ah] = true;
        bytes32 key = keccak256(abi.encode(approval.fundKey, approval.assetKey));
        allocatedAmount[key] += approval.liveAmountWei;
        allocationId = keccak256(abi.encode(ah));
        allocations[allocationId] = Allocation(allocationId, approval.assetKey, approval.fundKey, approval.liveAmountWei, ah, true);
        totalAllocated += approval.liveAmountWei;
        executionCount += 1;

        emit AllocationExecuted(allocationId, approval.assetKey, approval.fundKey, approval.liveAmountWei, ah);
    }
}
