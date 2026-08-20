#!/usr/bin/env bash
set -euo pipefail
: "${PRIVATE_KEY:?Set PRIVATE_KEY in your shell; never commit it}"
RPC_URL="${XLAYER_TESTNET_RPC:-https://testrpc.xlayer.tech/terigon}"
PUBLISHER="$(cast wallet address --private-key "$PRIVATE_KEY")"
cd "$(dirname "$0")/../contracts"

echo "Deploying CircuitMandateRegistry to X Layer Testnet..."
REGISTRY_OUTPUT="$(forge create src/CircuitMandateRegistry.sol:CircuitMandateRegistry --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --broadcast --constructor-args "$PUBLISHER")"
echo "$REGISTRY_OUTPUT"
REGISTRY="$(printf '%s\n' "$REGISTRY_OUTPUT" | awk '/Deployed to:/{print $3}' | tail -1)"
[ -n "$REGISTRY" ] || { echo "Could not parse registry address" >&2; exit 1; }

echo "Deploying CircuitPortfolioGuard..."
GUARD_OUTPUT="$(forge create src/CircuitPortfolioGuard.sol:CircuitPortfolioGuard --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --broadcast --constructor-args "$REGISTRY")"
echo "$GUARD_OUTPUT"
GUARD="$(printf '%s\n' "$GUARD_OUTPUT" | awk '/Deployed to:/{print $3}' | tail -1)"
[ -n "$GUARD" ] || { echo "Could not parse guard address" >&2; exit 1; }

cat <<OUT

Deployment complete.
export CIRCUIT_MANDATE_REGISTRY=$REGISTRY
export CIRCUIT_PORTFOLIO_GUARD=$GUARD
export XLAYER_TESTNET_RPC=$RPC_URL

Next: export those values and run scripts/prove-xlayer.sh
OUT
