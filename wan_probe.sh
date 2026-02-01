#!/usr/bin/env bash
# wan_probe.sh - Multi-target WAN health check
# Tests multiple external targets to differentiate ISP vs destination-specific issues
set -euo pipefail

LOG="/var/log/netdiag/wan_probe.csv"
IFACE="${IFACE:-wlan0}"
TS="$(date -Is)"
HOST="$(hostname)"

# Targets to test (Cloudflare, Google, and ISP first hop)
TARGETS=("1.1.1.1" "8.8.8.8")

mkdir -p "$(dirname "$LOG")"

# Get ISP gateway (first external hop after local gateway)
get_isp_hop() {
  # Use traceroute to find the first hop after local gateway (usually 2nd or 3rd hop)
  local hop
  hop="$(traceroute -n -m 5 -q 1 1.1.1.1 2>/dev/null | awk '
    NR > 1 && $2 !~ /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.64\.)/ && $2 != "*" {
      print $2; exit
    }
  ')"
  echo "${hop:-}"
}

# Ping a target and return loss%,avg_ms
ping_target() {
  local target="$1"
  local out loss avg
  out="$(ping -I "$IFACE" -c 5 -W 2 "$target" 2>/dev/null || true)"
  loss="$(echo "$out" | awk -F', ' '/packet loss/ {gsub(/%/,"",$3); print $3+0; exit}')"
  avg="$(echo "$out" | awk -F'/' '/rtt/ {print $5; exit}')"
  [[ -z "${loss:-}" ]] && loss="100"
  [[ -z "${avg:-}" ]] && avg=""
  echo "$loss,$avg"
}

# HTTP check (tests full stack: DNS + TCP + HTTP)
http_check() {
  local url="$1"
  local start end duration http_code
  start="$(date +%s%3N)"
  http_code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" 2>/dev/null || echo "000")"
  end="$(date +%s%3N)"
  duration=$((end - start))
  echo "$http_code,$duration"
}

# Write header if file doesn't exist
if [[ ! -f "$LOG" ]]; then
  echo "ts,host,iface,cf_loss_pct,cf_avg_ms,google_loss_pct,google_avg_ms,isp_hop,isp_loss_pct,isp_avg_ms,http_code,http_ms,all_down" >> "$LOG"
fi

# Run tests
cf_result="$(ping_target "1.1.1.1")"
google_result="$(ping_target "8.8.8.8")"

# Get ISP hop and test it (cached for efficiency)
ISP_HOP="$(get_isp_hop)"
if [[ -n "$ISP_HOP" ]]; then
  isp_result="$(ping_target "$ISP_HOP")"
else
  isp_result=","
fi

# HTTP check to a reliable endpoint
http_result="$(http_check "http://www.gstatic.com/generate_204")"

# Determine if all targets are down (indicates total WAN failure)
cf_loss="$(echo "$cf_result" | cut -d',' -f1)"
google_loss="$(echo "$google_result" | cut -d',' -f1)"
all_down="0"
if [[ "${cf_loss:-100}" == "100" ]] && [[ "${google_loss:-100}" == "100" ]]; then
  all_down="1"
fi

# Log the results
echo "$TS,$HOST,$IFACE,$cf_result,$google_result,${ISP_HOP:-},$isp_result,$http_result,$all_down" >> "$LOG"
