#!/usr/bin/env bash
set -euo pipefail

LOG="/var/log/netdiag/net_probe.csv"
IFACE="${IFACE:-wlan0}"
GW="$(ip route | awk '/default/ {print $3; exit}')"
TS="$(date -Is)"
HOST="$(hostname)"

ping_stat () {
  local target="$1"
  # outputs: loss rtt_avg_ms
  local out loss avg
  out="$(ping -I "$IFACE" -c 3 -W 1 "$target" 2>/dev/null || true)"
  loss="$(echo "$out" | awk -F', ' '/packet loss/ {gsub(/%/,"",$3); print $3+0; exit}')"
  avg="$(echo "$out" | awk -F'/' '/rtt/ {print $5; exit}')"
  [[ -z "${loss:-}" ]] && loss="100"
  [[ -z "${avg:-}" ]] && avg=""
  echo "$loss,$avg"
}

dns_stat () {
  local name="example.com"
  # outputs: ok query_ms
  local ms ok
  ms="$( (dig +tries=1 +time=1 "$name" @1.1.1.1 >/dev/null && echo "ok") 2>/dev/null | wc -l )"
  if [[ "$ms" -gt 0 ]]; then
    ok="1"
  else
    ok="0"
  fi
  # crude timing (ms) using /usr/bin/time if present
  local t
  t="$(/usr/bin/time -f '%e' dig +tries=1 +time=1 "$name" @1.1.1.1 >/dev/null 2>&1 || true)"
  # seconds to ms (best-effort)
  awk -v ok="$ok" -v t="$t" 'BEGIN{ if(t==""){print ok","""; } else { printf "%s,%.0f\n", ok, (t*1000); } }'
}

mkdir -p "$(dirname "$LOG")"
if [[ ! -f "$LOG" ]]; then
  echo "ts,host,iface,gw,gw_loss_pct,gw_avg_ms,wan_loss_pct,wan_avg_ms,dns_ok,dns_ms" >> "$LOG"
fi

gw_loss_avg="$(ping_stat "$GW")"
wan_loss_avg="$(ping_stat "1.1.1.1")"
dns_ok_ms="$(dns_stat)"

echo "$TS,$HOST,$IFACE,$GW,$gw_loss_avg,$wan_loss_avg,$dns_ok_ms" >> "$LOG"
