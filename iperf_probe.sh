#!/usr/bin/env bash
#  you can run this like: 
# chmod +x ~/iperf_probe.sh
# SERVER_IP=192.xx.xx.xx ~/iperf_probe.sh
set -euo pipefail

SERVER_IP="${SERVER_IP:?set SERVER_IP to your iperf3 server, e.g. 192.168.x.x}"
LOG="/var/log/netdiag/iperf.jsonl"
TS="$(date -Is)"
HOST="$(hostname)"

mkdir -p "$(dirname "$LOG")"

# Run both directions: download-like (-R) and upload-like
for mode in "download" "upload"; do
  if [[ "$mode" == "download" ]]; then
    out="$(iperf3 -c "$SERVER_IP" -R --json 2>/dev/null || true)"
  else
    out="$(iperf3 -c "$SERVER_IP" --json 2>/dev/null || true)"
  fi

  # If iperf failed, out may be empty; still log something structured.
  if [[ -z "$out" ]]; then
    printf '{"ts":"%s","host":"%s","mode":"%s","ok":false}\n' "$TS" "$HOST" "$mode" >> "$LOG"
  else
    # Wrap the raw iperf JSON with metadata
    printf '{"ts":"%s","host":"%s","mode":"%s","ok":true,"iperf":%s}\n' \
      "$TS" "$HOST" "$mode" "$out" >> "$LOG"
  fi
done
