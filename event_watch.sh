#!/usr/bin/env bash
# event_watch.sh - Monitor WiFi events (disconnects, roaming, auth failures)
# Runs continuously - use systemd to manage (see netdiag-events.service)
set -euo pipefail

IFACE="${IFACE:-wlan0}"
HOST="$(hostname)"
LOG_RAW="/var/log/netdiag/wifi_events.log"
LOG_STRUCTURED="/var/log/netdiag/wifi_events.jsonl"
AP_MAP="${AP_MAP:-/etc/netdiag/ap_map.txt}"

mkdir -p "$(dirname "$LOG_RAW")"

echo "=== starting iw event watch on $HOST $(date -Is) ===" >> "$LOG_RAW"

# Runs forever; use systemd service to manage
# Parse events and output both raw log and structured JSONL
iw event -t | stdbuf -oL awk -v iface="$IFACE" -v host="$HOST" -v log_raw="$LOG_RAW" -v log_struct="$LOG_STRUCTURED" -v ap_map="$AP_MAP" '
BEGIN {
  # Load AP map
  if (ap_map != "") {
    while ((getline line < ap_map) > 0) {
      if (line !~ /^#/ && line ~ /,/) {
        n = split(line, parts, ",")
        if (n >= 2) {
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", parts[1])
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", parts[2])
          ap_names[tolower(parts[1])] = parts[2]
        }
      }
    }
    close(ap_map)
  }
}

function lookup_ap(bssid) {
  lower = tolower(bssid)
  if (lower in ap_names) return ap_names[lower]
  return "unknown"
}

function json_escape(s) {
  gsub(/\\/, "\\\\", s)
  gsub(/"/, "\\\"", s)
  return s
}

$0 ~ iface {
  ts = strftime("%Y-%m-%dT%H:%M:%S%z")
  
  # Write raw log
  print ts, $0 >> log_raw
  fflush(log_raw)
  
  # Parse event type and details
  event_type = ""
  bssid = ""
  reason = ""
  signal = ""
  
  # Disconnection events
  if ($0 ~ /disconnected/) {
    event_type = "disconnect"
    # Extract BSSID if present
    if (match($0, /[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}/)) {
      bssid = substr($0, RSTART, RLENGTH)
    }
    # Extract reason code if present
    if (match($0, /reason: [0-9]+/)) {
      reason = substr($0, RSTART+8, RLENGTH-8)
    }
  }
  # Connection events
  else if ($0 ~ /connected to/) {
    event_type = "connect"
    if (match($0, /[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}/)) {
      bssid = substr($0, RSTART, RLENGTH)
    }
  }
  # Authentication events
  else if ($0 ~ /auth/) {
    event_type = "auth"
    if (match($0, /[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}/)) {
      bssid = substr($0, RSTART, RLENGTH)
    }
  }
  # Association events
  else if ($0 ~ /assoc/) {
    event_type = "assoc"
    if (match($0, /[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}/)) {
      bssid = substr($0, RSTART, RLENGTH)
    }
  }
  # Roaming/scan events
  else if ($0 ~ /scan/) {
    event_type = "scan"
  }
  # Regulatory domain changes
  else if ($0 ~ /regulatory/) {
    event_type = "regulatory"
  }
  # Unknown event
  else {
    event_type = "other"
  }
  
  # Get AP name if we have a BSSID
  ap_name = ""
  if (bssid != "") {
    ap_name = lookup_ap(bssid)
  }
  
  # Write structured JSON
  printf "{\"ts\":\"%s\",\"host\":\"%s\",\"iface\":\"%s\",\"event\":\"%s\"", ts, host, iface, event_type >> log_struct
  if (bssid != "") printf ",\"bssid\":\"%s\",\"ap_name\":\"%s\"", bssid, ap_name >> log_struct
  if (reason != "") printf ",\"reason_code\":%s", reason >> log_struct
  printf ",\"raw\":\"%s\"}\n", json_escape($0) >> log_struct
  fflush(log_struct)
  
  # Track roaming: if we see disconnect then connect to different BSSID
  if (event_type == "disconnect") {
    last_disconnect_bssid = bssid
    last_disconnect_ts = ts
  }
  if (event_type == "connect" && last_disconnect_bssid != "" && bssid != last_disconnect_bssid) {
    # This is a roam event!
    printf "{\"ts\":\"%s\",\"host\":\"%s\",\"iface\":\"%s\",\"event\":\"roam\",\"from_bssid\":\"%s\",\"from_ap\":\"%s\",\"to_bssid\":\"%s\",\"to_ap\":\"%s\"}\n", \
      ts, host, iface, last_disconnect_bssid, lookup_ap(last_disconnect_bssid), bssid, ap_name >> log_struct
    fflush(log_struct)
    last_disconnect_bssid = ""
  }
}'
