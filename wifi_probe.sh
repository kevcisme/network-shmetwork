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

# Determine band from frequency (MHz)
get_band() {
  local freq="$1"
  [[ -z "$freq" ]] && echo "" && return
  if [[ "$freq" -lt 3000 ]]; then
    echo "2.4GHz"
  elif [[ "$freq" -lt 6000 ]]; then
    echo "5GHz"
  else
    echo "6GHz"
  fi
}

mkdir -p "$(dirname "$LOG")"
if [[ ! -f "$LOG" ]]; then
  echo "ts,host,iface,ssid,bssid,ap_name,signal_dbm,freq_mhz,band,channel,noise_dbm,snr_db,tx_bitrate,rx_bitrate,tx_retries,tx_failed,rx_drop,chan_busy_pct" >> "$LOG"
fi

# Basic link info
LINK="$(iw dev "$IFACE" link 2>/dev/null || true)"
SSID="$(echo "$LINK" | awk -F': ' '/SSID/ {print $2; exit}')"
BSSID="$(echo "$LINK" | awk -F': ' '/Connected to/ {print $2; exit}')"
SIGNAL="$(echo "$LINK" | awk -F': ' '/signal/ {print $2; exit}' | awk '{print $1}')"
TXBR="$(echo "$LINK" | awk -F': ' '/tx bitrate/ {print $2; exit}')"
RXBR="$(echo "$LINK" | awk -F': ' '/rx bitrate/ {print $2; exit}')"

# Frequency and channel info from iw dev info
# Format: "channel 149 (5745 MHz), width: 80 MHz, center1: 5775 MHz"
DEV_INFO="$(iw dev "$IFACE" info 2>/dev/null || true)"
CHANNEL="$(echo "$DEV_INFO" | awk '/channel/ {print $2; exit}')"
# Extract frequency: get the number inside parentheses before "MHz"
FREQ_MHZ="$(echo "$DEV_INFO" | sed -n 's/.*channel [0-9]* (\([0-9]*\) MHz.*/\1/p' | head -1)"
BAND="$(get_band "${FREQ_MHZ:-}")"

# Station counters (retries, drops)
TXR="" TXF="" RXD=""
if [[ -n "${BSSID:-}" ]]; then
  STA="$(iw dev "$IFACE" station get "$BSSID" 2>/dev/null || true)"
  TXR="$(echo "$STA" | awk -F': ' '/tx retries/ {print $2; exit}')"
  TXF="$(echo "$STA" | awk -F': ' '/tx failed/ {print $2; exit}')"
  RXD="$(echo "$STA" | awk -F': ' '/rx drop misc/ {print $2; exit}')"
fi

# Channel busy time and noise floor from survey dump
BUSY_PCT=""
NOISE=""
SURV="$(iw dev "$IFACE" survey dump 2>/dev/null || true)"
# pick the "in use" block - extract busy%, noise
read -r BUSY NOISE_RAW <<< "$(echo "$SURV" | awk '
  /in use/ {inuse=1}
  inuse && /channel active time/ {active=$4}
  inuse && /channel busy time/ {busy=$4}
  inuse && /noise/ {noise=$2; exit}
  END { 
    busy_pct = (active>0 && busy>=0) ? sprintf("%.0f", busy/active*100) : "";
    print busy_pct, noise;
  }')"
BUSY_PCT="${BUSY:-}"
NOISE="${NOISE_RAW:-}"

# Calculate SNR (Signal-to-Noise Ratio) if we have both values
SNR=""
if [[ -n "${SIGNAL:-}" && -n "${NOISE:-}" ]]; then
  # Both should be negative dBm values, SNR = Signal - Noise
  SNR=$((SIGNAL - NOISE))
fi

# Look up AP name from BSSID
AP_NAME="$(lookup_ap_name "${BSSID:-}")"

echo "$TS,$HOST,$IFACE,${SSID:-},${BSSID:-},${AP_NAME:-},${SIGNAL:-},${FREQ_MHZ:-},${BAND:-},${CHANNEL:-},${NOISE:-},${SNR:-},\"${TXBR:-}\",\"${RXBR:-}\",${TXR:-},${TXF:-},${RXD:-},${BUSY_PCT:-}" >> "$LOG"
