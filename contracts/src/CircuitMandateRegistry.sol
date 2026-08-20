// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title CircuitMandateRegistry
/// @notice Versioned, authoritative store for the financial mandate and the
///         asset → issuer → sector classification graph used by Circuit's
///         portfolio guard. Only the designated publisher may mutate policy.
/// @dev The registry is deliberately static in structure: no proxy, no selfdestruct.
///      An owner manages authority (publisher / owner rotation); the publisher
///      owns policy content. See SECURITY.md for the trust model.
contract CircuitMandateRegistry {
    /// @notice Storage record for a published mandate.
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

    /// @notice Calldata payload for publishMandate. `exists` is storage-only.
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

    /// @notice Economic classification of a tradable asset.
    struct AssetProfile {
        bytes32 issuerKey;
        bytes32 sectorKey;
        bool enabled;
        bool exists;
    }

    address public owner;
    address public publisher;
    mapping(bytes32 policyKey => Mandate) private mandates;
    mapping(bytes32 assetKey => AssetProfile) private assets;

    error Unauthorized();
    error InvalidAddress();
    error InvalidMandate();
    error InvalidAsset();
    error VersionRegression();
    error MandateNotFound();
    error AssetNotFound();

    event PublisherUpdated(address indexed previousPublisher, address indexed newPublisher);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MandatePublished(bytes32 indexed policyKey, bytes32 indexed mandateHash, uint64 indexed version, uint64 validUntil, bool enabled);
    event MandateEnabledUpdated(bytes32 indexed policyKey, uint64 indexed version, bool enabled);
    event AssetRegistered(bytes32 indexed assetKey, bytes32 indexed issuerKey, bytes32 indexed sectorKey, bool enabled);
    event AssetEnabledUpdated(bytes32 indexed assetKey, bool enabled);

    constructor(
        address initialPublisher
    ) {
        if (initialPublisher == address(0)) revert InvalidAddress();
        owner = msg.sender;
        publisher = initialPublisher;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    modifier onlyPublisher() {
        if (msg.sender != publisher) revert Unauthorized();
        _;
    }

    /// @notice Owner rotates the publisher authority. Immediate effect; no timelock.
    function setPublisher(
        address nextPublisher
    ) external onlyOwner {
        if (nextPublisher == address(0)) revert InvalidAddress();
        address previous = publisher;
        publisher = nextPublisher;
        emit PublisherUpdated(previous, nextPublisher);
    }

    /// @notice Owner rotates ownership. Immediate effect; no timelock.
    function transferOwnership(
        address nextOwner
    ) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidAddress();
        address previous = owner;
        owner = nextOwner;
        emit OwnershipTransferred(previous, nextOwner);
    }

    /// @notice Publisher registers (or re-registers) the issuer/sector classification
    ///         of an asset. Re-registration overwrites the classification.
    function registerAsset(
        bytes32 assetKey,
        bytes32 issuerKey,
        bytes32 sectorKey,
        bool enabled
    ) external onlyPublisher {
        if (assetKey == bytes32(0) || issuerKey == bytes32(0) || sectorKey == bytes32(0)) revert InvalidAsset();
        assets[assetKey] = AssetProfile({ issuerKey: issuerKey, sectorKey: sectorKey, enabled: enabled, exists: true });
        emit AssetRegistered(assetKey, issuerKey, sectorKey, enabled);
    }

    /// @notice Publisher toggles asset eligibility without re-registering.
    function setAssetEnabled(
        bytes32 assetKey,
        bool enabled
    ) external onlyPublisher {
        AssetProfile storage asset = assets[assetKey];
        if (!asset.exists) revert AssetNotFound();
        asset.enabled = enabled;
        emit AssetEnabledUpdated(assetKey, enabled);
    }

    /// @notice Publisher publishes a new mandate version. Versions are strictly
    ///         monotonic per policy key; any regression reverts.
    function publishMandate(
        bytes32 policyKey,
        MandateParams calldata next
    ) external onlyPublisher {
        if (
            policyKey == bytes32(0) || next.mandateHash == bytes32(0) || next.validUntil <= block.timestamp || next.navUsdE18 == 0
                || next.maxAssetExposureBps > 10_000 || next.maxIssuerExposureBps > 10_000 || next.maxSectorExposureBps > 10_000
                || next.maxInvestedBps > 10_000 || next.maxDailyTurnoverBps > 10_000 || next.maxSlippageBps > 10_000
                || next.maxReferenceFreshnessSeconds == 0
        ) revert InvalidMandate();
        Mandate storage current = mandates[policyKey];
        if (current.exists && next.version <= current.version) revert VersionRegression();
        mandates[policyKey] = Mandate({
            mandateHash: next.mandateHash,
            version: next.version,
            validUntil: next.validUntil,
            navUsdE18: next.navUsdE18,
            maxAssetExposureBps: next.maxAssetExposureBps,
            maxIssuerExposureBps: next.maxIssuerExposureBps,
            maxSectorExposureBps: next.maxSectorExposureBps,
            maxInvestedBps: next.maxInvestedBps,
            maxDailyTurnoverBps: next.maxDailyTurnoverBps,
            maxSlippageBps: next.maxSlippageBps,
            maxReferenceFreshnessSeconds: next.maxReferenceFreshnessSeconds,
            closedMarketMaxBuyUsdE18: next.closedMarketMaxBuyUsdE18,
            materialEventMaxBuyUsdE18: next.materialEventMaxBuyUsdE18,
            enabled: next.enabled,
            exists: true
        });
        emit MandatePublished(policyKey, next.mandateHash, next.version, next.validUntil, next.enabled);
    }

    /// @notice Publisher enables/disables an existing mandate without a version bump.
    function setMandateEnabled(
        bytes32 policyKey,
        bool enabled
    ) external onlyPublisher {
        Mandate storage mandate = mandates[policyKey];
        if (!mandate.exists) revert MandateNotFound();
        mandate.enabled = enabled;
        emit MandateEnabledUpdated(policyKey, mandate.version, enabled);
    }

    function getMandate(
        bytes32 policyKey
    ) external view returns (Mandate memory) {
        return mandates[policyKey];
    }

    function getAsset(
        bytes32 assetKey
    ) external view returns (AssetProfile memory) {
        return assets[assetKey];
    }
}
