#!/usr/bin/env bash
set -euo pipefail

IFACE="${IFACE:-wlan0}"
GW="$(ip route | awk '/default/ {print $3; exit}')"
OUTDIR="/var/log/netdiag/failures"
TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUTDIR"

# quick tests
ping -I "$IFACE" -c 2 -W 1 "$GW" >/dev/null 2>&1 || exit 0          # if GW fails, it's local coverage; skip WAN snapshot
ping -I "$IFACE" -c 2 -W 1 1.1.1.1 >/dev/null 2>&1 && exit 0       # WAN is fine; no snapshot

FN="$OUTDIR/${TS}_$(hostname).log"
{
  echo "TS=$(date -Is) HOST=$(hostname) IFACE=$IFACE GW=$GW"
  echo "---- ip addr ----"; ip addr
  echo "---- ip route ----"; ip route
  echo "---- resolv.conf ----"; cat /etc/resolv.conf || true
  echo "---- iw link ----"; iw dev "$IFACE" link || true
  echo "---- dmesg tail ----"; dmesg | tail -n 80 || true
  echo "---- traceroute 1.1.1.1 ----"; traceroute -n -m 15 1.1.1.1 || true
  echo "---- mtr report 1.1.1.1 ----"; mtr -n -r -c 30 1.1.1.1 || true
} >> "$FN" 2>&1
