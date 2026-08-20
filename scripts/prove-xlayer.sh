#!/usr/bin/env bash
set -euo pipefail
: "${PRIVATE_KEY:?Set PRIVATE_KEY in your shell; never commit it}"
: "${CIRCUIT_MANDATE_REGISTRY:?Set CIRCUIT_MANDATE_REGISTRY}"
: "${CIRCUIT_PORTFOLIO_GUARD:?Set CIRCUIT_PORTFOLIO_GUARD}"
RPC_URL="${XLAYER_TESTNET_RPC:-https://testrpc.xlayer.tech/terigon}"
POLICY="$(cast keccak 'mandate-rwa-alpha-01')"
MANDATE="$(cast keccak 'RWA ALPHA / CONTROLLED')"
TSLA="$(cast keccak 'tslax')"; GOOGL="$(cast keccak 'googlx')"; MSTR="$(cast keccak 'mstrx')"
TESLA="$(cast keccak 'tesla')"; ALPHABET="$(cast keccak 'alphabet')"; STRATEGY="$(cast keccak 'strategy')"
AUTO="$(cast keccak 'automotive')"; TECH="$(cast keccak 'technology')"
VALID_UNTIL="$(($(date +%s)+86400))"
NAV="$(cast to-wei 10000 ether)"
TSLA_1500="$(cast to-wei 1500 ether)"; GOOGL_1500="$(cast to-wei 1500 ether)"; MSTR_500="$(cast to-wei 500 ether)"
CASH="$(cast to-wei 6500 ether)"
TURNOVER="$(cast to-wei 500 ether)"; BAD_BUY="$(cast to-wei 2500 ether)"; GOOD_BUY="$(cast to-wei 1500 ether)"
CLOSED_CAP="$(cast to-wei 1000 ether)"; EVENT_CAP="$(cast to-wei 500 ether)"

send(){ cast send "$@" --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY"; }

echo "1/7 Register the RWA asset → issuer → sector graph"
send "$CIRCUIT_MANDATE_REGISTRY" 'registerAsset(bytes32,bytes32,bytes32,bool)' "$TSLA" "$TESLA" "$AUTO" true
send "$CIRCUIT_MANDATE_REGISTRY" 'registerAsset(bytes32,bytes32,bytes32,bool)' "$GOOGL" "$ALPHABET" "$TECH" true
send "$CIRCUIT_MANDATE_REGISTRY" 'registerAsset(bytes32,bytes32,bytes32,bool)' "$MSTR" "$STRATEGY" "$TECH" true

echo "2/7 Publish the financial mandate (asset 45% / issuer 35% / sector 50% / invested 95% / turnover 70% / slippage 100bps / freshness 1800s / closed-market 1000 / material-event 500)"
send "$CIRCUIT_MANDATE_REGISTRY" \
  'publishMandate(bytes32,(bytes32,uint64,uint64,uint128,uint16,uint16,uint16,uint16,uint16,uint16,uint64,uint128,uint128,bool))' \
  "$POLICY" "($MANDATE,1,$VALID_UNTIL,$NAV,4500,3500,5000,9500,7000,100,1800,$CLOSED_CAP,$EVENT_CAP,true)"

echo "3/7 Seed current portfolio state: TSLAx 1500 / GOOGLx 1500 / MSTRx 500 / cash 6500 / turnover 500"
send "$CIRCUIT_PORTFOLIO_GUARD" \
  'seedPortfolio(bytes32,bytes32[],uint256[],uint256,uint256)' \
  "$POLICY" "[$TSLA,$GOOGL,$MSTR]" "[$TSLA_1500,$GOOGL_1500,$MSTR_500]" "$CASH" "$TURNOVER"

echo "4/7 Prove the individually plausible TSLAx +2500 action is rejected because resulting issuer exposure becomes 40% > 35%"
set +e
send "$CIRCUIT_PORTFOLIO_GUARD" \
  'authorizeTrade(bytes32,bytes32,bytes32,bool,uint256,(uint256,uint256,bool,bool))(bytes32)' \
  "$POLICY" "$(cast keccak 'plan-001:tslax:2500')" "$TSLA" true "$BAD_BUY" "(42,240,false,false)"
BLOCK_EXIT=$?
set -e
if [ "$BLOCK_EXIT" -eq 0 ]; then echo "ERROR: concentrated trade unexpectedly succeeded" >&2; exit 1; fi
echo "Rejected as expected."

echo "5/7 Authorize repaired TSLAx +1500"
send "$CIRCUIT_PORTFOLIO_GUARD" 'authorizeTrade(bytes32,bytes32,bytes32,bool,uint256,(uint256,uint256,bool,bool))(bytes32)' "$POLICY" "$(cast keccak 'plan-002:tslax:1500')" "$TSLA" true "$GOOD_BUY" "(39,240,false,false)"

echo "6/7 Authorize repaired GOOGLx +1500"
send "$CIRCUIT_PORTFOLIO_GUARD" 'authorizeTrade(bytes32,bytes32,bytes32,bool,uint256,(uint256,uint256,bool,bool))(bytes32)' "$POLICY" "$(cast keccak 'plan-002:googlx:1500')" "$GOOGL" true "$GOOD_BUY" "(30,240,false,false)"

echo "7/7 Authorize repaired MSTRx +1500; Technology sector lands exactly at the 50% mandate ceiling"
send "$CIRCUIT_PORTFOLIO_GUARD" 'authorizeTrade(bytes32,bytes32,bytes32,bool,uint256,(uint256,uint256,bool,bool))(bytes32)' "$POLICY" "$(cast keccak 'plan-002:mstrx:1500')" "$MSTR" true "$GOOD_BUY" "(44,240,false,false)"

echo "Circuit proof complete. Capture the failed call evidence plus the three successful X Layer authorization transactions."
