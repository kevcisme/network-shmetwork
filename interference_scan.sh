#!/usr/bin/env bash
# interference_scan.sh - Scan for neighboring WiFi networks and channel interference
# Helps identify congested channels and interference sources
set -euo pipefail

LOG="/var/log/netdiag/interference_scan.csv"
IFACE="${IFACE:-wlan0}"
TS="$(date -Is)"
HOST="$(hostname)"

# Get current connection info for comparison
CURRENT_SSID=""
CURRENT_FREQ=""
LINK="$(iw dev "$IFACE" link 2>/dev/null || true)"
if [[ -n "$LINK" ]]; then
  CURRENT_SSID="$(echo "$LINK" | awk -F': ' '/SSID/ {print $2; exit}')"
fi
DEV_INFO="$(iw dev "$IFACE" info 2>/dev/null || true)"
if [[ -n "$DEV_INFO" ]]; then
  CURRENT_FREQ="$(echo "$DEV_INFO" | awk '/channel/ {gsub(/[()]/, ""); for(i=1;i<=NF;i++) if($i ~ /^[0-9]+$/ && $i > 100) print $i; exit}')"
fi

# Determine band from frequency
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

# Get channel from frequency for 2.4GHz
get_24ghz_channel() {
  local freq="$1"
  [[ -z "$freq" ]] && echo "" && return
  case "$freq" in
    2412) echo "1" ;;
    2417) echo "2" ;;
    2422) echo "3" ;;
    2427) echo "4" ;;
    2432) echo "5" ;;
    2437) echo "6" ;;
    2442) echo "7" ;;
    2447) echo "8" ;;
    2452) echo "9" ;;
    2457) echo "10" ;;
    2462) echo "11" ;;
    2467) echo "12" ;;
    2472) echo "13" ;;
    *) echo "" ;;
  esac
}

mkdir -p "$(dirname "$LOG")"

# Write header if file doesn't exist
if [[ ! -f "$LOG" ]]; then
  echo "ts,host,iface,ssid,bssid,signal_dbm,freq_mhz,band,channel,is_own_network,channel_overlap" >> "$LOG"
fi

# Perform WiFi scan (may require root)
SCAN_OUTPUT="$(iw dev "$IFACE" scan 2>/dev/null || sudo iw dev "$IFACE" scan 2>/dev/null || true)"

if [[ -z "$SCAN_OUTPUT" ]]; then
  echo "Warning: Could not perform WiFi scan (may need root)" >&2
  exit 0
fi

# Parse scan results and output to CSV
echo "$SCAN_OUTPUT" | awk -v ts="$TS" -v host="$HOST" -v iface="$IFACE" \
  -v own_ssid="$CURRENT_SSID" -v own_freq="$CURRENT_FREQ" '
BEGIN {
  FS=": "
  OFS=","
}

/^BSS / {
  # Print previous AP if we have one
  if (bssid != "") {
    # Determine if this is our network
    is_own = (ssid == own_ssid) ? "1" : "0"
    
    # Check for channel overlap (within 5 channels on 2.4GHz)
    overlap = "0"
    if (own_freq != "" && freq != "") {
      freq_diff = (freq > own_freq) ? freq - own_freq : own_freq - freq
      # 2.4GHz channels are 5MHz apart, overlap if within 25MHz (5 channels)
      if (freq < 3000 && own_freq < 3000 && freq_diff <= 25 && freq_diff > 0) {
        overlap = "1"
      }
      # Same channel
      if (freq == own_freq) {
        overlap = "1"
      }
    }
    
    # Determine band
    band = ""
    if (freq != "") {
      if (freq < 3000) band = "2.4GHz"
      else if (freq < 6000) band = "5GHz"
      else band = "6GHz"
    }
    
    print ts, host, iface, ssid, bssid, signal, freq, band, channel, is_own, overlap
  }
  
  # Start new AP
  bssid = $1
  gsub(/BSS /, "", bssid)
  gsub(/\(.*/, "", bssid)
  gsub(/[[:space:]]/, "", bssid)
  ssid = ""
  signal = ""
  freq = ""
  channel = ""
}

/signal:/ {
  signal = $2
  gsub(/ dBm.*/, "", signal)
}

/freq:/ {
  freq = $2
}

/primary channel:/ {
  channel = $2
}

/SSID:/ {
  ssid = $2
}

END {
  # Print last AP
  if (bssid != "") {
    is_own = (ssid == own_ssid) ? "1" : "0"
    overlap = "0"
    if (own_freq != "" && freq != "") {
      freq_diff = (freq > own_freq) ? freq - own_freq : own_freq - freq
      if (freq < 3000 && own_freq < 3000 && freq_diff <= 25 && freq_diff > 0) {
        overlap = "1"
      }
      if (freq == own_freq) {
        overlap = "1"
      }
    }
    band = ""
    if (freq != "") {
      if (freq < 3000) band = "2.4GHz"
      else if (freq < 6000) band = "5GHz"
      else band = "6GHz"
    }
    print ts, host, iface, ssid, bssid, signal, freq, band, channel, is_own, overlap
  }
}
' >> "$LOG"

# Generate summary to stdout
TOTAL="$(tail -n +2 "$LOG" | grep "^$TS" | wc -l)"
NEIGHBORS="$(tail -n +2 "$LOG" | grep "^$TS" | awk -F',' '$10=="0"' | wc -l)"
OVERLAPPING="$(tail -n +2 "$LOG" | grep "^$TS" | awk -F',' '$11=="1" && $10=="0"' | wc -l)"
SAME_CHANNEL="$(tail -n +2 "$LOG" | grep "^$TS" | awk -F',' -v freq="$CURRENT_FREQ" '$7==freq && $10=="0"' | wc -l)"

echo "Interference scan complete on $HOST:"
echo "  Total networks: $TOTAL"
echo "  Neighbor networks: $NEIGHBORS"
echo "  Overlapping channels: $OVERLAPPING"
echo "  Same channel as us: $SAME_CHANNEL"

# Log summary as JSON for analytics
SUMMARY_LOG="/var/log/netdiag/interference_summary.jsonl"
printf '{"ts":"%s","host":"%s","total_networks":%d,"neighbor_networks":%d,"overlapping":%d,"same_channel":%d,"current_freq":%s}\n' \
  "$TS" "$HOST" "$TOTAL" "$NEIGHBORS" "$OVERLAPPING" "$SAME_CHANNEL" "${CURRENT_FREQ:-null}" >> "$SUMMARY_LOG"
