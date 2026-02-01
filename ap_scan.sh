#!/usr/bin/env bash
# ap_scan.sh - Scan all visible WiFi APs and their signal strengths
# Helps identify: which APs are reachable from each location, potential roaming targets
set -euo pipefail

LOG="/var/log/netdiag/ap_scan.csv"
IFACE="${IFACE:-wlan0}"
AP_MAP="${AP_MAP:-/etc/netdiag/ap_map.txt}"
TS="$(date -Is)"
HOST="$(hostname)"

# Look up AP name from BSSID (same as wifi_probe.sh)
lookup_ap_name() {
  local bssid="$1"
  [[ -z "$bssid" ]] && echo "" && return
  [[ ! -f "$AP_MAP" ]] && echo "unknown" && return
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

# Get currently connected BSSID for comparison
CONNECTED_BSSID="$(iw dev "$IFACE" link 2>/dev/null | awk '/Connected to/ {print $3}' || true)"

mkdir -p "$(dirname "$LOG")"

# Write header if file doesn't exist
if [[ ! -f "$LOG" ]]; then
  echo "ts,host,iface,bssid,ap_name,ssid,signal_dbm,frequency_mhz,channel,is_connected" >> "$LOG"
fi

# Perform scan (requires root or appropriate capabilities)
# Note: This temporarily disconnects on some drivers, so we use passive scan where possible
SCAN_OUTPUT="$(iw dev "$IFACE" scan 2>/dev/null || sudo iw dev "$IFACE" scan 2>/dev/null || true)"

if [[ -z "$SCAN_OUTPUT" ]]; then
  echo "Warning: Could not perform WiFi scan (may need root)" >&2
  exit 0
fi

# Parse scan results
echo "$SCAN_OUTPUT" | awk -v ts="$TS" -v host="$HOST" -v iface="$IFACE" -v connected="$CONNECTED_BSSID" -v ap_map="$AP_MAP" '
BEGIN {
  FS=": "
  OFS=","
}

# Load AP map into associative array
BEGINFILE {
  if (ap_map != "" && (getline line < ap_map) > 0) {
    close(ap_map)
    while ((getline line < ap_map) > 0) {
      if (line !~ /^#/ && line ~ /,/) {
        split(line, parts, ",")
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", parts[1])
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", parts[2])
        ap_names[tolower(parts[1])] = parts[2]
      }
    }
    close(ap_map)
  }
}

/^BSS / {
  # Print previous AP if we have one
  if (bssid != "") {
    is_conn = (tolower(bssid) == tolower(connected)) ? "1" : "0"
    ap_name = ap_names[tolower(bssid)]
    if (ap_name == "") ap_name = "unknown"
    print ts, host, iface, bssid, ap_name, ssid, signal, freq, channel, is_conn
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
    is_conn = (tolower(bssid) == tolower(connected)) ? "1" : "0"
    ap_name = ap_names[tolower(bssid)]
    if (ap_name == "") ap_name = "unknown"
    print ts, host, iface, bssid, ap_name, ssid, signal, freq, channel, is_conn
  }
}
' >> "$LOG"

# Also log a summary to stdout for debugging
VISIBLE_COUNT="$(tail -n +2 "$LOG" | grep "^$TS" | wc -l)"
echo "Scan complete: found $VISIBLE_COUNT APs visible from $HOST"
