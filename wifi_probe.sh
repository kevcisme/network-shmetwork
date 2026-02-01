#!/usr/bin/env bash
set -euo pipefail

LOG="/var/log/netdiag/wifi_probe.csv"
IFACE="${IFACE:-wlan0}"
AP_MAP="${AP_MAP:-/etc/netdiag/ap_map.txt}"
TS="$(date -Is)"
HOST="$(hostname)"

# Look up AP name from BSSID using the ap_map file
# Returns "unknown" if not found or file doesn't exist
lookup_ap_name() {
  local bssid="$1"
  [[ -z "$bssid" ]] && echo "" && return
  [[ ! -f "$AP_MAP" ]] && echo "unknown" && return
  # Case-insensitive BSSID match (normalize to lowercase)
  local normalized
  normalized="$(echo "$bssid" | tr '[:upper:]' '[:lower:]')"
  awk -F',' -v bssid="$normalized" '
    BEGIN { IGNORECASE=1 }
    !/^#/ && NF>=2 {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1)
      if (tolower($1) == bssid) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit }
    }
    END { if (!found) print "unknown" }
  ' "$AP_MAP"
}

mkdir -p "$(dirname "$LOG")"
if [[ ! -f "$LOG" ]]; then
  echo "ts,host,iface,ssid,bssid,ap_name,signal_dbm,tx_bitrate,rx_bitrate,tx_retries,tx_failed,rx_drop,chan_busy_pct" >> "$LOG"
fi

# Basic link info
LINK="$(iw dev "$IFACE" link 2>/dev/null || true)"
SSID="$(echo "$LINK" | awk -F': ' '/SSID/ {print $2; exit}')"
BSSID="$(echo "$LINK" | awk -F': ' '/Connected to/ {print $2; exit}')"
SIGNAL="$(echo "$LINK" | awk -F': ' '/signal/ {print $2; exit}' | awk '{print $1}')"
TXBR="$(echo "$LINK" | awk -F': ' '/tx bitrate/ {print $2; exit}')"
RXBR="$(echo "$LINK" | awk -F': ' '/rx bitrate/ {print $2; exit}')"

# Station counters (retries, drops)
TXR="" TXF="" RXD=""
if [[ -n "${BSSID:-}" ]]; then
  STA="$(iw dev "$IFACE" station get "$BSSID" 2>/dev/null || true)"
  TXR="$(echo "$STA" | awk -F': ' '/tx retries/ {print $2; exit}')"
  TXF="$(echo "$STA" | awk -F': ' '/tx failed/ {print $2; exit}')"
  RXD="$(echo "$STA" | awk -F': ' '/rx drop misc/ {print $2; exit}')"
fi

# Channel busy time (rough utilization) from survey dump
BUSY_PCT=""
SURV="$(iw dev "$IFACE" survey dump 2>/dev/null || true)"
# pick the "in use" block
BUSY="$(echo "$SURV" | awk '
  /in use/ {inuse=1}
  inuse && /channel active time/ {active=$4}
  inuse && /channel busy time/ {busy=$4}
  inuse && /noise/ {exit}
  END { if(active>0 && busy>=0) printf "%.0f", (busy/active*100); }')"
BUSY_PCT="${BUSY:-}"

# Look up AP name from BSSID
AP_NAME="$(lookup_ap_name "${BSSID:-}")"

echo "$TS,$HOST,$IFACE,${SSID:-},${BSSID:-},${AP_NAME:-},${SIGNAL:-},\"${TXBR:-}\",\"${RXBR:-}\",${TXR:-},${TXF:-},${RXD:-},${BUSY_PCT:-}" >> "$LOG"
