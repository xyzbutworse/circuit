// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal view into CircuitMandateRegistry. Struct layouts MUST mirror
///         the registry exactly; enforced by tests comparing selectors/layouts.
interface ICircuitMandateRegistry {
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

    struct AssetProfile {
        bytes32 issuerKey;
        bytes32 sectorKey;
        bool enabled;
        bool exists;
    }
    function publisher() external view returns (address);
    function getMandate(
        bytes32 policyKey
    ) external view returns (Mandate memory);
    function getAsset(
        bytes32 assetKey
    ) external view returns (AssetProfile memory);
}

/// @title CircuitPortfolioGuard
/// @notice Stateful portfolio-boundary enforcement. Every trade is projected into
///         the portfolio state it would create; the trade is authorized only when
///         that resulting state remains inside the active mandate. This is not a
///         per-transaction spending cap: a trade can be individually plausible and
///         still be rejected for what it would make the portfolio become.
/// @dev Trust model: the publisher supplies per-trade market context (slippage
///      expectation, reference freshness, market-session and material-event flags).
///      Those are offchain facts attested by the publisher; the guard enforces the
///      mandate limits that reference them. See SECURITY.md.
contract CircuitPortfolioGuard {
    // --- denial reasons (machine-readable) ---
    uint8 public constant REASON_OK = 0;
    uint8 public constant REASON_NO_MANDATE = 1;
    uint8 public constant REASON_EXPIRED = 2;
    uint8 public constant REASON_DISABLED = 3;
    uint8 public constant REASON_UNKNOWN_ASSET = 4;
    uint8 public constant REASON_POSITION = 5;
    uint8 public constant REASON_ASSET_EXPOSURE = 6;
    uint8 public constant REASON_ISSUER_EXPOSURE = 7;
    uint8 public constant REASON_SECTOR_EXPOSURE = 8;
    uint8 public constant REASON_INVESTED = 9;
    uint8 public constant REASON_TURNOVER = 10;
    uint8 public constant REASON_CASH = 11;
    uint8 public constant REASON_SLIPPAGE = 12;
    uint8 public constant REASON_REFERENCE_STALE = 13;
    uint8 public constant REASON_CLOSED_MARKET = 14;
    uint8 public constant REASON_MATERIAL_EVENT = 15;

    /// @notice Publisher-attested market facts for a single trade intent.
    struct TradeContext {
        uint256 expectedSlippageBps;
        uint256 referenceFreshnessSeconds;
        bool marketSessionClosed;
        bool materialEvent;
    }

    /// @notice The portfolio state a trade would create.
    struct Projection {
        uint256 assetExposure;
        uint256 issuerExposure;
        uint256 sectorExposure;
        uint256 totalInvested;
        uint256 cashUsd;
        uint256 dailyTurnover;
    }

    ICircuitMandateRegistry public immutable registry;
    mapping(bytes32 policyKey => bool) public seeded;
    mapping(bytes32 policyKey => uint256) public totalInvested;
    mapping(bytes32 policyKey => uint256) public cashUsd;
    mapping(bytes32 policyKey => uint256) public dailyTurnover;
    mapping(bytes32 policyKey => uint64) public turnoverDay;
    mapping(bytes32 policyKey => mapping(bytes32 assetKey => uint256)) public assetExposure;
    mapping(bytes32 policyKey => mapping(bytes32 issuerKey => uint256)) public issuerExposure;
    mapping(bytes32 policyKey => mapping(bytes32 sectorKey => uint256)) public sectorExposure;
    mapping(bytes32 intentHash => bool) public consumedIntent;

    error Unauthorized();
    error InvalidInput();
    error PortfolioAlreadySeeded();
    error IntentAlreadyConsumed();
    error ExecutionDenied(uint8 reason);

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

    constructor(
        address registryAddress
    ) {
        if (registryAddress == address(0)) revert InvalidInput();
        registry = ICircuitMandateRegistry(registryAddress);
    }

    modifier onlyPublisher() {
        if (msg.sender != registry.publisher()) revert Unauthorized();
        _;
    }

    /// @notice Seeds the initial portfolio state for a policy exactly once.
    ///         The seeded state itself must satisfy the published mandate.
    function seedPortfolio(
        bytes32 policyKey,
        bytes32[] calldata assetKeys,
        uint256[] calldata notionals,
        uint256 initialCashUsdE18,
        uint256 turnoverUsdE18
    ) external onlyPublisher {
        if (seeded[policyKey]) revert PortfolioAlreadySeeded();
        if (assetKeys.length != notionals.length) revert InvalidInput();
        ICircuitMandateRegistry.Mandate memory mandate = registry.getMandate(policyKey);
        if (!mandate.exists || !mandate.enabled || block.timestamp >= mandate.validUntil) revert InvalidInput();
        if (initialCashUsdE18 > mandate.navUsdE18) revert InvalidInput();

        uint256 invested;
        for (uint256 i = 0; i < assetKeys.length; i++) {
            if (assetKeys[i] == bytes32(0) || notionals[i] == 0) revert InvalidInput();
            ICircuitMandateRegistry.AssetProfile memory asset = registry.getAsset(assetKeys[i]);
            if (!asset.exists || !asset.enabled) revert ExecutionDenied(REASON_UNKNOWN_ASSET);
            assetExposure[policyKey][assetKeys[i]] += notionals[i];
            issuerExposure[policyKey][asset.issuerKey] += notionals[i];
            sectorExposure[policyKey][asset.sectorKey] += notionals[i];
            invested += notionals[i];
            if (!within(assetExposure[policyKey][assetKeys[i]], mandate.navUsdE18, mandate.maxAssetExposureBps)) {
                revert ExecutionDenied(REASON_ASSET_EXPOSURE);
            }
            if (!within(issuerExposure[policyKey][asset.issuerKey], mandate.navUsdE18, mandate.maxIssuerExposureBps)) {
                revert ExecutionDenied(REASON_ISSUER_EXPOSURE);
            }
            if (!within(sectorExposure[policyKey][asset.sectorKey], mandate.navUsdE18, mandate.maxSectorExposureBps)) {
                revert ExecutionDenied(REASON_SECTOR_EXPOSURE);
            }
        }
        if (!within(invested, mandate.navUsdE18, mandate.maxInvestedBps)) revert ExecutionDenied(REASON_INVESTED);
        if (!within(turnoverUsdE18, mandate.navUsdE18, mandate.maxDailyTurnoverBps)) revert ExecutionDenied(REASON_TURNOVER);
        if (invested + initialCashUsdE18 > mandate.navUsdE18) revert InvalidInput();

        totalInvested[policyKey] = invested;
        cashUsd[policyKey] = initialCashUsdE18;
        dailyTurnover[policyKey] = turnoverUsdE18;
        turnoverDay[policyKey] = currentDay();
        seeded[policyKey] = true;
        emit PortfolioSeeded(policyKey, invested, initialCashUsdE18, turnoverUsdE18, mandate.version);
    }

    function within(
        uint256 exposure,
        uint256 nav,
        uint256 maxBps
    ) internal pure returns (bool) {
        return exposure * 10_000 <= nav * maxBps;
    }

    function currentDay() internal view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }

    /// @notice Deterministic authorization hash binding the chain, the guard, the
    ///         policy, the intent, the governing mandate version and the resulting
    ///         portfolio state.
    function authorizationHashFor(
        bytes32 policyKey,
        bytes32 intentHash,
        bytes32 assetKey,
        bool isBuy,
        uint256 notionalUsdE18,
        ICircuitMandateRegistry.Mandate memory mandate,
        Projection memory p
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                policyKey,
                intentHash,
                mandate.mandateHash,
                mandate.version,
                assetKey,
                isBuy,
                notionalUsdE18,
                p.assetExposure,
                p.issuerExposure,
                p.sectorExposure,
                p.totalInvested,
                p.cashUsd,
                p.dailyTurnover
            )
        );
    }

    /// @notice Projects a trade into the portfolio state it would create and
    ///         evaluates that state against the active mandate. Pure view; never
    ///         mutates state. Reverts only on structurally malformed input.
    function checkTrade(
        bytes32 policyKey,
        bytes32 assetKey,
        bool isBuy,
        uint256 notionalUsdE18,
        TradeContext calldata ctx
    ) public view returns (bool allowed, uint8 reason, Projection memory p, ICircuitMandateRegistry.Mandate memory mandate) {
        if (notionalUsdE18 == 0) revert InvalidInput();
        mandate = registry.getMandate(policyKey);
        if (!mandate.exists) return (false, REASON_NO_MANDATE, p, mandate);
        if (block.timestamp >= mandate.validUntil) return (false, REASON_EXPIRED, p, mandate);
        if (!mandate.enabled) return (false, REASON_DISABLED, p, mandate);
        ICircuitMandateRegistry.AssetProfile memory asset = registry.getAsset(assetKey);
        if (!asset.exists || !asset.enabled) return (false, REASON_UNKNOWN_ASSET, p, mandate);

        if (ctx.expectedSlippageBps > mandate.maxSlippageBps) return (false, REASON_SLIPPAGE, p, mandate);

        uint256 currentAsset = assetExposure[policyKey][assetKey];
        uint256 currentIssuer = issuerExposure[policyKey][asset.issuerKey];
        uint256 currentSector = sectorExposure[policyKey][asset.sectorKey];
        uint256 currentInvested = totalInvested[policyKey];
        uint256 currentCash = cashUsd[policyKey];

        if (isBuy) {
            if (ctx.referenceFreshnessSeconds > mandate.maxReferenceFreshnessSeconds) return (false, REASON_REFERENCE_STALE, p, mandate);
            if (ctx.marketSessionClosed && notionalUsdE18 > mandate.closedMarketMaxBuyUsdE18) {
                return (false, REASON_CLOSED_MARKET, p, mandate);
            }
            if (ctx.materialEvent && notionalUsdE18 > mandate.materialEventMaxBuyUsdE18) return (false, REASON_MATERIAL_EVENT, p, mandate);
            if (notionalUsdE18 > currentCash) return (false, REASON_CASH, p, mandate);
            p.assetExposure = currentAsset + notionalUsdE18;
            p.issuerExposure = currentIssuer + notionalUsdE18;
            p.sectorExposure = currentSector + notionalUsdE18;
            p.totalInvested = currentInvested + notionalUsdE18;
            p.cashUsd = currentCash - notionalUsdE18;
        } else {
            if (notionalUsdE18 > currentAsset) return (false, REASON_POSITION, p, mandate);
            p.assetExposure = currentAsset - notionalUsdE18;
            p.issuerExposure = currentIssuer - notionalUsdE18;
            p.sectorExposure = currentSector - notionalUsdE18;
            p.totalInvested = currentInvested - notionalUsdE18;
            p.cashUsd = currentCash + notionalUsdE18;
        }
        p.dailyTurnover = currentDay() > turnoverDay[policyKey] ? notionalUsdE18 : dailyTurnover[policyKey] + notionalUsdE18;

        if (!within(p.assetExposure, mandate.navUsdE18, mandate.maxAssetExposureBps)) return (false, REASON_ASSET_EXPOSURE, p, mandate);
        if (!within(p.issuerExposure, mandate.navUsdE18, mandate.maxIssuerExposureBps)) return (false, REASON_ISSUER_EXPOSURE, p, mandate);
        if (!within(p.sectorExposure, mandate.navUsdE18, mandate.maxSectorExposureBps)) return (false, REASON_SECTOR_EXPOSURE, p, mandate);
        if (!within(p.totalInvested, mandate.navUsdE18, mandate.maxInvestedBps)) return (false, REASON_INVESTED, p, mandate);
        if (!within(p.dailyTurnover, mandate.navUsdE18, mandate.maxDailyTurnoverBps)) return (false, REASON_TURNOVER, p, mandate);
        return (true, REASON_OK, p, mandate);
    }

    /// @notice Authorizes a trade: projects the next state, reverts on any mandate
    ///         violation (no partial writes), otherwise commits the projected state
    ///         and returns a deterministic authorization hash binding the trade,
    ///         the mandate and the resulting portfolio state.
    function authorizeTrade(
        bytes32 policyKey,
        bytes32 intentHash,
        bytes32 assetKey,
        bool isBuy,
        uint256 notionalUsdE18,
        TradeContext calldata ctx
    ) external onlyPublisher returns (bytes32 authorizationHash) {
        if (intentHash == bytes32(0) || notionalUsdE18 == 0) revert InvalidInput();
        if (consumedIntent[intentHash]) revert IntentAlreadyConsumed();
        (bool allowed, uint8 reason, Projection memory p, ICircuitMandateRegistry.Mandate memory mandate) =
            checkTrade(policyKey, assetKey, isBuy, notionalUsdE18, ctx);
        if (!allowed) revert ExecutionDenied(reason);

        ICircuitMandateRegistry.AssetProfile memory asset = registry.getAsset(assetKey);
        uint64 today = currentDay();
        if (today > turnoverDay[policyKey]) {
            dailyTurnover[policyKey] = notionalUsdE18;
            turnoverDay[policyKey] = today;
        } else {
            dailyTurnover[policyKey] = p.dailyTurnover;
        }
        assetExposure[policyKey][assetKey] = p.assetExposure;
        issuerExposure[policyKey][asset.issuerKey] = p.issuerExposure;
        sectorExposure[policyKey][asset.sectorKey] = p.sectorExposure;
        totalInvested[policyKey] = p.totalInvested;
        cashUsd[policyKey] = p.cashUsd;
        consumedIntent[intentHash] = true;

        emit TradeAuthorized(
            policyKey,
            intentHash,
            assetKey,
            isBuy,
            notionalUsdE18,
            p.assetExposure,
            p.issuerExposure,
            p.sectorExposure,
            p.totalInvested,
            p.cashUsd,
            p.dailyTurnover,
            mandate.version
        );
        return authorizationHashFor(policyKey, intentHash, assetKey, isBuy, notionalUsdE18, mandate, p);
    }
}
